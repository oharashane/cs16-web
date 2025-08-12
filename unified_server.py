#!/usr/bin/env python3
"""
Unified CS1.6 Web Server
Serves yohimik client files AND provides WebRTC relay functionality
This is the single service that hosts everything needed for browser CS1.6
"""

import os, json, asyncio, socket, ipaddress
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from aiortc import RTCPeerConnection, RTCSessionDescription
from prometheus_client import Counter, generate_latest
from pathlib import Path
import uvicorn

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

# Configuration
ALLOWED_CIDRS = [ipaddress.ip_network(c.strip()) for c in os.getenv("RELAY_ALLOWED_BACKENDS","10.13.13.0/24,127.0.0.0/8").split(",")]
DEFAULT_HOST = os.getenv("RELAY_DEFAULT_BACKEND_HOST","127.0.0.1")
DEFAULT_PORT = int(os.getenv("RELAY_DEFAULT_BACKEND_PORT","27015"))
AUTH_TOKEN = os.getenv("RELAY_AUTH_TOKEN","")
IDLE_SEC = int(os.getenv("RELAY_IDLE_SEC","300"))
CLIENT_DIR = Path(os.getenv("CLIENT_DIR", "/app/client"))

print(f"🎮 CS1.6 Web Server Starting")
print(f"📁 Client files: {CLIENT_DIR}")
print(f"🎯 Default backend: {DEFAULT_HOST}:{DEFAULT_PORT}")

# Mount static files for web client
if CLIENT_DIR.exists():
    APP.mount("/assets", StaticFiles(directory=CLIENT_DIR / "assets"), name="assets")
    print(f"✅ Mounted client assets")
else:
    print(f"⚠️  Client directory not found: {CLIENT_DIR}")

@APP.get("/")
async def serve_index():
    """Serve the main HTML file"""
    index_path = CLIENT_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"error": "Client not available", "status": "relay-only"}

@APP.get("/valve.zip")
async def serve_valve_zip():
    """Serve the game assets"""
    valve_path = CLIENT_DIR / "valve.zip" 
    if valve_path.exists():
        return FileResponse(valve_path)
    return {"error": "valve.zip not found"}

@APP.get("/favicon.ico")
async def serve_favicon():
    """Serve favicon"""
    favicon_path = CLIENT_DIR / "assets" / "favicon-DRK6xunG.png"
    if favicon_path.exists():
        return FileResponse(favicon_path)
    return {"error": "favicon not found"}

@APP.get("/metrics")
def metrics():
    return PlainTextResponse(generate_latest().decode("utf-8"), media_type="text/plain")

@APP.get("/health")
def health():
    return {"status": "ok", "service": "cs16-web-unified"}

def backend_allowed(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
        return any(ip in net for net in ALLOWED_CIDRS)
    except Exception:
        return False

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
    port = int(os.getenv("PORT", "8090"))
    print(f"🌐 Starting unified server on port {port}")
    print(f"🎮 Web client: http://localhost:{port}/")
    print(f"🔗 WebRTC relay: ws://localhost:{port}/websocket")
    
    uvicorn.run(APP, host="0.0.0.0", port=port)