#!/usr/bin/env bash
# Build the Kural desktop app (Tauri 2.0)
#
# Prerequisites (Ubuntu/Debian):
#   sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
#     libssl-dev build-essential
#
# If the -dev package is unavailable but the runtime library IS installed
# (libwebkit2gtk-4.1-0), this script creates minimal pkg-config shims so the
# linker can find the .so files.  Install the -dev package when possible —
# the shim is a workaround for environments without it.

set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT="$(cd .. && pwd)"
PKGCFG_FAKE="$HOME/.local/lib/webkit-fake/pkgconfig"

# Check if the proper -dev package is installed
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  echo "webkit2gtk-4.1 dev headers not found via pkg-config."
  echo "Attempting to create pkg-config shims from installed runtime libraries..."

  mkdir -p "$HOME/.local/lib/webkit-fake/pkgconfig"
  LIBDIR=/usr/lib/x86_64-linux-gnu

  for lib in \
    "libwebkit2gtk-4.1.so:libwebkit2gtk-4.1.so.0" \
    "libjavascriptcoregtk-4.1.so:libjavascriptcoregtk-4.1.so.0" \
    "libsoup-3.0.so:libsoup-3.0.so.0"; do
    dst="${lib%%:*}"
    src="${lib##*:}"
    if [ -f "$LIBDIR/$src" ]; then
      ln -sf "$LIBDIR/$src" "$HOME/.local/lib/webkit-fake/$dst"
    fi
  done

  cat > "$PKGCFG_FAKE/webkit2gtk-4.1.pc" <<EOF
prefix=/usr
libdir=/usr/lib/x86_64-linux-gnu
Name: webkit2gtk-4.1
Description: WebKit2 Gtk+ 4.1 (shim)
Version: 2.52.0
Requires: gtk+-3.0 gio-2.0 glib-2.0 soup-3.0 javascriptcoregtk-4.1
Libs: -L/usr/lib/x86_64-linux-gnu -lwebkit2gtk-4.1
Cflags:
EOF

  cat > "$PKGCFG_FAKE/javascriptcoregtk-4.1.pc" <<EOF
prefix=/usr
libdir=/usr/lib/x86_64-linux-gnu
Name: javascriptcoregtk-4.1
Description: JavaScriptCore Gtk+ 4.1 (shim)
Version: 2.52.0
Requires: glib-2.0
Libs: -L/usr/lib/x86_64-linux-gnu -ljavascriptcoregtk-4.1
Cflags:
EOF

  # soup3-sys expects the pkg-config name "libsoup-3.0"
  cat > "$PKGCFG_FAKE/libsoup-3.0.pc" <<EOF
prefix=/usr
libdir=/usr/lib/x86_64-linux-gnu
Name: libsoup-3.0
Description: HTTP library (shim)
Version: 3.6.6
Requires: glib-2.0 gio-2.0
Libs: -L/usr/lib/x86_64-linux-gnu -lsoup-3.0
Cflags:
EOF

  export PKG_CONFIG_PATH="$PKGCFG_FAKE:/usr/lib/x86_64-linux-gnu/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
  export LIBRARY_PATH="$HOME/.local/lib/webkit-fake${LIBRARY_PATH:+:$LIBRARY_PATH}"
  echo "Shims created. Proceeding with build."
fi

# Build the frontend static export first
echo "Building frontend static export..."
(cd "$REPO_ROOT/frontend" && pnpm build:desktop)

# Run the Tauri release build
echo "Running cargo tauri build..."
export PATH="$HOME/.cargo/bin:$PATH"
cd src-tauri
exec cargo build --release "$@"
