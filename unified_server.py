#!/usr/bin/env python3
"""
Unified CS1.6 Web Server
Serves yohimik client files AND provides WebRTC relay functionality
This is the single service that hosts everything needed for browser CS1.6
"""

import os, json, asyncio, socket, ipaddress
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from aiortc import RTCPeerConnection, RTCSessionDescription
from prometheus_client import Counter, generate_latest
from pathlib import Path
from pydantic import BaseModel
from typing import Dict, Optional
import uvicorn
import logging
logging.basicConfig(level=logging.INFO)

APP = FastAPI(title="CS1.6 Web - Unified Server")

# CORS for web client
APP.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Metrics
PKT_TO_UDP = Counter("pkt_to_udp_total", "DC->UDP packet count")
PKT_TO_DC  = Counter("pkt_to_dc_total", "UDP->DC packet count")
GO_TO_PYTHON = Counter("go_to_python_total", "Go->Python packet count")
PYTHON_TO_GO = Counter("python_to_go_total", "Python->Go packet count")

# Configuration
ALLOWED_CIDRS = [ipaddress.ip_network(c.strip()) for c in os.getenv("RELAY_ALLOWED_BACKENDS","10.13.13.0/24,127.0.0.0/8").split(",")]
DEFAULT_HOST = os.getenv("RELAY_DEFAULT_BACKEND_HOST","127.0.0.1")
DEFAULT_PORT = int(os.getenv("RELAY_DEFAULT_BACKEND_PORT","27015"))
AUTH_TOKEN = os.getenv("RELAY_AUTH_TOKEN","")
IDLE_SEC = int(os.getenv("RELAY_IDLE_SEC","300"))
CLIENT_DIR = Path(os.getenv("CLIENT_DIR", "/app/client"))

# Multi-server support
SERVER_CONFIGS = {
    "classic": {"host": DEFAULT_HOST, "port": DEFAULT_PORT, "name": "Classic Server"},
    "deathmatch": {"host": DEFAULT_HOST, "port": int(os.getenv("DM_PORT", "27016")), "name": "Deathmatch Server"}
}

# Go WebRTC server communication
go_websocket_connections: Dict[str, WebSocket] = {}
client_connections: Dict[tuple, dict] = {}  # (client_ip tuple) -> {"server", "udp_socket"}

print(f"🐍 Python Relay Server Starting (API Only)")
print(f"🎯 Default backend: {DEFAULT_HOST}:{DEFAULT_PORT}")
for name, config in SERVER_CONFIGS.items():
    print(f"🎮 {config['name']}: {config['host']}:{config['port']}")

# No web client serving - Go server handles that

@APP.get("/metrics")
def metrics():
    return PlainTextResponse(generate_latest().decode("utf-8"), media_type="text/plain")

@APP.get("/health")
def health():
    return {"status": "ok", "service": "cs16-web-unified"}

@APP.get("/heartbeat")
async def heartbeat():
    """Test connectivity to all system components"""
    import time
    start_time = time.time()
    
    results = {
        "timestamp": time.time(),
        "python_relay": {"status": "ok", "response_time": 0},
        "go_webrtc": {"status": "unknown", "response_time": None},
        "rehlds_servers": {}
    }
    
    # Test ReHLDS servers with proper CS1.6 info queries
    for server_name, config in SERVER_CONFIGS.items():
        try:
            # CS1.6 server info query packet
            query_packet = b'\xFF\xFF\xFF\xFF\x54Source Engine Query\x00'
            
            udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            udp_socket.settimeout(2.0)
            
            query_start = time.time()
            udp_socket.sendto(query_packet, (config["host"], config["port"]))
            response, addr = udp_socket.recvfrom(1024)
            query_time = (time.time() - query_start) * 1000
            
            udp_socket.close()
            
            results["rehlds_servers"][server_name] = {
                "status": "ok",
                "response_time": round(query_time, 2),
                "host": config["host"],
                "port": config["port"],
                "response_size": len(response)
            }
        except Exception as e:
            results["rehlds_servers"][server_name] = {
                "status": "error",
                "error": str(e),
                "host": config["host"],
                "port": config["port"],
                "response_time": None
            }
    
    # Test Go WebRTC server
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            go_start = time.time()
            response = await client.get("http://127.0.0.1:8080/", timeout=2.0)
            go_time = (time.time() - go_start) * 1000
            
            results["go_webrtc"] = {
                "status": "ok" if response.status_code == 200 else "error",
                "response_time": round(go_time, 2),
                "status_code": response.status_code
            }
    except Exception as e:
        results["go_webrtc"] = {
            "status": "error",
            "error": str(e),
            "response_time": None
        }
    
    results["python_relay"]["response_time"] = round((time.time() - start_time) * 1000, 2)
    
    return results

@APP.get("/heartbeat-webrtc")
async def heartbeat_webrtc():
    """REAL end-to-end test using actual DataChannels and CS1.6 game packets"""
    import asyncio
    import json
    import time
    from aiortc import RTCPeerConnection, RTCSessionDescription
    from aiortc.contrib.signaling import BYE, add_signaling_arguments, create_signaling
    import websockets
    
    start_time = time.time()
    
    result = {
        "timestamp": time.time(),
        "webrtc_connection": {"status": "unknown", "response_time": None},
        "datachannel_creation": {"status": "unknown", "response_time": None},
        "packet_sending": {"status": "unknown", "response_time": None, "packets_sent": 0},
        "server_response": {"status": "unknown", "response_time": None},
        "metrics_before": {},
        "metrics_after": {},
        "packet_flow": []
    }
    
    # Get metrics before test
    result["metrics_before"] = await fetch_metrics()
    
    pc = None
    try:
        # Create WebRTC peer connection (like the game client does)
        pc = RTCPeerConnection()
        result["packet_flow"].append("✅ Created WebRTC PeerConnection")
        
        # Track when datachannel opens
        datachannel_ready = asyncio.Event()
        write_channel = None
        channels_received = 0
        
        @pc.on("datachannel")
        def on_datachannel(channel):
            nonlocal write_channel, channels_received
            channels_received += 1
            result["packet_flow"].append(f"✅ Received DataChannel: {channel.label}")
            
            @channel.on("open")
            def on_open():
                result["packet_flow"].append(f"✅ DataChannel '{channel.label}' opened")
                if channel.label == "write":
                    nonlocal write_channel
                    write_channel = channel
                    datachannel_ready.set()
                    
            @channel.on("message")
            def on_message(message):
                result["packet_flow"].append(f"✅ Received message on {channel.label}: {len(message)} bytes")
        
        # Connect to Go WebRTC server via WebSocket
        websocket_start = time.time()
        async with websockets.connect('ws://127.0.0.1:8080/signal') as ws:
            result["webrtc_connection"]["status"] = "connected"
            result["webrtc_connection"]["response_time"] = round((time.time() - websocket_start) * 1000, 2)
            result["packet_flow"].append("✅ Connected to Go WebRTC server")
            
            # Receive WebRTC offer
            offer_msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
            offer_data = json.loads(offer_msg)
            
            if offer_data.get("event") == "offer":
                result["packet_flow"].append("✅ Received WebRTC offer")
                
                # Set remote description (the offer from Go server)
                offer_sdp = offer_data["data"]["sdp"]
                await pc.setRemoteDescription(RTCSessionDescription(offer_sdp, "offer"))
                result["packet_flow"].append("✅ Set remote description")
                
                # Create answer
                answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                result["packet_flow"].append("✅ Created WebRTC answer")
                
                # Send answer back to Go server
                answer_msg = {
                    "event": "answer",
                    "data": {
                        "type": "answer",
                        "sdp": pc.localDescription.sdp
                    }
                }
                await ws.send(json.dumps(answer_msg))
                result["packet_flow"].append("✅ Sent answer to Go server")
                
                # Wait for DataChannel to open
                datachannel_start = time.time()
                try:
                    await asyncio.wait_for(datachannel_ready.wait(), timeout=10.0)
                    result["datachannel_creation"]["status"] = "success"
                    result["datachannel_creation"]["response_time"] = round((time.time() - datachannel_start) * 1000, 2)
                    result["packet_flow"].append("✅ DataChannel ready for packet sending")
                    
                    # Now send REAL CS1.6 game packets through the DataChannel!
                    if write_channel:
                        packet_start = time.time()
                        
                        # CS1.6 connection request packet (this is what the game actually sends)
                        cs16_connect_packet = b'\xFF\xFF\xFF\xFF\x67\x65\x74\x63\x68\x61\x6C\x6C\x65\x6E\x67\x65\x20\x73\x74\x65\x61\x6D\x0A'
                        
                        # Send multiple test packets
                        packets_sent = 0
                        for i in range(5):
                            test_packet = cs16_connect_packet + f" test_{i}".encode()
                            write_channel.send(test_packet)
                            packets_sent += 1
                            result["packet_flow"].append(f"✅ Sent CS1.6 packet {i+1}: {len(test_packet)} bytes")
                            await asyncio.sleep(0.1)  # Small delay between packets
                        
                        result["packet_sending"]["status"] = "success"
                        result["packet_sending"]["packets_sent"] = packets_sent
                        result["packet_sending"]["response_time"] = round((time.time() - packet_start) * 1000, 2)
                        
                        # Give time for packets to flow through Go->Python->ReHLDS
                        await asyncio.sleep(2)
                        
                    else:
                        result["packet_sending"]["status"] = "no_write_channel"
                        result["packet_flow"].append("❌ No write DataChannel available")
                        
                except asyncio.TimeoutError:
                    result["datachannel_creation"]["status"] = "timeout"
                    result["packet_flow"].append("❌ DataChannel creation timeout")
                    
            else:
                result["packet_flow"].append(f"❌ Expected offer, got: {offer_data.get('event')}")
                
    except Exception as e:
        result["packet_flow"].append(f"❌ WebRTC error: {str(e)}")
        import traceback
        result["packet_flow"].append(f"❌ Traceback: {traceback.format_exc()}")
    
    finally:
        if pc:
            await pc.close()
    
    # Check metrics after test
    result["metrics_after"] = await fetch_metrics()
    
    # Compare metrics
    before_go_python = result["metrics_before"].get("go_to_python_total", 0)
    after_go_python = result["metrics_after"].get("go_to_python_total", 0)
    before_python_go = result["metrics_before"].get("python_to_go_total", 0)
    after_python_go = result["metrics_after"].get("python_to_go_total", 0)
    
    if after_go_python > before_go_python:
        result["server_response"]["status"] = "packets_flowing"
        result["packet_flow"].append(f"✅ Go→Python: {before_go_python} → {after_go_python}")
        
        if after_python_go > before_python_go:
            result["packet_flow"].append(f"✅ Python→Go: {before_python_go} → {after_python_go}")
            result["server_response"]["status"] = "full_pipeline_working"
        else:
            result["packet_flow"].append(f"⚠️ Python→Go still 0: {before_python_go} → {after_python_go}")
            result["server_response"]["status"] = "one_way_only"
    else:
        result["server_response"]["status"] = "no_packets"
        result["packet_flow"].append(f"❌ No packet flow detected: Go→Python {before_go_python} → {after_go_python}")
    
    result["total_time"] = round((time.time() - start_time) * 1000, 2)
    
    return result

async def fetch_metrics():
    """Helper to fetch and parse Prometheus metrics"""
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.get("http://127.0.0.1:3000/metrics", timeout=5.0)
            metrics_text = response.text
            
            metrics = {}
            for line in metrics_text.split('\n'):
                if line.startswith('#') or not line.strip():
                    continue
                match = line.split()
                if len(match) >= 2:
                    key = match[0]
                    try:
                        value = float(match[1])
                        metrics[key] = value
                    except ValueError:
                        pass
            
            return metrics
    except Exception:
        return {}

# Models for Go communication
class GamePacket(BaseModel):
    client_ip: list  # [4]byte from Go becomes list in Python
    data: bytes

class ServerSelection(BaseModel):
    server_name: str = "classic"

@APP.get("/servers")
def list_servers():
    """List available game servers"""
    return {"servers": SERVER_CONFIGS}

@APP.post("/game-packet")
async def receive_packet_from_go(packet: GamePacket, request: Request):
    """Receive game packets from Go WebRTC server"""
    GO_TO_PYTHON.inc()
    
    client_ip = tuple(packet.client_ip)
    client_id = f"{client_ip[0]}.{client_ip[1]}.{client_ip[2]}.{client_ip[3]}"
    
    print(f"[HYBRID] Received packet from Go client {client_id}: {len(packet.data)} bytes")
    # Show packet hex for debugging
    if len(packet.data) > 0:
        hex_preview = ' '.join(f'{b:02x}' for b in packet.data[:16])
        print(f"[HYBRID] 📦 Packet hex: {hex_preview}{'...' if len(packet.data) > 16 else ''}")
    
    # Get or create client connection info
    if client_ip not in client_connections:
        # Default to classic server, but this could be configurable per client
        server_config = SERVER_CONFIGS["classic"]
        udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp_socket.bind(("0.0.0.0", 0))
        udp_socket.setblocking(False)
        
        client_connections[client_ip] = {
            "server": server_config,
            "udp_socket": udp_socket,
            "last_activity": asyncio.get_event_loop().time()
        }
        
        print(f"[HYBRID] Created new UDP connection for {client_id} -> {server_config['host']}:{server_config['port']}")
        
        # Start UDP reader for this client
        asyncio.create_task(udp_reader_for_client(client_ip))
    
    conn_info = client_connections[client_ip]
    conn_info["last_activity"] = asyncio.get_event_loop().time()
    
    # Forward packet to appropriate game server
    try:
        server = conn_info["server"]
        udp_socket = conn_info["udp_socket"]
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, udp_socket.sendto, packet.data, (server["host"], server["port"]))
        
        PKT_TO_UDP.inc()
        print(f"[HYBRID] Forwarded to {server['name']}: {len(packet.data)} bytes")
        
    except Exception as e:
        print(f"[HYBRID] Error forwarding packet: {e}")
        return {"error": "Failed to forward packet"}
    
    return {"status": "ok"}

def backend_allowed(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
        return any(ip in net for net in ALLOWED_CIDRS)
    except Exception:
        return False

@APP.websocket("/ws-from-go")
async def websocket_from_go(websocket: WebSocket):
    """WebSocket endpoint for Go WebRTC server to receive responses"""
    await websocket.accept()
    
    connection_id = f"go_{id(websocket)}"
    go_websocket_connections[connection_id] = websocket
    
    print(f"[HYBRID] Go WebRTC server connected: {connection_id}")
    
    try:
        while True:
            # Keep connection alive and handle any messages from Go
            data = await websocket.receive_text()
            print(f"[HYBRID] Received message from Go: {data}")
    except WebSocketDisconnect:
        print(f"[HYBRID] Go WebRTC server disconnected: {connection_id}")
        del go_websocket_connections[connection_id]
    except Exception as e:
        print(f"[HYBRID] Error in Go WebSocket: {e}")
        if connection_id in go_websocket_connections:
            del go_websocket_connections[connection_id]

async def udp_reader_for_client(client_ip: tuple):
    """Read UDP responses and send back to Go WebRTC server"""
    client_id = f"{client_ip[0]}.{client_ip[1]}.{client_ip[2]}.{client_ip[3]}"
    print(f"[HYBRID] Starting UDP reader for client {client_id}")
    
    conn_info = client_connections[client_ip]
    udp_socket = conn_info["udp_socket"]
    loop = asyncio.get_event_loop()
    
    while client_ip in client_connections:
        try:
            # Read from UDP socket
            data, addr = await loop.run_in_executor(None, udp_socket.recvfrom, 2048)
            conn_info["last_activity"] = loop.time()
            
            print(f"[HYBRID] UDP response for {client_id}: {len(data)} bytes from {addr}")
            
            # Send back to Go WebRTC server via WebSocket
            response_packet = {
                "client_ip": list(client_ip),
                "data": list(data)  # Convert bytes to list for JSON
            }
            
            # Send to all connected Go servers (usually just one)
            for ws_connection in go_websocket_connections.values():
                try:
                    await ws_connection.send_json(response_packet)
                    PYTHON_TO_GO.inc()
                    print(f"[HYBRID] Sent response back to Go for {client_id}")
                except Exception as e:
                    print(f"[HYBRID] Error sending to Go: {e}")
                    
        except socket.error:
            # No data available, check for timeout
            if loop.time() - conn_info["last_activity"] > IDLE_SEC:
                print(f"[HYBRID] Client {client_id} timed out, cleaning up")
                break
            await asyncio.sleep(0.001)
        except Exception as e:
            print(f"[HYBRID] Error in UDP reader for {client_id}: {e}")
            await asyncio.sleep(0.001)
    
    # Cleanup
    if client_ip in client_connections:
        try:
            conn_info["udp_socket"].close()
        except:
            pass
        del client_connections[client_ip]
        print(f"[HYBRID] Cleaned up client {client_id}")

@APP.post("/select-server")
async def select_server(selection: ServerSelection, client_ip: str):
    """Allow clients to select which game server to connect to"""
    if selection.server_name not in SERVER_CONFIGS:
        return {"error": "Invalid server name"}
    
    # This would be used to change server for a specific client
    # Implementation depends on how we identify clients from Go
    return {"status": "ok", "server": SERVER_CONFIGS[selection.server_name]}

@APP.websocket("/websocket")
@APP.websocket("/signal") 
async def webrtc_relay(ws: WebSocket):
    """Unified WebRTC relay for yohimik clients"""
    await ws.accept()
    print(f"[RELAY] WebSocket connected from {ws.client}")
    
    # Server-initiated WebRTC (yohimik expects this)
    print(f"[RELAY] Creating server-initiated WebRTC offer...")
    
    pc = RTCPeerConnection()
    dc_ready = asyncio.get_event_loop().create_future()

    # Create DataChannels (yohimik expects 'read' and 'write')
    dc_write = pc.createDataChannel('write', ordered=False, maxRetransmits=0)
    dc_read = pc.createDataChannel('read', ordered=False, maxRetransmits=0)
    
    print(f"[RELAY] Created DataChannels: write and read")

    @dc_read.on("open")
    def on_dc_read_open():
        print(f"[RELAY] Read DataChannel opened")
        dc_ready.set_result(dc_read)
        
    @dc_write.on("open") 
    def on_dc_write_open():
        print(f"[RELAY] Write DataChannel opened")

    # Create and send offer to client
    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    
    offer_msg = {
        "event": "offer", 
        "data": {
            "type": "offer",
            "sdp": pc.localDescription.sdp
        }
    }
    
    print(f"[RELAY] Sending offer to client...")
    await ws.send_text(json.dumps(offer_msg))
    
    # Wait for client answer
    try:
        print(f"[RELAY] Waiting for client answer...")
        answer_text = await asyncio.wait_for(ws.receive_text(), timeout=10.0)
        answer_msg = json.loads(answer_text)
        print(f"[RELAY] Received: {answer_msg.get('event', 'unknown')}")
        
        if answer_msg.get("event") != "answer":
            print(f"[RELAY] Expected 'answer', got '{answer_msg.get('event')}'")
            await ws.close(code=4400)
            return
            
        # Set remote description from client answer
        webrtc_answer = answer_msg.get("data", {})
        await pc.setRemoteDescription(RTCSessionDescription(webrtc_answer["sdp"], "answer"))
        print(f"[RELAY] Set remote description from client answer")
        
    except asyncio.TimeoutError:
        print(f"[RELAY] Timeout waiting for answer")
        await ws.close(code=4408)
        return
    except Exception as e:
        print(f"[RELAY] Failed to process answer: {e}")
        await ws.close(code=4400)
        return

    # ICE candidate handling
    async def ice_loop():
        while True:
            try:
                msg_text = await ws.receive_text()
                msg = json.loads(msg_text)
                print(f"[RELAY] Received ICE message: {msg.get('event', 'unknown')}")
                
                if msg.get("event") == "candidate" and "data" in msg:
                    candidate_data = msg["data"]
                    if "candidate" in candidate_data:
                        try:
                            await pc.addIceCandidate(candidate_data["candidate"])
                            print(f"[RELAY] Added ICE candidate")
                        except Exception as e:
                            print(f"[RELAY] Failed to add ICE candidate: {e}")
            except WebSocketDisconnect:
                print(f"[RELAY] WebSocket disconnected")
                break
            except Exception as e:
                print(f"[RELAY] ICE loop error: {e}")
                await asyncio.sleep(0.01)

    asyncio.create_task(ice_loop())

    print(f"[RELAY] Waiting for DataChannel...")
    dc = await dc_ready
    print(f"[RELAY] DataChannel ready, setting up UDP bridge to {DEFAULT_HOST}:{DEFAULT_PORT}")
    
    # UDP bridge setup
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.bind(("0.0.0.0", 0))  # Unique ephemeral port per session
    udp.setblocking(False)
    loop = asyncio.get_running_loop()
    last = loop.time()

    print(f"[RELAY] UDP socket bound to local port {udp.getsockname()[1]}")
    print(f"[RELAY] 📊 Waiting for game traffic...")
    print(f"[RELAY] 🎮 Client should now be able to send game packets")

    # DataChannel -> UDP (client to server)
    @dc_write.on("message")
    async def on_dc_write_message(message):
        nonlocal last
        last = loop.time()
        PKT_TO_UDP.inc()
        try:
            if hasattr(message, 'tobytes'):
                data = message.tobytes()
            elif isinstance(message, bytes):
                data = message
            elif isinstance(message, memoryview):
                data = bytes(message)
            else:
                print(f"[RELAY] ❌ Unexpected message type: {type(message)}")
                return
                
            print(f"[RELAY] 🎯 DC->UDP: {len(data)} bytes → {DEFAULT_HOST}:{DEFAULT_PORT}")
            if len(data) > 0:
                # Show first few bytes for debugging
                hex_preview = ' '.join(f'{b:02x}' for b in data[:8])
                print(f"[RELAY] 📦 Data preview: {hex_preview}...")
            await loop.run_in_executor(None, udp.sendto, data, (DEFAULT_HOST, DEFAULT_PORT))
        except Exception as e:
            print(f"[RELAY] ❌ Error forwarding DC->UDP: {e}")

    # UDP -> DataChannel (server to client)
    async def udp_reader():
        nonlocal last
        while True:
            try:
                data, addr = await loop.run_in_executor(None, udp.recvfrom, 2048)
                last = loop.time()
                PKT_TO_DC.inc()
                print(f"[RELAY] 🎮 UDP->DC: {len(data)} bytes from {addr}")
                
                if dc_read.readyState == "open":
                    if hasattr(dc_read, 'bufferedAmount') and dc_read.bufferedAmount > 256 * 1024:
                        print(f"[RELAY] ⚠️ DataChannel buffer full, dropping packet")
                        continue
                    
                    # Show server response data for debugging
                    if len(data) > 0:
                        hex_preview = ' '.join(f'{b:02x}' for b in data[:8])
                        print(f"[RELAY] 📦 Server response preview: {hex_preview}...")
                    
                    await dc_read.send(data)
                else:
                    print(f"[RELAY] Read DataChannel not open: {dc_read.readyState}")
                    break
            except Exception as e:
                print(f"[RELAY] Error in UDP reader: {e}")
                await asyncio.sleep(0.001)

    async def idle_watch():
        while True:
            await asyncio.sleep(1.0)
            if loop.time() - last > IDLE_SEC:
                try:
                    await dc_read.close()
                    await dc_write.close()
                except Exception:
                    pass
                break

    await asyncio.gather(udp_reader(), idle_watch())

if __name__ == "__main__":
    port = int(os.getenv("PORT", "3000"))  # Changed default port to 3000
    print(f"🌐 Starting hybrid Python server on port {port}")
    print(f"🎮 Web client: http://localhost:{port}/")
    print(f"🔗 Legacy WebRTC relay: ws://localhost:{port}/websocket")
    print(f"🚀 Go WebRTC communication:")
    print(f"   • HTTP packets: POST http://localhost:{port}/game-packet")
    print(f"   • WebSocket responses: ws://localhost:{port}/ws-from-go")
    print(f"📊 Metrics: http://localhost:{port}/metrics")
    print(f"🎯 Available servers: http://localhost:{port}/servers")
    
    uvicorn.run(APP, host="0.0.0.0", port=port)