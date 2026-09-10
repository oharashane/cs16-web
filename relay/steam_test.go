package main

import (
	"net"
	"testing"
	"time"
)

// Two native clients arriving through the tunnel must reach the game server from two
// different addresses. They do not, without this ingress: the tunnel's agent is one
// address, and ReHLDS reads a second connection from a known address as the first player
// coming back — the mixup of 6 September 2026, in its other form.
func TestSteamIngressGivesEachClientItsOwnAddress(t *testing.T) {
	server, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	// The game server: answers every datagram with the address it came from.
	go func() {
		buffer := make([]byte, 1500)
		for {
			n, from, err := server.ReadFromUDP(buffer)
			if err != nil {
				return
			}
			if _, err := server.WriteToUDP(append([]byte("seen "), append([]byte(from.IP.String()), buffer[:n]...)...), from); err != nil {
				return
			}
		}
	}()

	ingress := startSteamIngress(Config{SteamPort: freeUDPPort(t), CSHost: "127.0.0.1", PrimaryPort: server.LocalAddr().(*net.UDPAddr).Port})
	if ingress == nil {
		t.Fatal("the ingress did not start")
	}
	defer ingress.listener.Close()
	tunnel := ingress.listener.LocalAddr().(*net.UDPAddr)
	to := &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: tunnel.Port}

	ask := func(what string) (answer string, from string) {
		t.Helper()
		client, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
		if err != nil {
			t.Fatal(err)
		}
		defer client.Close()
		if _, err := client.WriteToUDP([]byte(what), to); err != nil {
			t.Fatal(err)
		}
		client.SetReadDeadline(time.Now().Add(3 * time.Second))
		buffer := make([]byte, 1500)
		n, _, err := client.ReadFromUDP(buffer)
		if err != nil {
			t.Fatalf("no answer for %q: %v", what, err)
		}
		reply := string(buffer[:n])
		return reply, reply[len("seen ") : len(reply)-len(what)]
	}

	firstReply, firstAddress := ask("alpha")
	secondReply, secondAddress := ask("beta")

	// Each got their own answer back: the ingress remembers who asked.
	if want := "seen " + firstAddress + "alpha"; firstReply != want {
		t.Errorf("first client got %q, want %q", firstReply, want)
	}
	if want := "seen " + secondAddress + "beta"; secondReply != want {
		t.Errorf("second client got %q, want %q", secondReply, want)
	}
	// And the server saw two different players, which is the whole point.
	if firstAddress == secondAddress {
		t.Errorf("both clients reached the server as %s; they must differ", firstAddress)
	}
	for _, address := range []string{firstAddress, secondAddress} {
		if ip := net.ParseIP(address); ip == nil || !ip.IsLoopback() {
			t.Errorf("client address %q is not a loopback address", address)
		}
	}
}

// freeUDPPort is a port nothing is using, released before it is returned. Good enough for
// a test that binds it immediately.
func freeUDPPort(t *testing.T) int {
	t.Helper()
	socket, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer socket.Close()
	return socket.LocalAddr().(*net.UDPAddr).Port
}
