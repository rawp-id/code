#!/usr/bin/env bash
# Shell sample
set -euo pipefail

name="${1:-world}"
count=3

for i in $(seq 1 "$count"); do
  echo "Hello, $name ($i)"
done
