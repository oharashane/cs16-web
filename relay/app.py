import os, json, asyncio, socket, ipaddress
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from aiortc import RTCPeerConnection, RTCSessionDescription
from prometheus_client import Counter, generate_latest

APP = FastAPI()
APP.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("RELAY_ALLOWED_ORIGINS","*").split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PKT_TO_UDP = Counter("pkt_to_udp_total", "DC->UDP packet count")
PKT_TO_DC  = Counter("pkt_to_dc_total", "UDP->DC packet count")

ALLOWED_CIDRS = [ipaddress.ip_network(c.strip()) for c in os.getenv("RELAY_ALLOWED_BACKENDS","10.13.13.0/24").split(",")]
WS_PATH = os.getenv("RELAY_WS_PATH","/signal")
DEFAULT_HOST = os.getenv("RELAY_DEFAULT_BACKEND_HOST","10.13.13.2")
DEFAULT_PORT = int(os.getenv("RELAY_DEFAULT_BACKEND_PORT","27015"))
AUTH_TOKEN = os.getenv("RELAY_AUTH_TOKEN","")
IDLE_SEC = int(os.getenv("RELAY_IDLE_SEC","300"))

@APP.get("/metrics")
def metrics():
    return PlainTextResponse(generate_latest().decode("utf-8"), media_type="text/plain")

def backend_allowed(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
        return any(ip in net for net in ALLOWED_CIDRS)
    except Exception:
        return False

@APP.websocket(WS_PATH)
async def signal(ws: WebSocket):
    await ws.accept()
    try:
        hello = json.loads(await ws.receive_text())
    except Exception:
        await ws.close(code=4400); return

    if AUTH_TOKEN and hello.get("token") != AUTH_TOKEN:
        await ws.close(code=4403); return

    backend = (hello.get("backend") or {})
    host = backend.get("host") or DEFAULT_HOST
    port = int(backend.get("port") or DEFAULT_PORT)
    if not backend_allowed(host):
        await ws.close(code=4403); return

    await ws.send_text(json.dumps({"type":"ready"}))

    offer_msg = json.loads(await ws.receive_text())
    if offer_msg.get("type") != "offer":
        await ws.close(code=4400); return

    pc = RTCPeerConnection()
    dc_ready = asyncio.get_event_loop().create_future()

    @pc.on("datachannel")
    def on_datachannel(dc):
        dc.binaryType = "bytes"
        dc_ready.set_result(dc)

    await pc.setRemoteDescription(RTCSessionDescription(offer_msg["sdp"], "offer"))
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await ws.send_text(json.dumps({"type":"answer", "sdp": pc.localDescription.sdp}))

    async def ice_loop():
        while True:
            try:
                msg = json.loads(await ws.receive_text())
                if msg.get("type") == "ice" and "candidate" in msg:
                    try:
                        await pc.addIceCandidate(msg["candidate"])
                    except Exception:
                        pass
            except WebSocketDisconnect:
                break
            except Exception:
                await asyncio.sleep(0.01)

    asyncio.create_task(ice_loop())

    dc = await dc_ready
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.setblocking(False)
    loop = asyncio.get_running_loop()
    last = loop.time()

    async def dc_reader():
        nonlocal last
        while True:
            data = await dc.recv()  # bytes
            last = loop.time()
            PKT_TO_UDP.inc()
            try:
                udp.sendto(data, (host, port))
            except Exception:
                pass

    async def udp_reader():
        nonlocal last
        while True:
            try:
                data, _ = await loop.run_in_executor(None, udp.recvfrom, 2048)
                last = loop.time()
                PKT_TO_DC.inc()
                await dc.send(data)
            except Exception:
                await asyncio.sleep(0.001)

    async def idle_watch():
        while True:
            await asyncio.sleep(1.0)
            if loop.time() - last > IDLE_SEC:
                try:
                    await dc.close()
                except Exception:
                    pass
                break

    await asyncio.gather(dc_reader(), udp_reader(), idle_watch())
