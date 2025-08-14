package main

import (
	"fmt"
	"time"
)

func main() {
	fmt.Println("Starting CS16 WebRTC-to-Python Relay Server")
	
	// Start the WebRTC SFU server
	runSFU()
	
	// Keep main goroutine alive
	for {
		time.Sleep(time.Second)
	}
}
