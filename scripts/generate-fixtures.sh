#!/usr/bin/env bash
# Silent stubs only — never copy copyrighted Hub audio into git.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/LibraryListen/Fixtures"
rm -rf "$OUT"
mkdir -p \
  "$OUT/門羅-WhatIf/listen/what-if-1" \
  "$OUT/門羅-WhatIf/listen/how-to" \
  "$OUT/門羅-WhatIf/listen/what-if-2" \
  "$OUT/Immune/listen"

make_mp3() {
  local dest="$1"
  ffmpeg -y -f lavfi -i anullsrc=r=22050:cl=mono -t 2.5 -c:a libmp3lame -b:a 16k "$dest" >/dev/null 2>&1
}

make_mp3 "$OUT/門羅-WhatIf/listen/what-if-1/01 - Introduction.mp3"
make_mp3 "$OUT/門羅-WhatIf/listen/what-if-1/02 - Global Windstorm.mp3"
make_mp3 "$OUT/門羅-WhatIf/listen/how-to/001 - How To Absurd Scientific Advice.mp3"
make_mp3 "$OUT/門羅-WhatIf/listen/how-to/002 - How To Jump Really High.mp3"

for i in 01 02 03 04 05 06 07 08 09; do
  make_mp3 "$OUT/Immune/listen/Immune-Part${i}.mp3"
done

TMP="$(mktemp -d)"
ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 6 -c:a aac -b:a 24k "$TMP/silent.m4a" >/dev/null 2>&1
cat > "$TMP/chapters.txt" <<'EOF'
;FFMETADATA1
title=What If 2 (fixture)
[CHAPTER]
TIMEBASE=1/1000
START=0
END=2000
title=01 - The Sun
[CHAPTER]
TIMEBASE=1/1000
START=2000
END=4000
title=02 - A Mole of Moles
[CHAPTER]
TIMEBASE=1/1000
START=4000
END=6000
title=03 - Hair Dryer
EOF
ffmpeg -y -i "$TMP/silent.m4a" -i "$TMP/chapters.txt" -map_metadata 1 -codec copy \
  "$OUT/門羅-WhatIf/listen/what-if-2/What If 2 - Randall Munroe.m4b" >/dev/null 2>&1
rm -rf "$TMP"

ffmpeg -y -f lavfi -i color=c=0x2a2015:s=1024x1024 -frames:v 1 \
  "$ROOT/LibraryListen/Assets.xcassets/AppIcon.appiconset/AppIcon.png" >/dev/null 2>&1

cat > "$OUT/README.txt" <<'EOF'
Silent stubs only. Same shape as the Mac Hub Library folder:

  Library/門羅-WhatIf/listen/{what-if-1,how-to,what-if-2}
  Library/Immune/listen/Immune-Part01.mp3 … Immune-Part09.mp3

Never replace these with copyrighted Hub audio.
EOF

echo "Wrote silent fixtures (Library/門羅-WhatIf + Library/Immune)."