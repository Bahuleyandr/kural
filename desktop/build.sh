#!/usr/bin/env bash
# Build the Kural desktop app (Tauri 2.0)
#
# Preferred: install the -dev packages first:
#   sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
#     libssl-dev build-essential
#
# Fallback (no sudo): this script detects whether the -dev packages are
# absent and creates minimal pkg-config shims so the linker can find the
# existing runtime .so files.  The shim approach works for local dev but
# CI should install the -dev packages for reproducible, clean builds.

set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT="$(cd .. && pwd)"
PKGCFG_FAKE="$HOME/.local/lib/webkit-fake"

_shim_pc() {
  local name="$1" version="$2" requires="$3" libs="$4"
  cat > "$PKGCFG_FAKE/pkgconfig/${name}.pc" <<EOF
prefix=/usr
libdir=/usr/lib/x86_64-linux-gnu
Name: ${name}
Description: ${name} (shim — install -dev package for CI)
Version: ${version}
Requires: ${requires}
Libs: -L/usr/lib/x86_64-linux-gnu ${libs}
Cflags:
EOF
}

_symlink() {
  local dst="$1" src="$2"
  local LIBDIR=/usr/lib/x86_64-linux-gnu
  [ -f "$LIBDIR/$src" ] && ln -sf "$LIBDIR/$src" "$PKGCFG_FAKE/$dst"
}

setup_shims() {
  echo "Creating pkg-config shims for missing -dev packages..."
  mkdir -p "$PKGCFG_FAKE/pkgconfig"

  _symlink libwebkit2gtk-4.1.so         libwebkit2gtk-4.1.so.0
  _symlink libjavascriptcoregtk-4.1.so  libjavascriptcoregtk-4.1.so.0
  _symlink libsoup-3.0.so               libsoup-3.0.so.0
  _symlink libayatana-appindicator3.so  libayatana-appindicator3.so.1
  _symlink libappindicator3.so          libappindicator3.so.1

  _shim_pc webkit2gtk-4.1          2.52.0 \
    "gtk+-3.0 gio-2.0 glib-2.0 soup-3.0 javascriptcoregtk-4.1" \
    "-lwebkit2gtk-4.1"

  _shim_pc javascriptcoregtk-4.1   2.52.0 \
    "glib-2.0" \
    "-ljavascriptcoregtk-4.1"

  # soup3-sys looks for "libsoup-3.0" (filename = package name)
  _shim_pc libsoup-3.0             3.6.6 \
    "glib-2.0 gio-2.0" \
    "-lsoup-3.0"

  _shim_pc ayatana-appindicator3-0.1  0.5.94 \
    "gtk+-3.0" \
    "-layatana-appindicator3"

  _shim_pc appindicator3-0.1       0.5.0 \
    "gtk+-3.0" \
    "-lappindicator3"

  export PKG_CONFIG_PATH="$PKGCFG_FAKE/pkgconfig:/usr/lib/x86_64-linux-gnu/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
  export LIBRARY_PATH="$PKGCFG_FAKE${LIBRARY_PATH:+:$LIBRARY_PATH}"
  echo "Shims ready."
}

# Only create shims if webkit2gtk-4.1 isn't already available via pkg-config
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  setup_shims
fi

# Build the frontend static export first (tauri.conf.json beforeBuildCommand
# does this automatically, but we run it explicitly here for clearer errors)
echo "Building frontend static export..."
(cd "$REPO_ROOT/frontend" && pnpm build:desktop)

# Run the Tauri release build via the CLI (produces .deb + .AppImage on Linux)
echo "Running tauri build..."
export PATH="$HOME/.cargo/bin:$PATH"
exec npx @tauri-apps/cli@^2 build "$@"
