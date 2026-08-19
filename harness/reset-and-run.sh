#!/usr/bin/env bash
# Resetuje projekt do stanu sprzed pracy implementera i odpala harness od zera.
# Uruchom z katalogu harness/: ./reset-and-run.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "== reset =="
rm -f cli.js
rm -rf episodes
mkdir -p episodes
sed -i.bak -E 's/^- \[x\]/- [ ]/' plan.md && rm plan.md.bak

cat > scout-config.json <<'EOF'
{
  "maxEpisodes": 30,
  "maxSignalRetries": 3,
  "roles": {
    "implementer": { "maxTurns": 20, "model": "sonnet", "effort": "high" },
    "release-manager": { "maxTurns": 15, "model": "haiku", "effort": "low" },
    "detektyw": { "maxTurns": 15, "model": "sonnet", "effort": "medium" }
  }
}
EOF

echo "== stan po resecie =="
cat plan.md
echo

echo "== start harnessu =="
node harness.js
