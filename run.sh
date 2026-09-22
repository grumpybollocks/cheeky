#!/bin/bash
cd "$(dirname "$0")"

# ── Dialog backend: use kdialog if present, fall back to zenity ────────────
if command -v kdialog > /dev/null 2>&1; then
    DIALOG="kdialog"
elif command -v zenity > /dev/null 2>&1; then
    DIALOG="zenity"
else
    echo "Neither kdialog nor zenity is installed — can't show dialogs." >&2
    exit 1
fi

msgbox() {
    if [ "$DIALOG" = "kdialog" ]; then
        kdialog --title "Tripo3D Downloader" --msgbox "$1"
    else
        zenity --info --title "Tripo3D Downloader" --text "$1"
    fi
}

errorbox_file() {
    if [ "$DIALOG" = "kdialog" ]; then
        kdialog --title "Tripo3D Downloader — Error" --textbox "$1" 600 400
    else
        zenity --text-info --title "Tripo3D Downloader — Error" --filename="$1" --width=600 --height=400
    fi
}

ask_url() {
    if [ "$DIALOG" = "kdialog" ]; then
        kdialog --inputbox "Paste the studio.tripo3d.ai link:" 2>/dev/null
    else
        zenity --entry --title "Tripo3D Downloader" --text "Paste the studio.tripo3d.ai link:" 2>/dev/null
    fi
}

BRAVE_PROFILE="$HOME/.config/BraveSoftware/Brave-Browser"
BRAVE_BIN="$(command -v brave || command -v brave-browser)"

if [ -z "$BRAVE_BIN" ]; then
    msgbox "Brave isn't found on PATH. Install it or adjust BRAVE_BIN in run.sh."
    exit 1
fi

if ! curl -s --max-time 1 http://127.0.0.1:9333/json/version > /dev/null 2>&1; then
    msgbox "Brave needs to restart once with debugging enabled (your tabs will restore). Click OK to continue."
    pkill -f "$BRAVE_BIN"
    sleep 2
    nohup "$BRAVE_BIN" --remote-debugging-port=9333 --user-data-dir="$BRAVE_PROFILE" --no-first-run --no-default-browser-check > /tmp/brave_debug.log 2>&1 &
    disown
    for i in $(seq 1 20); do
        curl -s --max-time 1 http://127.0.0.1:9333/json/version > /dev/null 2>&1 && break
        sleep 1
    done
    if ! curl -s --max-time 1 http://127.0.0.1:9333/json/version > /dev/null 2>&1; then
        msgbox "Brave didn't come up with debugging enabled after 20s. Try running this again."
        exit 1
    fi
fi

URL=$(ask_url)
if [ -z "$URL" ]; then
    exit 0
fi

msgbox "Working on it — check the Brave window. If you're not logged in, log in there, then check back here." &
MSG_PID=$!
./venv/bin/python tripo_download.py "$URL" > /tmp/tripo_download.log 2>&1
kill $MSG_PID 2>/dev/null

if grep -q "^Saved:" /tmp/tripo_download.log; then
    SAVED=$(grep "^Saved:" /tmp/tripo_download.log | tail -1)
    msgbox "Done!
$SAVED"
else
    errorbox_file /tmp/tripo_download.log
fi
