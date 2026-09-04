#!/usr/bin/env bash
# Build one plugin from this repo and install it into a local DSH profile.
# Usage: scripts/install-local.sh <plugin-name> [profile]
# Example: scripts/install-local.sh dsh-plugin-ntfy desktop
set -euo pipefail

plugin="${1:?usage: install-local.sh <plugin-name> [profile]}"
profile="${2:-desktop}"
dsh_home="${DSH_HOME:-$HOME/.dsh}"
root="$(cd "$(dirname "$0")/.." && pwd)"
pkg_dir="$root/plugins/$plugin"
target="$dsh_home/profiles/$profile/node_modules/$plugin"

[ -d "$pkg_dir" ] || { echo "no such plugin: $pkg_dir" >&2; exit 1; }

pnpm --filter "$plugin" build

mkdir -p "$target"
rsync -a --delete "$pkg_dir/lib/" "$target/lib/"
cp "$pkg_dir/package.json" "$target/package.json"
[ -f "$pkg_dir/cordis.patch.yml" ] && cp "$pkg_dir/cordis.patch.yml" "$target/cordis.patch.yml"

echo "installed $plugin -> profile \"$profile\""
echo "host-side changes need a DSH Desktop restart; client-side changes need a page refresh."
