#!/bin/bash
cd "$(dirname "$0")"

BRAVE_PROFILE="$HOME/.config/BraveSoftware/Brave-Browser"
BRAVE_BIN="$(command -v brave || command -v brave-browser)"

if [ -z "$BRAVE_BIN" ]; then
    kdialog --title "Tripo3D Downloader — Error" --msgbox "Brave isn't found on PATH. Install it or adjust BRAVE_BIN in run.sh."
    exit 1
fi

if ! curl -s --max-time 1 http://127.0.0.1:9333/json/version > /dev/null 2>&1; then
    kdialog --msgbox "Brave needs to restart once with debugging enabled (your tabs will restore). Click OK to continue."
    pkill -f "$BRAVE_BIN"
    sleep 2
    nohup "$BRAVE_BIN" --remote-debugging-port=9333 --user-data-dir="$BRAVE_PROFILE" --no-first-run --no-default-browser-check > /tmp/brave_debug.log 2>&1 &
    disown
    for i in $(seq 1 20); do
        curl -s --max-time 1 http://127.0.0.1:9333/json/version > /dev/null 2>&1 && break
        sleep 1
    done
fi

URL=$(kdialog --inputbox "Paste the studio.tripo3d.ai link:" 2>/dev/null)
if [ -z "$URL" ]; then
    exit 0
fi
kdialog --title "Tripo3D Downloader" --msgbox "Working on it — check the Brave window. If you're not logged in, log in there, then check back here." &
MSG_PID=$!
./venv/bin/python tripo_download.py "$URL" > /tmp/tripo_download.log 2>&1
kill $MSG_PID 2>/dev/null
if grep -q "^Saved:" /tmp/tripo_download.log; then
    SAVED=$(grep "^Saved:" /tmp/tripo_download.log | tail -1)
    kdialog --msgbox "Done!\n$SAVED"
else
    kdialog --title "Tripo3D Downloader — Error" --textbox /tmp/tripo_download.log 600 400
fi
