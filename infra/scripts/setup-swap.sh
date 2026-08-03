#!/usr/bin/env bash
# Swapfile de 4 GB + vm.swappiness=10 persistente (ADR-077, orçamento de memória t3.medium).
# Idempotente e convergente: swapfile de tamanho diferente (ex.: os 2 GB antigos) é recriado.
set -euo pipefail

SWAPFILE="/swapfile"
SIZE_GB=4
TARGET_BYTES=$((SIZE_GB * 1024 * 1024 * 1024))
SYSCTL_FILE="/etc/sysctl.d/99-cerebro-swappiness.conf"

log() { echo "[setup-swap] $*"; }

CURRENT_BYTES=$(stat -c %s "$SWAPFILE" 2>/dev/null || echo 0)

if [ "$CURRENT_BYTES" -eq "$TARGET_BYTES" ]; then
  log "swapfile já tem ${SIZE_GB}G — ok"
else
  if [ "$CURRENT_BYTES" -gt 0 ]; then
    log "swapfile existente com $((CURRENT_BYTES / 1024 / 1024))M — recriando com ${SIZE_GB}G"
  else
    log "criando swapfile de ${SIZE_GB}G"
  fi
  swapoff "$SWAPFILE" 2>/dev/null || true
  rm -f "$SWAPFILE"
  dd if=/dev/zero of="$SWAPFILE" bs=1M count=$((SIZE_GB * 1024)) status=none
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE" >/dev/null
fi

if swapon --show=NAME --noheadings | grep -qx "$SWAPFILE"; then
  log "swap já ativo — ok"
else
  swapon "$SWAPFILE"
  log "swap ativado"
fi

if grep -qE "^$SWAPFILE[[:space:]]" /etc/fstab; then
  log "fstab: entrada já existe — ok"
else
  echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
  log "fstab: entrada adicionada"
fi

if [ -f "$SYSCTL_FILE" ] && grep -qx "vm.swappiness=10" "$SYSCTL_FILE"; then
  log "swappiness já persistido — ok"
else
  echo "vm.swappiness=10" > "$SYSCTL_FILE"
  log "swappiness=10 persistido em $SYSCTL_FILE"
fi
sysctl -q -p "$SYSCTL_FILE"
log "concluído (vm.swappiness=$(cat /proc/sys/vm/swappiness))"
