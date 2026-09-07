package main

// Native Counter-Strike clients that arrive through the playit tunnel all reach this
// machine from the agent's one address, and ReHLDS takes a new connection from an address
// it already knows as the player it already has, coming back: it hands over their slot and
// their name (see sourceAddress in signal.go — browsers had the same problem through
// Docker's port proxy). A tunnel cannot be talked out of this, so the tunnel is pointed
// here instead of at the game server. Every distinct client beyond it gets a socket of its
// own, bound to a loopback address of its own, and the server tells them apart exactly as
// it tells browsers apart. Nothing is interpreted; this is a UDP pipe with a memory.

import (
	"net"
	"sync"
	"time"
)

// How long a tunnelled client may be silent before its address is given up. Longer than a
// game's own timeout, so a living player is never renumbered mid-round; short enough that
// a server browser's one-shot query does not hold an address for the evening.
const steamClientIdle = 3 * time.Minute

// A ceiling, so a flood of queries through the tunnel cannot allocate without bound.
const maxSteamClients = 256

type steamClient struct {
	socket   *net.UDPConn // ours, bound to this client's own loopback address
	remote   *net.UDPAddr // where they are, beyond the tunnel
	lastSeen time.Time
}

type steamIngress struct {
	listener *net.UDPConn
	target   *net.UDPAddr
	mutex    sync.Mutex
	clients  map[string]*steamClient
}

// The tunnel's ingress, when there is one. Read by /api/metrics.
var steamServer *steamIngress

// startSteamIngress listens on the port the tunnel forwards to and relays both ways. It
// returns before the first packet: everything happens on its own goroutines. Nil when the
// ingress is off or could not start.
func startSteamIngress(cfg Config) *steamIngress {
	if cfg.SteamPort == 0 {
		return nil
	}
	host := net.ParseIP(cfg.CSHost)
	if host == nil || !host.IsLoopback() {
		logger.Warnf("steam ingress on udp/%d: the game server at %s is not on loopback, so clients cannot be given addresses of their own; not starting", cfg.SteamPort, cfg.CSHost)
		return nil
	}
	listener, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: cfg.SteamPort})
	if err != nil {
		logger.Errorf("steam ingress on udp/%d: %v", cfg.SteamPort, err)
		return nil
	}
	ingress := &steamIngress{
		listener: listener,
		target:   &net.UDPAddr{IP: host, Port: cfg.PrimaryPort},
		clients:  map[string]*steamClient{},
	}
	logger.Infof("steam ingress on %s → %s (each client gets an address of its own)", listener.LocalAddr(), ingress.target)
	go ingress.read()
	go ingress.expire()
	steamServer = ingress
	return ingress
}

// read copies what arrives from the tunnel into the right client's socket.
func (in *steamIngress) read() {
	buffer := make([]byte, messageSize)
	for {
		n, remote, err := in.listener.ReadFromUDP(buffer)
		if err != nil {
			return
		}
		client := in.clientFor(remote)
		if client == nil {
			continue
		}
		if _, err := client.socket.WriteToUDP(buffer[:n], in.target); err != nil {
			logger.Errorf("steam ingress %s → %s: %v", client.socket.LocalAddr(), in.target, err)
		}
	}
}

// clientFor is the client behind one address beyond the tunnel, made if it is new.
func (in *steamIngress) clientFor(remote *net.UDPAddr) *steamClient {
	key := remote.String()
	in.mutex.Lock()
	defer in.mutex.Unlock()
	if client, known := in.clients[key]; known {
		client.lastSeen = time.Now()
		return client
	}
	if len(in.clients) >= maxSteamClients {
		in.dropOldest()
	}
	socket, err := net.ListenUDP("udp4", &net.UDPAddr{IP: nextLoopbackSource(), Port: 0})
	if err != nil {
		logger.Errorf("steam ingress: socket for %s: %v", key, err)
		return nil
	}
	client := &steamClient{socket: socket, remote: &net.UDPAddr{IP: remote.IP, Port: remote.Port}, lastSeen: time.Now()}
	in.clients[key] = client
	logger.Infof("steam ingress: %s is %s", key, socket.LocalAddr())
	go in.write(client)
	return client
}

// write copies the game server's answers back out through the tunnel.
func (in *steamIngress) write(client *steamClient) {
	buffer := make([]byte, messageSize)
	for {
		n, _, err := client.socket.ReadFromUDP(buffer)
		if err != nil {
			return // the socket was closed by expire
		}
		if _, err := in.listener.WriteToUDP(buffer[:n], client.remote); err != nil {
			logger.Errorf("steam ingress → %s: %v", client.remote, err)
			return
		}
	}
}

// expire gives up the addresses of clients that have stopped talking.
func (in *steamIngress) expire() {
	for range time.Tick(30 * time.Second) {
		in.mutex.Lock()
		for key, client := range in.clients {
			if time.Since(client.lastSeen) > steamClientIdle {
				client.socket.Close()
				delete(in.clients, key)
				logger.Infof("steam ingress: %s went quiet; %s is free", key, client.socket.LocalAddr())
			}
		}
		in.mutex.Unlock()
	}
}

// dropOldest makes room for a new client. The caller holds the lock.
func (in *steamIngress) dropOldest() {
	var oldestKey string
	var oldest time.Time
	for key, client := range in.clients {
		if oldestKey == "" || client.lastSeen.Before(oldest) {
			oldestKey, oldest = key, client.lastSeen
		}
	}
	if client, found := in.clients[oldestKey]; found {
		client.socket.Close()
		delete(in.clients, oldestKey)
		logger.Warnf("steam ingress: at %d clients; dropped the quietest, %s", maxSteamClients, oldestKey)
	}
}

// count is how many clients the tunnel is carrying, for /api/metrics.
func (in *steamIngress) count() int {
	in.mutex.Lock()
	defer in.mutex.Unlock()
	return len(in.clients)
}
