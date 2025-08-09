#!/usr/bin/env bash
set -euo pipefail
docker compose build
docker compose up -d
docker compose ps
