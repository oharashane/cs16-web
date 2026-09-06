package main

import (
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
)

// ServerConfig represents a discovered CS1.6 server
type ServerConfig struct {
	ID           string    `json:"id"`            // "127.0.0.1:27015"
	Host         string    `json:"host"`          // "127.0.0.1"
	Port         int       `json:"port"`          // 27015
	GameMode     string    `json:"game_mode"`     // "classic", "deathmatch", "gungame"
	Name         string    `json:"name"`          // From server hostname cvar
	Map          string    `json:"map"`           // Current map
	Players      int       `json:"players"`       // Current players
	MaxPlayers   int       `json:"max_players"`   // Server capacity
	Status       string    `json:"status"`        // "online", "offline"
	LastSeen     time.Time `json:"last_seen"`     // Last successful query
	ResponseTime float64   `json:"response_time"` // Query response time in ms
}

// ServerInfo represents parsed CS1.6 server response
type ServerInfo struct {
	Name        string `json:"name"`
	Map         string `json:"map"`
	Game        string `json:"game"`
	Players     int    `json:"players"`
	MaxPlayers  int    `json:"max_players"`
	Challenge   []byte `json:"challenge,omitempty"`
	IsChallenge bool   `json:"is_challenge,omitempty"`
}

// ClientConnection is one browser's session: its UDP socket toward the game server, the
// data channel back to it, and what has passed through.
type ClientConnection struct {
	IP          [4]byte       // Session id; looks like an address, is not one
	ServerID    string        // Target CS server ID
	UDPSocket   *net.UDPConn  // UDP connection to CS server
	Server      *ServerConfig // Reference to target server
	Peer        *webrtc.PeerConnection
	Remote      string // The browser's address as the WebSocket saw it
	ConnectedAt time.Time

	PacketsToServer, PacketsFromServer atomic.Int64
	BytesToServer, BytesFromServer     atomic.Int64
	lastActivity                       atomic.Int64

	mu           sync.Mutex
	writeChannel io.Writer // WebRTC DataChannel back to client; nil until it opens
}

// ServerManager handles CS server discovery and management
type ServerManager struct {
	servers           map[string]*ServerConfig
	clientConnections map[[4]byte]*ClientConnection
	mutex             sync.RWMutex
	discoveryRunning  bool
	defaultServerID   string
}

// Where the game servers live. Set from configuration before discovery starts.
var csHost = "127.0.0.1"

// The ports discovery scans and signalling accepts. Variables so a test can widen them
// around a server on an ephemeral port; the service never changes them.
var (
	MIN_CS_PORT = 27000
	MAX_CS_PORT = 27030
)

// NewServerManager creates a new server manager
func NewServerManager() *ServerManager {
	return &ServerManager{
		servers:           make(map[string]*ServerConfig),
		clientConnections: make(map[[4]byte]*ClientConnection),
		discoveryRunning:  false,
	}
}

// StartDiscovery begins the server discovery process
func (sm *ServerManager) StartDiscovery() {
	if sm.discoveryRunning {
		return
	}

	sm.discoveryRunning = true
	logger.Infof("🔍 Starting CS server discovery (ports 27000-27030)")

	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()

		for sm.discoveryRunning {
			sm.discoverServers()
			<-ticker.C
		}
	}()
}

// StopDiscovery stops the server discovery process
func (sm *ServerManager) StopDiscovery() {
	sm.discoveryRunning = false
}

// discoverServers scans the port range for CS servers
func (sm *ServerManager) discoverServers() {
	startPort, endPort := MIN_CS_PORT, MAX_CS_PORT

	// Use a WaitGroup to scan all ports concurrently
	var wg sync.WaitGroup

	for port := startPort; port <= endPort; port++ {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			sm.queryServer(csHost, p)
		}(port)
	}

	wg.Wait()

	// Clean up offline servers
	sm.cleanupOfflineServers()

}

// queryServer queries a specific server for information
func (sm *ServerManager) queryServer(host string, port int) {
	serverID := fmt.Sprintf("%s:%d", host, port)

	// Try multiple query methods for CS1.6 compatibility
	queryMethods := [][]byte{
		// Source Engine Query
		{0xFF, 0xFF, 0xFF, 0xFF, 0x54, 'S', 'o', 'u', 'r', 'c', 'e', ' ', 'E', 'n', 'g', 'i', 'n', 'e', ' ', 'Q', 'u', 'e', 'r', 'y', 0x00},
		// Legacy info query
		{0xFF, 0xFF, 0xFF, 0xFF, 'i', 'n', 'f', 'o', 0x00},
		// Players query
		{0xFF, 0xFF, 0xFF, 0xFF, 'p', 'l', 'a', 'y', 'e', 'r', 's', 0x00},
	}

	startTime := time.Now()

	for _, queryPacket := range queryMethods {
		conn, err := net.DialTimeout("udp", fmt.Sprintf("%s:%d", host, port), 1*time.Second)
		if err != nil {
			continue
		}
		defer conn.Close()

		// Set read timeout
		conn.SetReadDeadline(time.Now().Add(1 * time.Second))

		// Send query
		_, err = conn.Write(queryPacket)
		if err != nil {
			continue
		}

		// Read response
		buffer := make([]byte, 1024)
		n, err := conn.Read(buffer)
		if err != nil {
			continue
		}

		responseTime := float64(time.Since(startTime).Nanoseconds()) / 1e6 // Convert to milliseconds

		// Parse server info
		serverInfo := sm.parseCS16ServerInfo(buffer[:n])
		if serverInfo != nil && !serverInfo.IsChallenge {
			// Successfully got server info
			sm.updateServer(serverID, host, port, serverInfo, responseTime)
			return
		} else if serverInfo != nil && serverInfo.IsChallenge {
			// Handle challenge response
			if len(serverInfo.Challenge) > 0 {
				challengeQuery := append(queryPacket, serverInfo.Challenge...)
				conn.Write(challengeQuery)

				n, err = conn.Read(buffer)
				if err == nil {
					serverInfo = sm.parseCS16ServerInfo(buffer[:n])
					if serverInfo != nil && !serverInfo.IsChallenge {
						sm.updateServer(serverID, host, port, serverInfo, responseTime)
						return
					}
				}
			}
		}
	}

	// No successful response - mark as offline if it exists
	sm.markServerOffline(serverID)
}

// parseCS16ServerInfo parses CS1.6 server info response packets
func (sm *ServerManager) parseCS16ServerInfo(response []byte) *ServerInfo {
	if len(response) < 5 {
		return nil
	}

	// Skip the header (4 bytes of 0xFF + response type)
	responseType := response[4]
	data := response[5:]

	// Handle challenge response (type 'A')
	if responseType == 'A' {
		if len(data) >= 4 {
			return &ServerInfo{
				Challenge:   data[:4],
				IsChallenge: true,
			}
		}
		return &ServerInfo{IsChallenge: true}
	}

	// Handle Source Engine Query response (type 'I')
	if responseType == 'I' {
		return sm.parseSourceEngineResponse(data)
	}

	// Handle legacy query response (type 'm')
	if responseType == 'm' {
		return sm.parseLegacyResponse(data)
	}

	return nil
}

// parseSourceEngineResponse parses Source Engine style responses
func (sm *ServerManager) parseSourceEngineResponse(data []byte) *ServerInfo {
	if len(data) < 2 {
		return nil
	}

	pos := 1 // Skip protocol version

	// Extract server name
	nameEnd := indexOf(data, 0, pos)
	if nameEnd == -1 {
		return nil
	}
	serverName := string(data[pos:nameEnd])
	pos = nameEnd + 1

	// Extract map name
	mapEnd := indexOf(data, 0, pos)
	if mapEnd == -1 {
		return &ServerInfo{Name: serverName}
	}
	mapName := string(data[pos:mapEnd])
	pos = mapEnd + 1

	// Skip folder (game directory)
	folderEnd := indexOf(data, 0, pos)
	if folderEnd == -1 {
		return &ServerInfo{Name: serverName, Map: mapName}
	}
	pos = folderEnd + 1

	// Skip game name
	gameEnd := indexOf(data, 0, pos)
	if gameEnd == -1 {
		return &ServerInfo{Name: serverName, Map: mapName}
	}
	pos = gameEnd + 1

	// Skip appid (2 bytes)
	if pos+2 > len(data) {
		return &ServerInfo{Name: serverName, Map: mapName}
	}
	pos += 2

	// Extract player count
	if pos >= len(data) {
		return &ServerInfo{Name: serverName, Map: mapName}
	}
	players := int(data[pos])
	pos++

	// Extract max players
	if pos >= len(data) {
		return &ServerInfo{Name: serverName, Map: mapName, Players: players}
	}
	maxPlayers := int(data[pos])

	return &ServerInfo{
		Name:       serverName,
		Map:        mapName,
		Game:       "cstrike",
		Players:    players,
		MaxPlayers: maxPlayers,
	}
}

// parseLegacyResponse parses legacy CS1.6 responses
func (sm *ServerManager) parseLegacyResponse(data []byte) *ServerInfo {
	text := string(data)

	// Look for backslash-separated key-value pairs
	if !strings.Contains(text, "\\") {
		return nil
	}

	parts := strings.Split(text, "\\")
	info := make(map[string]string)

	// Parse key-value pairs (skip first empty element)
	for i := 1; i+1 < len(parts); i += 2 {
		key := strings.TrimSpace(parts[i])
		value := strings.TrimSpace(parts[i+1])
		info[key] = value
	}

	// Extract common fields
	name := info["hostname"]
	if name == "" {
		name = "Legacy CS1.6 Server"
	}

	mapName := info["map"]
	if mapName == "" {
		mapName = "unknown"
	}

	players := 0
	if p := info["players"]; p != "" {
		if val, err := strconv.Atoi(p); err == nil {
			players = val
		}
	}

	maxPlayers := 0
	if m := info["max"]; m != "" {
		if val, err := strconv.Atoi(m); err == nil {
			maxPlayers = val
		}
	}

	return &ServerInfo{
		Name:       name,
		Map:        mapName,
		Game:       "cstrike",
		Players:    players,
		MaxPlayers: maxPlayers,
	}
}

// updateServer updates or creates a server entry
func (sm *ServerManager) updateServer(serverID, host string, port int, info *ServerInfo, responseTime float64) {
	sm.mutex.Lock()
	defer sm.mutex.Unlock()

	gameMode := sm.detectGameMode(info.Name)

	server := &ServerConfig{
		ID:           serverID,
		Host:         host,
		Port:         port,
		GameMode:     gameMode,
		Name:         info.Name,
		Map:          info.Map,
		Players:      info.Players,
		MaxPlayers:   info.MaxPlayers,
		Status:       "online",
		LastSeen:     time.Now(),
		ResponseTime: responseTime,
	}

	// A server is logged when it appears and when it comes back, not on every scan: the
	// scan runs every few seconds and the journal is for what changed.
	existing, known := sm.servers[serverID]
	wasOffline := known && existing.Status == "offline"

	sm.servers[serverID] = server

	// Set first discovered server as default
	if sm.defaultServerID == "" {
		sm.defaultServerID = serverID
		
	}

	switch {
	case wasOffline:
		logger.Infof("server back: %s (%s) - %s on %s", serverID, info.Name, gameMode, info.Map)
	case !known:
		logger.Infof("server found: %s (%s) - %s on %s [%.1fms]", serverID, info.Name, gameMode, info.Map, responseTime)
	case existing.Map != info.Map:
		logger.Infof("server %s changed map: %s → %s", serverID, existing.Map, info.Map)
	}
}

// markServerOffline marks a server as offline
func (sm *ServerManager) markServerOffline(serverID string) {
	sm.mutex.Lock()
	defer sm.mutex.Unlock()

	if server, exists := sm.servers[serverID]; exists && server.Status == "online" {
		server.Status = "offline"
		logger.Warnf("server gone: %s (%s)", serverID, server.Name)
	}
}

// cleanupOfflineServers removes servers that have been offline too long
func (sm *ServerManager) cleanupOfflineServers() {
	sm.mutex.Lock()
	defer sm.mutex.Unlock()

	cutoff := time.Now().Add(-5 * time.Minute) // Remove after 5 minutes offline

	for serverID, server := range sm.servers {
		if server.Status == "offline" && server.LastSeen.Before(cutoff) {
			delete(sm.servers, serverID)
			logger.Infof("server forgotten after five minutes away: %s", serverID)

			// Update default server if needed
			if sm.defaultServerID == serverID {
				sm.defaultServerID = ""
				for id := range sm.servers {
					sm.defaultServerID = id
					break
				}
			}
		}
	}
}

// detectGameMode attempts to detect game mode from server name
func (sm *ServerManager) detectGameMode(serverName string) string {
	name := strings.ToLower(serverName)

	if strings.Contains(name, "deathmatch") || strings.Contains(name, "dm") {
		return "deathmatch"
	}
	if strings.Contains(name, "gungame") || strings.Contains(name, "gg") || strings.Contains(name, "gun game") {
		return "gungame"
	}
	return "classic" // Default
}

// GetServers returns all discovered servers
func (sm *ServerManager) GetServers() map[string]*ServerConfig {
	sm.mutex.RLock()
	defer sm.mutex.RUnlock()

	// Return a copy to avoid concurrent access issues
	servers := make(map[string]*ServerConfig)
	for id, server := range sm.servers {
		serverCopy := *server
		servers[id] = &serverCopy
	}

	return servers
}

// GetServer returns a specific server by ID
func (sm *ServerManager) GetServer(serverID string) *ServerConfig {
	sm.mutex.RLock()
	defer sm.mutex.RUnlock()

	if server, exists := sm.servers[serverID]; exists {
		serverCopy := *server
		return &serverCopy
	}

	return nil
}

// GetDefaultServer returns the default server ID
func (sm *ServerManager) GetDefaultServer() string {
	sm.mutex.RLock()
	defer sm.mutex.RUnlock()

	// Return first online server if default is offline
	if sm.defaultServerID != "" {
		if server, exists := sm.servers[sm.defaultServerID]; exists && server.Status == "online" {
			return sm.defaultServerID
		}
	}

	// Find first online server
	for id, server := range sm.servers {
		if server.Status == "online" {
			return id
		}
	}

	return ""
}

// AddClientConnection registers a session. The writer may be nil until the browser's
// "write" channel opens; see ClientConnection.SetWriter.
func (sm *ServerManager) AddClientConnection(clientIP [4]byte, serverID string, udpSocket *net.UDPConn, writeChannel io.Writer) *ClientConnection {
	sm.mutex.Lock()
	defer sm.mutex.Unlock()

	server := sm.servers[serverID]
	conn := &ClientConnection{
		IP:           clientIP,
		ServerID:     serverID,
		UDPSocket:    udpSocket,
		Server:       server,
		ConnectedAt:  time.Now(),
		writeChannel: writeChannel,
	}
	conn.touch()
	sm.clientConnections[clientIP] = conn
	return conn
}

// Connections is a snapshot of every session, for /api/sessions.
func (sm *ServerManager) Connections() []*ClientConnection {
	sm.mutex.RLock()
	defer sm.mutex.RUnlock()
	connections := make([]*ClientConnection, 0, len(sm.clientConnections))
	for _, conn := range sm.clientConnections {
		connections = append(connections, conn)
	}
	return connections
}

// SessionCount is how many browsers are connected now.
func (sm *ServerManager) SessionCount() int {
	sm.mutex.RLock()
	defer sm.mutex.RUnlock()
	return len(sm.clientConnections)
}

// GetClientConnection returns a client connection
func (sm *ServerManager) GetClientConnection(clientIP [4]byte) *ClientConnection {
	sm.mutex.RLock()
	defer sm.mutex.RUnlock()

	return sm.clientConnections[clientIP]
}

// RemoveClientConnection removes a client connection
func (sm *ServerManager) RemoveClientConnection(clientIP [4]byte) {
	sm.mutex.Lock()
	defer sm.mutex.Unlock()

	if conn, exists := sm.clientConnections[clientIP]; exists {
		if conn.UDPSocket != nil {
			conn.UDPSocket.Close()
		}
		delete(sm.clientConnections, clientIP)
		logger.Infof("session %v ended", clientIP)
	}
}

// GetServersAPI returns servers formatted for API response
func (sm *ServerManager) GetServersAPI() map[string]interface{} {
	servers := sm.GetServers()

	response := map[string]interface{}{
		"servers":   servers,
		"count":     len(servers),
		"timestamp": time.Now().Unix(),
	}

	return response
}

// Helper function to find byte index
func indexOf(slice []byte, target byte, start int) int {
	for i := start; i < len(slice); i++ {
		if slice[i] == target {
			return i
		}
	}
	return -1
}
