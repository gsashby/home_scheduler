#!/usr/bin/env bash
# Dumps this family's Postgres *data* from the linked Supabase project.
# Schema is not included here -- it already lives in
# supabase/migrations/, version-controlled in git, and is restored via
# `supabase db push` against a fresh project. See
# Documentation/08-backups-and-recovery.md for the full restore runbook.
#
# Requires `npx supabase link --project-ref <ref>` to have been run once.
#
# Usage: ./scripts/backup-db.sh
set -euo pipefail

mkdir -p backups
out="backups/$(date +%Y-%m-%d_%H%M%S).sql"

npx supabase db dump --linked --data-only -s public,auth -f "$out"

echo ""
echo "Backup written to $out"
echo "This file contains real family data: names, Google Calendar OAuth"
echo "tokens, and Supabase Auth password hashes. Store it somewhere"
echo "encrypted/access-restricted -- never commit it to git (backups/ is"
echo "already gitignored as a safety net, but treat the file itself as a"
echo "secret regardless of where it ends up)."
