#!/usr/bin/env bash
set -euo pipefail
mkdir -p wg
cd wg
wg genkey | tee privatekey | wg pubkey > publickey
echo "Private key: $(cat privatekey)"
echo "Public  key: $(cat publickey)"
echo "Create wg0.conf here using your home WireGuard server peer config."
