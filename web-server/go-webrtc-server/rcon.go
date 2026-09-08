package main

// Just enough GoldSrc rcon to tell a server what it is now: a challenge, then a command,
// on the same UDP port the game itself uses. The password is read from cs-server/.env,
// which is mode 600 and never printed — not into a page, not into a log line.

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"regexp"
	"strings"
	"time"
)

var challengePattern = regexp.MustCompile(`challenge rcon (\d+)`)

// rconPassword reads RCON_PASSWORD out of the servers' env file.
func rconPassword(envFile string) (string, error) {
	file, err := os.Open(envFile)
	if err != nil {
		return "", err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if value, found := strings.CutPrefix(strings.TrimSpace(scanner.Text()), "RCON_PASSWORD="); found {
			return strings.TrimSpace(value), nil
		}
	}
	return "", fmt.Errorf("%s names no RCON_PASSWORD", envFile)
}

// rcon sends one command and returns what the server said. Errors never carry the password.
func rcon(address, password, command string) (string, error) {
	conn, err := net.DialTimeout("udp", address, 2*time.Second)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(3 * time.Second))

	if _, err := conn.Write([]byte("\xff\xff\xff\xffchallenge rcon\n")); err != nil {
		return "", err
	}
	buffer := make([]byte, 4096)
	n, err := conn.Read(buffer)
	if err != nil {
		return "", fmt.Errorf("no challenge from %s: %w", address, err)
	}
	found := challengePattern.FindSubmatch(buffer[:n])
	if found == nil {
		return "", fmt.Errorf("%s did not offer a challenge", address)
	}

	request := fmt.Sprintf("\xff\xff\xff\xffrcon %s \"%s\" %s\n", found[1], password, command)
	if _, err := conn.Write([]byte(request)); err != nil {
		return "", err
	}
	// A reply arrives in as many datagrams as it takes; a short quiet means it is done.
	var reply strings.Builder
	for {
		conn.SetDeadline(time.Now().Add(700 * time.Millisecond))
		n, err := conn.Read(buffer)
		if err != nil {
			break
		}
		chunk := buffer[:n]
		if len(chunk) > 5 && chunk[4] == 'l' {
			chunk = chunk[5:]
		}
		reply.Write(chunk)
	}
	return reply.String(), nil
}
