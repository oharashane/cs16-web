package main

import (
	"fmt"
	"net"
	"testing"
)

// TestServerDiscovery tests the CS1.6 server discovery functionality
func TestServerDiscovery(t *testing.T) {
	sm := NewServerManager()
	defer sm.StopDiscovery()

	// Test CS1.6 server info packet parsing
	testCases := []struct {
		name     string
		response []byte
		expected *ServerInfo
	}{
		{
			name: "Source Engine Query Response",
			response: []byte{
				0xFF, 0xFF, 0xFF, 0xFF, 'I', // Header + type
				0x11,                                                        // Protocol version
				'T', 'e', 's', 't', ' ', 'S', 'e', 'r', 'v', 'e', 'r', 0x00, // Server name
				'd', 'e', '_', 'd', 'u', 's', 't', '2', 0x00, // Map name
				'c', 's', 't', 'r', 'i', 'k', 'e', 0x00, // Folder
				'C', 'o', 'u', 'n', 't', 'e', 'r', '-', 'S', 't', 'r', 'i', 'k', 'e', 0x00, // Game
				0x00, 0x00, // AppID (2 bytes)
				0x05, // Players
				0x10, // Max players
			},
			expected: &ServerInfo{
				Name:       "Test Server",
				Map:        "de_dust2",
				Game:       "cstrike",
				Players:    5,
				MaxPlayers: 16,
			},
		},
		{
			name: "Challenge Response",
			response: []byte{
				0xFF, 0xFF, 0xFF, 0xFF, 'A', // Header + type 'A'
				0x12, 0x34, 0x56, 0x78, // Challenge bytes
			},
			expected: &ServerInfo{
				Challenge:   []byte{0x12, 0x34, 0x56, 0x78},
				IsChallenge: true,
			},
		},
		{
			name: "Legacy Response",
			response: []byte{
				0xFF, 0xFF, 0xFF, 0xFF, 'm', // Header + type 'm'
				'\\', 'h', 'o', 's', 't', 'n', 'a', 'm', 'e', '\\',
				'L', 'e', 'g', 'a', 'c', 'y', ' ', 'S', 'e', 'r', 'v', 'e', 'r', '\\',
				'm', 'a', 'p', '\\', 'c', 's', '_', 'a', 's', 's', 'a', 'u', 'l', 't', '\\',
				'p', 'l', 'a', 'y', 'e', 'r', 's', '\\', '3', '\\',
				'm', 'a', 'x', '\\', '1', '2', '\\',
			},
			expected: &ServerInfo{
				Name:       "Legacy Server",
				Map:        "cs_assault",
				Game:       "cstrike",
				Players:    3,
				MaxPlayers: 12,
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := sm.parseCS16ServerInfo(tc.response)

			if result == nil && tc.expected != nil {
				t.Fatalf("Expected result, got nil")
			}

			if tc.expected == nil && result != nil {
				t.Fatalf("Expected nil, got result")
			}

			if tc.expected == nil && result == nil {
				return // Both nil, test passes
			}

			// Compare fields
			if result.Name != tc.expected.Name {
				t.Errorf("Name: expected %q, got %q", tc.expected.Name, result.Name)
			}

			if result.Map != tc.expected.Map {
				t.Errorf("Map: expected %q, got %q", tc.expected.Map, result.Map)
			}

			if result.Players != tc.expected.Players {
				t.Errorf("Players: expected %d, got %d", tc.expected.Players, result.Players)
			}

			if result.MaxPlayers != tc.expected.MaxPlayers {
				t.Errorf("MaxPlayers: expected %d, got %d", tc.expected.MaxPlayers, result.MaxPlayers)
			}

			if result.IsChallenge != tc.expected.IsChallenge {
				t.Errorf("IsChallenge: expected %v, got %v", tc.expected.IsChallenge, result.IsChallenge)
			}
		})
	}
}

// TestGameModeDetection tests the game mode detection logic
func TestGameModeDetection(t *testing.T) {
	sm := NewServerManager()

	testCases := []struct {
		serverName   string
		expectedMode string
	}{
		{"Classic CS1.6 Server", "classic"},
		{"Deathmatch Arena", "deathmatch"},
		{"DM Server", "deathmatch"},
		{"GunGame Progressive", "gungame"},
		{"GG Server", "gungame"},
		{"Random Server Name", "classic"}, // Default
		{"", "classic"},                   // Empty name
	}

	for _, tc := range testCases {
		t.Run(fmt.Sprintf("ServerName_%s", tc.serverName), func(t *testing.T) {
			result := sm.detectGameMode(tc.serverName)
			if result != tc.expectedMode {
				t.Errorf("Expected %q, got %q for server name %q", tc.expectedMode, result, tc.serverName)
			}
		})
	}
}

// TestServerManager tests the core server management functionality
func TestServerManager(t *testing.T) {
	sm := NewServerManager()
	defer sm.StopDiscovery()

	// Test adding a server
	serverInfo := &ServerInfo{
		Name:       "Test Server",
		Map:        "de_dust2",
		Game:       "cstrike",
		Players:    5,
		MaxPlayers: 16,
	}

	serverID := "127.0.0.1:27015"
	sm.updateServer(serverID, "127.0.0.1", 27015, serverInfo, 10.5)

	// Test getting servers
	servers := sm.GetServers()
	if len(servers) != 1 {
		t.Fatalf("Expected 1 server, got %d", len(servers))
	}

	server, exists := servers[serverID]
	if !exists {
		t.Fatalf("Server %s not found", serverID)
	}

	// Verify server properties
	if server.ID != serverID {
		t.Errorf("Expected ID %s, got %s", serverID, server.ID)
	}

	if server.Name != "Test Server" {
		t.Errorf("Expected name 'Test Server', got %s", server.Name)
	}

	if server.GameMode != "classic" {
		t.Errorf("Expected game mode 'classic', got %s", server.GameMode)
	}

	if server.Status != "online" {
		t.Errorf("Expected status 'online', got %s", server.Status)
	}

	// Test default server selection
	defaultServer := sm.GetDefaultServer()
	if defaultServer != serverID {
		t.Errorf("Expected default server %s, got %s", serverID, defaultServer)
	}

	// Test marking server offline
	sm.markServerOffline(serverID)
	server = sm.GetServer(serverID)
	if server.Status != "offline" {
		t.Errorf("Expected status 'offline', got %s", server.Status)
	}
}

// TestClientConnectionManagement tests client connection tracking
func TestClientConnectionManagement(t *testing.T) {
	sm := NewServerManager()
	defer sm.StopDiscovery()

	// Add a test server
	serverInfo := &ServerInfo{
		Name:       "Test Server",
		Map:        "de_dust2",
		Game:       "cstrike",
		Players:    0,
		MaxPlayers: 16,
	}
	serverID := "127.0.0.1:27015"
	sm.updateServer(serverID, "127.0.0.1", 27015, serverInfo, 5.0)

	// Create a mock UDP socket
	mockSocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		t.Fatalf("Failed to create mock UDP socket: %v", err)
	}
	defer mockSocket.Close()

	// Test client connection
	clientIP := [4]byte{192, 168, 1, 100}
	mockWriter := &mockWriteChannel{}

	sm.AddClientConnection(clientIP, serverID, mockSocket, mockWriter)

	// Test getting client connection
	conn := sm.GetClientConnection(clientIP)
	if conn == nil {
		t.Fatalf("Client connection not found")
	}

	if conn.ServerID != serverID {
		t.Errorf("Expected server ID %s, got %s", serverID, conn.ServerID)
	}

	if conn.UDPSocket != mockSocket {
		t.Errorf("UDP socket mismatch")
	}

	// Test removing client connection
	sm.RemoveClientConnection(clientIP)
	conn = sm.GetClientConnection(clientIP)
	if conn != nil {
		t.Errorf("Client connection should be removed")
	}
}

// mockWriteChannel implements io.Writer for testing
type mockWriteChannel struct {
	data []byte
}

func (m *mockWriteChannel) Write(p []byte) (n int, err error) {
	m.data = append(m.data, p...)
	return len(p), nil
}

// TestHelperFunctions tests utility functions
func TestHelperFunctions(t *testing.T) {
	// Test indexOf function
	testSlice := []byte{1, 2, 3, 0, 5, 6}
	result := indexOf(testSlice, 0, 0)
	if result != 3 {
		t.Errorf("Expected index 3, got %d", result)
	}

	result = indexOf(testSlice, 0, 4)
	if result != -1 {
		t.Errorf("Expected -1, got %d", result)
	}

	result = indexOf(testSlice, 99, 0)
	if result != -1 {
		t.Errorf("Expected -1 for non-existent byte, got %d", result)
	}
}

// Benchmark tests for performance
func BenchmarkServerDiscovery(b *testing.B) {
	sm := NewServerManager()
	defer sm.StopDiscovery()

	// Sample CS1.6 response packet
	response := []byte{
		0xFF, 0xFF, 0xFF, 0xFF, 'I',
		0x11,
		'B', 'e', 'n', 'c', 'h', ' ', 'S', 'e', 'r', 'v', 'e', 'r', 0x00,
		'd', 'e', '_', 'd', 'u', 's', 't', '2', 0x00,
		'c', 's', 't', 'r', 'i', 'k', 'e', 0x00,
		'C', 'S', '1', '.', '6', 0x00,
		0x00, 0x00,
		0x08,
		0x10,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sm.parseCS16ServerInfo(response)
	}
}

func BenchmarkGameModeDetection(b *testing.B) {
	sm := NewServerManager()
	serverNames := []string{
		"Classic CS1.6 Server",
		"Deathmatch Arena",
		"GunGame Progressive",
		"Random Server Name",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, name := range serverNames {
			sm.detectGameMode(name)
		}
	}
}
