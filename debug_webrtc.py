#!/usr/bin/env python3
"""
WebRTC Trigger Debugging Tool

This CLI tool helps debug the WebSocket communication between yohimik clients
and our relay to understand what triggers WebRTC handshake initiation.
"""

import asyncio
import json
import websockets
import argparse
import sys
from datetime import datetime

class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

def log(level, message):
    timestamp = datetime.now().strftime("%H:%M:%S")
    colors = {
        "INFO": Colors.OKBLUE,
        "SUCCESS": Colors.OKGREEN,
        "WARNING": Colors.WARNING,
        "ERROR": Colors.FAIL,
        "DEBUG": Colors.OKCYAN
    }
    color = colors.get(level, "")
    print(f"{color}[{timestamp}] {level}: {message}{Colors.ENDC}")

async def test_relay_connection(relay_url):
    """Test basic connection to our relay"""
    log("INFO", f"Testing connection to relay: {relay_url}")
    
    try:
        async with websockets.connect(relay_url) as websocket:
            log("SUCCESS", "Connected to relay successfully")
            
            # Test basic message
            test_msg = {"test": "connection"}
            await websocket.send(json.dumps(test_msg))
            log("DEBUG", f"Sent: {test_msg}")
            
            # Wait for response or timeout
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=2.0)
                log("DEBUG", f"Received: {response}")
            except asyncio.TimeoutError:
                log("WARNING", "No response from relay (expected - it wants an offer)")
                
    except Exception as e:
        log("ERROR", f"Failed to connect to relay: {e}")
        return False
    return True

async def send_webrtc_offer(relay_url):
    """Send a proper WebRTC offer in yohimik format"""
    log("INFO", "Sending WebRTC offer to relay")
    
    # Minimal but valid WebRTC offer SDP
    offer_sdp = """v=0
o=- 4155100219876785928 1754939660 IN IP4 127.0.0.1
s=-
t=0 0
a=msid-semantic:WMS *
a=fingerprint:sha-256 C6:D0:A8:C8:B8:49:9A:AD:81:C3:5B:79:FE:6A:32:9F:09:7C:DD:5A:17:4F:40:32:F3:7D:91:3E:DE:34:4E:AD
a=group:BUNDLE 0
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=setup:actpass
a=mid:0
a=sendrecv
a=sctp-port:5000
a=max-message-size:1073741823
a=ice-ufrag:MyCHbOuaDFjCBWUr
a=ice-pwd:qBhEttlHAcjrIPMxIWENqlsoBitmytUs"""

    offer_msg = {
        "event": "offer",
        "data": {
            "type": "offer",
            "sdp": offer_sdp
        }
    }
    
    try:
        async with websockets.connect(relay_url) as websocket:
            log("DEBUG", "Sending WebRTC offer...")
            await websocket.send(json.dumps(offer_msg))
            
            # Wait for answer
            response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
            response_data = json.loads(response)
            
            if response_data.get("event") == "answer":
                log("SUCCESS", "Received WebRTC answer from relay!")
                log("DEBUG", f"Answer SDP length: {len(response_data['data']['sdp'])} chars")
                return True
            else:
                log("WARNING", f"Unexpected response: {response_data}")
                
    except Exception as e:
        log("ERROR", f"Failed WebRTC handshake: {e}")
        return False

async def monitor_yohimik_connection(relay_url, duration=30):
    """Monitor connections to see what yohimik actually sends"""
    log("INFO", f"Monitoring relay for {duration} seconds...")
    log("INFO", "Now start your yohimik client and click 'Start'")
    
    try:
        # Create a simple WebSocket server to intercept yohimik
        async def handle_client(websocket, path):
            client_addr = websocket.remote_address
            log("INFO", f"Client connected from {client_addr}")
            
            try:
                async for message in websocket:
                    log("SUCCESS", f"Received from client: {message}")
                    try:
                        data = json.loads(message)
                        log("DEBUG", f"Parsed message: event='{data.get('event', 'N/A')}', type='{data.get('type', 'N/A')}'")
                    except:
                        log("DEBUG", "Message is not JSON")
                    
            except websockets.exceptions.ConnectionClosed:
                log("WARNING", f"Client {client_addr} disconnected")
                
        # Start server on port 8091 (different from relay)
        server = await websockets.serve(handle_client, "localhost", 8091)
        log("INFO", "Monitoring server started on ws://localhost:8091")
        log("INFO", "Redirect your yohimik client to ws://localhost:8091/websocket to see what it sends")
        
        # Wait for the specified duration
        await asyncio.sleep(duration)
        
    except Exception as e:
        log("ERROR", f"Monitor failed: {e}")

async def simulate_yohimik_server(port=8092):
    """Simulate what a real yohimik server does to see the handshake"""
    log("INFO", f"Starting yohimik server simulator on port {port}")
    
    async def handle_client(websocket, path):
        client_addr = websocket.remote_address
        log("INFO", f"Yohimik client connected from {client_addr}")
        
        try:
            # Maybe send an initial greeting like the real server?
            greeting_options = [
                {"event": "connected", "data": {}},
                {"event": "ready", "data": {}}, 
                {"type": "ready"},
                {"status": "ready"},
                # Try no greeting - just wait
            ]
            
            for i, greeting in enumerate(greeting_options):
                if i > 0:
                    log("INFO", f"Trying greeting option {i+1}: {greeting}")
                    await websocket.send(json.dumps(greeting))
                
                # Wait for client response
                try:
                    response = await asyncio.wait_for(websocket.recv(), timeout=3.0)
                    log("SUCCESS", f"Client responded to greeting {i+1}: {response}")
                    break
                except asyncio.TimeoutError:
                    if i == 0:
                        log("DEBUG", "No response to no-greeting (trying explicit greetings...)")
                    else:
                        log("DEBUG", f"No response to greeting {i+1}")
                        
            # If we get here and still no response, wait longer
            log("INFO", "Waiting for any client message...")
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                log("SUCCESS", f"Finally got message: {message}")
            except asyncio.TimeoutError:
                log("WARNING", "Client never sent any message")
                    
        except websockets.exceptions.ConnectionClosed:
            log("WARNING", f"Client {client_addr} disconnected without sending messages")
            
    server = await websockets.serve(handle_client, "localhost", port)
    log("INFO", f"Yohimik server simulator ready on ws://localhost:{port}")
    return server

async def test_different_endpoints():
    """Test different WebSocket endpoints that yohimik might expect"""
    log("INFO", "Testing different WebSocket endpoint responses")
    
    endpoints = [
        "ws://localhost:8090/websocket",
        "ws://localhost:8090/signal", 
        "ws://localhost:8090/"
    ]
    
    for endpoint in endpoints:
        log("DEBUG", f"Testing endpoint: {endpoint}")
        try:
            async with websockets.connect(endpoint) as ws:
                log("SUCCESS", f"Connected to {endpoint}")
                await asyncio.sleep(1)  # Give it a moment
        except Exception as e:
            log("ERROR", f"Failed to connect to {endpoint}: {e}")

def main():
    parser = argparse.ArgumentParser(description="WebRTC Trigger Debugging Tool")
    parser.add_argument("--relay", default="ws://localhost:8090/websocket", 
                        help="Relay WebSocket URL")
    parser.add_argument("--test-relay", action="store_true",
                        help="Test basic relay connection")
    parser.add_argument("--send-offer", action="store_true", 
                        help="Send WebRTC offer to relay")
    parser.add_argument("--monitor", type=int, default=0,
                        help="Monitor for yohimik connections (seconds)")
    parser.add_argument("--simulate-server", type=int, default=0,
                        help="Run yohimik server simulator on port")
    parser.add_argument("--test-endpoints", action="store_true",
                        help="Test different WebSocket endpoints")
    
    args = parser.parse_args()
    
    if not any([args.test_relay, args.send_offer, args.monitor, 
                args.simulate_server, args.test_endpoints]):
        parser.print_help()
        return
    
    async def run_tests():
        log("INFO", "WebRTC Trigger Debugging Tool Starting")
        log("INFO", "=" * 50)
        
        if args.test_endpoints:
            await test_different_endpoints()
            
        if args.test_relay:
            await test_relay_connection(args.relay)
            
        if args.send_offer:
            await send_webrtc_offer(args.relay)
            
        if args.monitor > 0:
            await monitor_yohimik_connection(args.relay, args.monitor)
            
        if args.simulate_server > 0:
            server = await simulate_yohimik_server(args.simulate_server)
            log("INFO", f"Server running... Press Ctrl+C to stop")
            try:
                await asyncio.Future()  # Run forever
            except KeyboardInterrupt:
                log("INFO", "Stopping server...")
                server.close()
                await server.wait_closed()
    
    try:
        asyncio.run(run_tests())
    except KeyboardInterrupt:
        log("INFO", "Interrupted by user")
    except Exception as e:
        log("ERROR", f"Unexpected error: {e}")

if __name__ == "__main__":
    main()