#!/usr/bin/env python3
"""
Test CS1.6 server connection to validate the packet pipeline
Sends A2S_INFO query directly to the CS server to trigger UDP traffic
"""

import socket
import struct
import time

def test_cs16_server():
    print("🎮 Testing CS1.6 server connection...")
    
    # A2S_INFO query packet (CS1.6/Source protocol)  
    # This should start with 0xFFFFFFFF (4 bytes of 0xFF)
    query = b'\xFF\xFF\xFF\xFF'  # connectionless header
    query += b'TSource Engine Query\x00'  # A2S_INFO query
    
    print(f"📦 Sending A2S_INFO query: {query.hex()}")
    print(f"🔍 First 4 bytes: {query[:4].hex()} (should be FFFFFFFF)")
    
    try:
        # Connect to CS server directly
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(5.0)
        
        server_host = "localhost"
        server_port = 27015
        
        print(f"📡 Sending to {server_host}:{server_port}")
        sock.sendto(query, (server_host, server_port))
        
        # Wait for response
        response, addr = sock.recvfrom(1024)
        print(f"✅ Received response from {addr}")
        print(f"📦 Response length: {len(response)} bytes")
        print(f"🔍 Response header: {response[:10].hex()}")
        
        # Parse basic server info if it's a valid response
        if response[:4] == b'\xFF\xFF\xFF\xFF':
            print("✅ Valid connectionless response header")
            if len(response) > 6:
                print(f"📝 Server response type: {response[4:5].hex()}")
        else:
            print("⚠️  Unexpected response format")
            
    except socket.timeout:
        print("❌ Server did not respond within 5 seconds")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        sock.close()

def test_relay_pipeline():
    print("\n🔄 Testing relay pipeline...")
    
    # Test the /game-packet endpoint that Go server uses to send packets to Python
    import json
    import requests
    
    # Simulate a packet that Go would send to Python
    test_packet = {
        "client_ip": [192, 168, 1, 100],  # dummy client IP
        "data": list(b'\xFF\xFF\xFF\xFF' + b'TSource Engine Query\x00')  # same A2S query as bytes
    }
    
    try:
        response = requests.post(
            "http://localhost:3000/game-packet",
            json=test_packet,
            timeout=5
        )
        print(f"📡 Sent packet to relay: {response.status_code}")
        
        # Check metrics after sending
        metrics_response = requests.get("http://localhost:3000/metrics", timeout=5)
        metrics = metrics_response.text
        
        # Look for updated counters
        for line in metrics.split('\n'):
            if 'pkt_to_udp_total' in line or 'go_to_python_total' in line:
                print(f"📊 {line}")
                
    except Exception as e:
        print(f"❌ Relay test failed: {e}")

if __name__ == "__main__":
    test_cs16_server()
    test_relay_pipeline()
    
    print("\n" + "="*50)
    print("💡 SUMMARY:")
    print("This test validates that:")
    print("1. CS1.6 server responds to direct UDP queries")
    print("2. Packets start with FF FF FF FF header (as ChatGPT5 mentioned)")
    print("3. The relay pipeline can forward packets to the server")
    print("="*50)