#!/bin/sh
# Dump database `outline` và `hd_document_apps` (định dạng custom của pg_dump).
# Chạy trong service `backup` của docker compose; kết nối qua PGHOST/PGUSER/PGPASSWORD.
set -eu
# Dump chứa secret (hash mật khẩu, session): chỉ owner đọc được.
umask 077

timestamp="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
output_dir="/backup-output/${timestamp}/postgres"
mkdir -p "$output_dir"

for database in outline hd_document_apps; do
  echo "Dumping database ${database}..."
  pg_dump --format=custom --dbname="$database" --file="${output_dir}/${database}.dump"
done

echo "Postgres backup written to ${output_dir}"
