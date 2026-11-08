#!/bin/sh
# Copies the relay protocol shared with the iPhone app. Run after changing it in NeuralIOS.
# `--check` only reports drift (used by the native tests when the sibling checkout exists).
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
ios=${NEURAL_IOS_ROOT:-$here/../NeuralIOS}
dest=$here/native/phone-link/Shared
for name in RelayWire.swift RelayKeyStore.swift; do
  source=$ios/NeuralIOS/Relay/$name
  if [ ! -f "$source" ]; then
    [ "${1:-}" = "--check" ] && { echo "NeuralIOS not found; skipping relay drift check"; exit 0; }
    echo "Missing $source (set NEURAL_IOS_ROOT)" >&2; exit 1
  fi
  if [ "${1:-}" = "--check" ]; then
    cmp -s "$source" "$dest/$name" || { echo "$name differs from NeuralIOS. Run scripts/sync-relay-wire.sh" >&2; exit 1; }
  else
    cp "$source" "$dest/$name"
  fi
done
[ "${1:-}" = "--check" ] && echo "Relay protocol matches NeuralIOS" || echo "Copied relay protocol from $ios"
