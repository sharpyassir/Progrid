#!/usr/bin/env sh
# prgd CLI installer — curl -fsSL https://get.progrid.co | sh
# Downloads the latest release binary for this OS/arch into /usr/local/bin (or ~/.local/bin).
set -eu

REPO="${PRGD_CLI_REPO:-sharpyassir/Cloud}"
VERSION="${PRGD_CLI_VERSION:-latest}"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
case "$OS" in linux|darwin) ;; *) echo "unsupported OS: $OS (use the Windows .zip from the releases page)" >&2; exit 1 ;; esac

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/$REPO/releases/latest/download/prgd_${OS}_${ARCH}.tar.gz"
else
  URL="https://github.com/$REPO/releases/download/${VERSION}/prgd_${OS}_${ARCH}.tar.gz"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "→ downloading $URL"
curl -fsSL "$URL" | tar -xz -C "$TMP"

DEST=/usr/local/bin
if [ ! -w "$DEST" ]; then
  DEST="$HOME/.local/bin"; mkdir -p "$DEST"
fi
install -m 0755 "$TMP/prgd" "$DEST/prgd"
echo "✓ installed to $DEST/prgd"
case ":$PATH:" in *":$DEST:"*) ;; *) echo "  add $DEST to your PATH" ;; esac
echo
echo "Next:  prgd login"
echo "       prgd servers create web-1 --image ubuntu-24-04 --wait"
echo "       prgd deploy https://github.com/you/app --wait"
