#!/bin/bash
set -e
cd "$(dirname "$(readlink -f "$0")")"
APP_DIR="$(pwd)"

if command -v kdialog > /dev/null 2>&1; then
    DIALOG="kdialog"
elif command -v zenity > /dev/null 2>&1; then
    DIALOG="zenity"
else
    DIALOG="none"
fi

info() {
    echo "$1"
    case "$DIALOG" in
        kdialog) kdialog --title "Tripo3D Downloader — Install" --msgbox "$1" ;;
        zenity)  zenity --info --title "Tripo3D Downloader — Install" --text "$1" ;;
    esac
}

fail() {
    echo "ERROR: $1" >&2
    case "$DIALOG" in
        kdialog) kdialog --title "Tripo3D Downloader — Install failed" --error "$1" ;;
        zenity)  zenity --error --title "Tripo3D Downloader — Install failed" --text "$1" ;;
    esac
    exit 1
}

command -v python3 > /dev/null 2>&1 || fail "python3 is not installed."
command -v brave > /dev/null 2>&1 || command -v brave-browser > /dev/null 2>&1 \
    || fail "Brave browser is not installed. Install it first, then re-run this."

if [ ! -d venv ]; then
    python3 -m venv venv || fail "Failed to create the Python virtual environment."
fi

./venv/bin/pip install --quiet --upgrade pip || fail "Failed to upgrade pip."
./venv/bin/pip install --quiet -r requirements.txt || fail "Failed to install Python dependencies."
./venv/bin/python -m playwright install chromium || fail "Failed to install Playwright's browser."

chmod +x run.sh install.sh

DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
mkdir -p "$DESKTOP_DIR"

cat > "$DESKTOP_DIR/Tripo3D Downloader.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Tripo3D Downloader
Comment=Download the .stl for a studio.tripo3d.ai model
Exec=$APP_DIR/run.sh
Icon=applications-graphics
Terminal=false
Categories=Utility;
EOF
chmod +x "$DESKTOP_DIR/Tripo3D Downloader.desktop"
gio set "$DESKTOP_DIR/Tripo3D Downloader.desktop" metadata::trusted true 2>/dev/null || true

info "Install complete. A 'Tripo3D Downloader' icon is now on your Desktop — double-click it to use it."
