#!/usr/bin/env bash
set -euo pipefail
NAME="${1:-cs16-relay}"
REGION="${2:-sfo3}"
SIZE="${3:-s-1vcpu-1gb}"
IMAGE="${4:-ubuntu-24-04-x64}"
SSHKEY="${DO_SSH_KEY_ID:-$(doctl compute ssh-key list --format ID --no-header | head -n1)}"

doctl compute droplet create "$NAME"   --region "$REGION"   --size "$SIZE"   --image "$IMAGE"   --ssh-keys "$SSHKEY"   --user-data-file scripts/do_user_data.cloudinit   --tag-names cs16,relay   --enable-private-networking   --wait

doctl compute droplet list | grep "$NAME"
