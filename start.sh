#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash scripts/generate-fixtures.sh
echo
echo "Library Listen is an iOS/iPadOS app."
echo "Open LibraryListen.xcodeproj in Xcode, pick an iPhone or iPad, press Run."
echo
echo "On device: Files → iCloud Drive → … → Library"
echo "  Munroe: .../Library/門羅-WhatIf/listen"
echo "  Immune: .../Library/Immune/listen  (Immune-Part01.mp3 … Part09.mp3)"
if command -v open >/dev/null && [[ "$(uname)" == Darwin ]]; then
  open LibraryListen.xcodeproj
fi