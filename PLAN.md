# PLAN — Browser CS1.6 + WebRTC Relay on DigitalOcean

## Goal
Run a browser-based CS 1.6 client (webXash3D) that connects to a real ReHLDS server on your home LAN through a WebRTC→UDP relay hosted on a DigitalOcean Droplet. One repo: **client**, **relay**, **server**, plus scripts for provisioning and deploy.

## Architecture
- **Client (WASM)** served via Caddy at `https://relay.example.com/client/`.
- **Relay (Python aiortc + FastAPI)** exposes `/signal` for WebRTC, bridges DataChannel↔UDP.
- **WireGuard** tunnel from Droplet→home LAN; relay targets game server via WG IP.
- **ReHLDS** runs on home machine (or local test) via Docker, ports 27015/27016, host networking.

## Flow
1) Player opens dashboard: `https://relay.example.com/`.
2) Clicks a server; deep-link opens `/client/?signal=wss://relay.../signal&host=10.13.13.2&port=27015&token=...`.
3) `bootstrap.js` establishes WebRTC DC, engine networking hooks send/recv via DC.
4) Relay forwards DC bytes to UDP (backend WG IP:port) and back.

## Deliverables
- `client/` — index, bootstrap, assets folder for your webXash build.
- `relay/` — aiortc FastAPI POC with `/signal`, `/metrics` and UDP bridge.
- `server/rehlds/` — compose + minimal configs for two CS servers (27015/27016).
- `local-test/` — **local end-to-end compose** (relay + ReHLDS on same host) for quick testing.
- Root `docker-compose.yml` — Caddy, WireGuard, Relay on the Droplet.
- `scripts/` — DigitalOcean provisioning (cloud-init), WireGuard keys helper, deploy script.

## Next steps
- Drop your WASM client bundle into `client/assets/` and wire its networking to the DC.
- For quick E2E: run `local-test/docker-compose.yml` on a single host and visit the deep-link URL.
- For prod: configure WireGuard on VPS ↔ home server, update `.env` with WG IPs, point DNS to Droplet IPv4.
