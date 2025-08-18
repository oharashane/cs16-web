package main

import (
	"fmt"
)

func main() {
	fmt.Println("🚀 Starting Enhanced Go RTC Server")

	// Start the WebRTC SFU server (this function blocks)
	runSFU()
}
