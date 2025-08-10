# CS1.6 Web — Client + Relay + Server

This repository hosts a **browser-based Counter-Strike 1.6 client** and a **WebRTC→UDP relay**. It also includes **ReHLDS docker configs** and a **local end-to-end test**.

## What’s included
- `client/` — static web client with deep linking (put your webXash3D WASM bundle in `assets/`).
- `relay/` — Python **aiortc** relay POC (FastAPI, `/signal`, `/metrics`).
- `server/rehlds/` — two ReHLDS servers (27015/27016) for your home/lab.
- `local-test/` — **run relay + ReHLDS on one machine** to validate E2E without WireGuard.
- `docker-compose.yml` — Caddy (TLS + static), WireGuard, Relay for the droplet.
- `scripts/` — DO droplet bootstrap, deploy helpers, WG keygen.

## Quick start (local E2E)
1. Start services: `docker compose -f local-test/docker-compose.yml up -d --build`
2. Start client dev server: `cd client && npm install && npm run dev`
3. Open web client: `http://localhost:5173/client/?signal=ws://localhost:8090/signal&host=127.0.0.1&port=27015&transport=webrtc`
4. Steam client: open console and run `connect 127.0.0.1:27015`

## Quick start (Droplet prod)
1. Copy `.env.example` → `.env` and edit values (`DOMAIN`, backend WG subnet, default host/port).
2. Provision a Droplet (SFO3 recommended). Add DNS A record (Cloudflare OK for HTTPS only).
3. Put your WireGuard **peer** as `./wg/wg0.conf` (see `scripts/generate_wireguard_keys.sh`).
4. SSH to the droplet and run `./scripts/deploy.sh`.
5. Deep-link to join:
```
https://YOUR_DOMAIN/client/?signal=wss://YOUR_DOMAIN/signal&host=10.13.13.2&port=27015&token=YOURTOKEN&transport=webrtc
```

## Notes
- WireGuard removes the need for socat or TURN in typical cases.
- WebSocket fallback can be added later if users sit behind UDP-hostile networks.
- Mods (AMX/CSDM) are server-side; browser UI-heavy plugins may need client-side care in WASM.
