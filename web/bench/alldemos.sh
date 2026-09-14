#!/bin/bash
# Every recording on the demos page, played headlessly for eight seconds: one line each with
# any Host_Error the engine raised (an alert in the web build) and where playback stopped.
#
#   web/bench/alldemos.sh > out/alldemos.log
cd ~/Desktop/cs16-web/web
for f in ../content/demos/*.dem; do
  n=$(basename "$f" .dem)
  map=$(python3 -c "import json;print(json.load(open('$f.json')).get('map',''))" 2>/dev/null)
  out=$(SECONDS=8 timeout 200 node bench/hldemo.mjs "$n" "$map" 2>&1)
  d=$(echo "$out" | grep -o "DIALOG: .*" | head -1 | cut -c1-140)
  s=$(echo "$out" | grep -o "playback stopped in section [0-9]* after [0-9]* frames\|end of file after [0-9]* frames" | head -1)
  echo "$n | ${d:-ok} | $s"
done
