#!/bin/sh
# Copies the relay protocol shared with the iPhone app. Run after changing it in RunesIOS.
# `--check` only reports drift (used by the native tests when the sibling checkout exists).
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
ios=${RUNES_IOS_ROOT:-$here/../runes_ios}
dest=$here/native/phone-link/Shared
for name in RelayWire.swift RelayKeyStore.swift; do
  source=$ios/RunesIOS/Relay/$name
  if [ ! -f "$source" ]; then
    [ "${1:-}" = "--check" ] && { echo "RunesIOS not found; skipping relay drift check"; exit 0; }
    echo "Missing $source (set RUNES_IOS_ROOT)" >&2; exit 1
  fi
  if [ "${1:-}" = "--check" ]; then
    cmp -s "$source" "$dest/$name" || { echo "$name differs from RunesIOS. Run scripts/sync-relay-wire.sh" >&2; exit 1; }
  else
    cp "$source" "$dest/$name"
  fi
done
[ "${1:-}" = "--check" ] && echo "Relay protocol matches RunesIOS" || echo "Copied relay protocol from $ios"
