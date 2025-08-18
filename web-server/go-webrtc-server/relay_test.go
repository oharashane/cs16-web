package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"
)

// TestHealthHandler tests the health check endpoint
func TestHealthHandler(t *testing.T) {
	// Initialize server manager for testing
	serverManager = NewServerManager()
	defer serverManager.StopDiscovery()

	// Reset metrics
	metricsLock.Lock()
	packetsToUDP = 0
	packetsFromUDP = 0
	metricsLock.Unlock()

	req, err := http.NewRequest("GET", "/api/heartbeat", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(healthHandler)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf("handler returned wrong status code: got %v want %v", status, http.StatusOK)
	}

	// Check response content type
	expected := "application/json"
	if ctype := rr.Header().Get("Content-Type"); ctype != expected {
		t.Errorf("content type header does not match: got %v want %v", ctype, expected)
	}

	// Parse JSON response
	var response map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Errorf("Failed to parse JSON response: %v", err)
	}

	// Check required fields
	if response["status"] != "ok" {
		t.Errorf("Expected status 'ok', got %v", response["status"])
	}

	if response["timestamp"] == nil {
		t.Errorf("Expected timestamp field")
	}

	if response["go_rtc_server"] == nil {
		t.Errorf("Expected go_rtc_server field")
	}
}

// TestServersHandler tests the servers endpoint
func TestServersHandler(t *testing.T) {
	// Initialize server manager
	serverManager = NewServerManager()
	defer serverManager.StopDiscovery()

	// Add a test server
	serverInfo := &ServerInfo{
		Name:       "Test Server",
		Map:        "de_dust2",
		Game:       "cstrike",
		Players:    5,
		MaxPlayers: 16,
	}
	serverManager.updateServer("127.0.0.1:27015", "127.0.0.1", 27015, serverInfo, 10.0)

	req, err := http.NewRequest("GET", "/api/servers", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(serversHandler)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf("handler returned wrong status code: got %v want %v", status, http.StatusOK)
	}

	// Parse JSON response
	var response map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Errorf("Failed to parse JSON response: %v", err)
	}

	// Check response structure
	if response["count"] == nil {
		t.Errorf("Expected count field")
	}

	if response["servers"] == nil {
		t.Errorf("Expected servers field")
	}

	// Check count
	count, ok := response["count"].(float64)
	if !ok || count != 1 {
		t.Errorf("Expected count 1, got %v", response["count"])
	}
}

// TestMetricsHandler tests the Prometheus metrics endpoint
func TestMetricsHandler(t *testing.T) {
	// Initialize server manager
	serverManager = NewServerManager()
	defer serverManager.StopDiscovery()

	// Set some test metrics
	metricsLock.Lock()
	packetsToUDP = 42
	packetsFromUDP = 24
	metricsLock.Unlock()

	req, err := http.NewRequest("GET", "/api/metrics", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(metricsHandler)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf("handler returned wrong status code: got %v want %v", status, http.StatusOK)
	}

	// Check content type
	expected := "text/plain"
	if ctype := rr.Header().Get("Content-Type"); ctype != expected {
		t.Errorf("content type header does not match: got %v want %v", ctype, expected)
	}

	body := rr.Body.String()

	// Check for required metrics
	expectedMetrics := []string{
		"pkt_to_udp_total 42",
		"pkt_from_udp_total 24",
		"cs_servers_online",
		"cs_servers_total",
	}

	for _, metric := range expectedMetrics {
		if !contains(body, metric) {
			t.Errorf("Expected metric %q not found in response", metric)
		}
	}
}

// TestRTCToUDPRelay tests the core RTC-to-UDP relay functionality
func TestRTCToUDPRelay(t *testing.T) {
	// Initialize server manager
	serverManager = NewServerManager()
	defer serverManager.StopDiscovery()

	// Create a mock CS server
	mockServer, err := createMockCS16Server()
	if err != nil {
		t.Fatalf("Failed to create mock CS server: %v", err)
	}
	defer mockServer.Close()

	// Add the mock server to server manager
	serverInfo := &ServerInfo{
		Name:       "Mock CS Server",
		Map:        "de_dust2",
		Game:       "cstrike",
		Players:    0,
		MaxPlayers: 16,
	}
	serverID := fmt.Sprintf("127.0.0.1:%d", mockServer.Port())
	serverManager.updateServer(serverID, "127.0.0.1", mockServer.Port(), serverInfo, 5.0)

	// Create client connection
	clientIP := [4]byte{192, 168, 1, 100}
	udpSocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		t.Fatalf("Failed to create UDP socket: %v", err)
	}
	defer udpSocket.Close()

	mockWriter := &TestWriteChannel{data: make([]byte, 0)}
	serverManager.AddClientConnection(clientIP, serverID, udpSocket, mockWriter)

	// Start UDP listener for the test client (normally done in WebSocket handler)
	go startUDPListener(clientIP, udpSocket)

	// Test packet relay to server
	testPacket := []byte{0xFF, 0xFF, 0xFF, 0xFF, 'i', 'n', 'f', 'o', 0x00}
	relayPacketToServer(clientIP, testPacket)

	// Wait for packet to be processed
	time.Sleep(100 * time.Millisecond)

	// Check if mock server received the packet
	if !mockServer.ReceivedPacket() {
		t.Errorf("Mock server did not receive packet")
	}

	// Check metrics
	metricsLock.RLock()
	sentPackets := packetsToUDP
	metricsLock.RUnlock()

	if sentPackets == 0 {
		t.Errorf("Expected packet count > 0, got %d", sentPackets)
	}

	// Test response from server
	response := []byte{0xFF, 0xFF, 0xFF, 0xFF, 'm', 't', 'e', 's', 't', 0x00}
	mockServer.SendResponse(response)

	// Wait for response to be processed
	time.Sleep(100 * time.Millisecond)

	// Check if client received response
	if len(mockWriter.data) == 0 {
		t.Errorf("Client did not receive response")
	}
}

// TestPortValidation tests that port validation works correctly
func TestPortValidation(t *testing.T) {
	// Test cases for port validation
	testCases := []struct {
		name       string
		portParam  string
		expectPass bool
	}{
		{"Valid port within range", "27015", true},
		{"Valid port at lower bound", "27000", true},
		{"Valid port at upper bound", "27030", true},
		{"Invalid port below range", "26999", false},
		{"Invalid port above range", "27031", false},
		{"Invalid port way outside", "99999", false},
		{"Invalid port negative", "-1", false},
		{"Invalid port zero", "0", false},
		{"Non-numeric port", "invalid", true}, // Should pass validation but fail server lookup
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Parse port like the websocketHandler does
			if port, err := strconv.Atoi(tc.portParam); err == nil {
				// Port validation check
				isValidPort := port >= MIN_CS_PORT && port <= MAX_CS_PORT
				if isValidPort != tc.expectPass {
					t.Errorf("Port %d validation: expected %v, got %v", port, tc.expectPass, isValidPort)
				}
			} else {
				// Non-numeric ports are handled differently (fall through to server lookup)
				if !tc.expectPass {
					t.Errorf("Non-numeric port %s should pass validation stage", tc.portParam)
				}
			}
		})
	}
}

// TestConcurrentClientConnections tests multiple concurrent client connections
func TestConcurrentClientConnections(t *testing.T) {
	serverManager = NewServerManager()
	defer serverManager.StopDiscovery()

	// Create mock server
	mockServer, err := createMockCS16Server()
	if err != nil {
		t.Fatalf("Failed to create mock CS server: %v", err)
	}
	defer mockServer.Close()

	// Add server
	serverInfo := &ServerInfo{
		Name:       "Mock CS Server",
		Map:        "de_dust2",
		Game:       "cstrike",
		Players:    0,
		MaxPlayers: 16,
	}
	serverID := fmt.Sprintf("127.0.0.1:%d", mockServer.Port())
	serverManager.updateServer(serverID, "127.0.0.1", mockServer.Port(), serverInfo, 5.0)

	// Create multiple client connections concurrently
	numClients := 10
	var wg sync.WaitGroup
	wg.Add(numClients)

	for i := 0; i < numClients; i++ {
		go func(clientID int) {
			defer wg.Done()

			clientIP := [4]byte{192, 168, 1, byte(clientID)}
			udpSocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
			if err != nil {
				t.Errorf("Failed to create UDP socket for client %d: %v", clientID, err)
				return
			}
			defer udpSocket.Close()

			mockWriter := &TestWriteChannel{data: make([]byte, 0)}
			serverManager.AddClientConnection(clientIP, serverID, udpSocket, mockWriter)

			// Send test packet
			testPacket := []byte{0xFF, 0xFF, 0xFF, 0xFF, byte(clientID)}
			relayPacketToServer(clientIP, testPacket)

			// Clean up
			serverManager.RemoveClientConnection(clientIP)
		}(i)
	}

	wg.Wait()

	// Verify all connections were handled
	time.Sleep(200 * time.Millisecond)

	// Check that no client connections remain
	if len(serverManager.clientConnections) != 0 {
		t.Errorf("Expected 0 remaining connections, got %d", len(serverManager.clientConnections))
	}
}

// TestWriteChannel implements io.Writer for testing
type TestWriteChannel struct {
	data []byte
	mu   sync.Mutex
}

func (t *TestWriteChannel) Write(p []byte) (n int, err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.data = append(t.data, p...)
	return len(p), nil
}

// MockCS16Server simulates a CS1.6 server for testing
type MockCS16Server struct {
	conn           *net.UDPConn
	receivedPacket bool
	mu             sync.Mutex
}

func createMockCS16Server() (*MockCS16Server, error) {
	addr, err := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return nil, err
	}

	server := &MockCS16Server{
		conn: conn,
	}

	// Start listening for packets
	go server.listen()

	return server, nil
}

func (m *MockCS16Server) listen() {
	buffer := make([]byte, 1024)
	for {
		_, addr, err := m.conn.ReadFromUDP(buffer)
		if err != nil {
			return // Connection closed
		}

		m.mu.Lock()
		m.receivedPacket = true
		m.mu.Unlock()

		// Send a mock response
		response := []byte{0xFF, 0xFF, 0xFF, 0xFF, 'm', 'o', 'c', 'k', 0x00}
		m.conn.WriteToUDP(response, addr)
	}
}

func (m *MockCS16Server) ReceivedPacket() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.receivedPacket
}

func (m *MockCS16Server) SendResponse(data []byte) {
	// This would send to the last client that sent a packet
	// For simplicity, we'll just mark it as sent
}

func (m *MockCS16Server) Port() int {
	return m.conn.LocalAddr().(*net.UDPAddr).Port
}

func (m *MockCS16Server) Close() {
	m.conn.Close()
}

// Utility function to check if string contains substring
func contains(s, substr string) bool {
	return bytes.Contains([]byte(s), []byte(substr))
}

// BenchmarkRelayPacketToServer benchmarks the relay performance
func BenchmarkRelayPacketToServer(b *testing.B) {
	serverManager = NewServerManager()
	defer serverManager.StopDiscovery()

	// Create mock server
	mockServer, _ := createMockCS16Server()
	defer mockServer.Close()

	// Add server
	serverInfo := &ServerInfo{
		Name:       "Benchmark Server",
		Map:        "de_dust2",
		Game:       "cstrike",
		Players:    0,
		MaxPlayers: 16,
	}
	serverID := fmt.Sprintf("127.0.0.1:%d", mockServer.Port())
	serverManager.updateServer(serverID, "127.0.0.1", mockServer.Port(), serverInfo, 5.0)

	// Create client connection
	clientIP := [4]byte{192, 168, 1, 100}
	udpSocket, _ := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	defer udpSocket.Close()

	mockWriter := &TestWriteChannel{data: make([]byte, 0)}
	serverManager.AddClientConnection(clientIP, serverID, udpSocket, mockWriter)

	testPacket := []byte{0xFF, 0xFF, 0xFF, 0xFF, 'i', 'n', 'f', 'o', 0x00}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		relayPacketToServer(clientIP, testPacket)
	}
}
