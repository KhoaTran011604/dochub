#!/bin/sh
# Nén toàn bộ file đính kèm của Outline (volume outline-file-storage, mount
# read-only ở /outline-file-storage) thành 1 file tar.gz.
set -eu
umask 077

timestamp="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
output_dir="/backup-output/${timestamp}/outline-file-storage"
mkdir -p "$output_dir"

echo "Archiving Outline file storage..."
tar -czf "${output_dir}/outline-file-storage.tar.gz" -C /outline-file-storage .

echo "File storage backup written to ${output_dir}"
