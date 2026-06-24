#!/usr/bin/env bash
# NexSidi first-time setup script
# Run once after cloning: bash setup.sh
set -euo pipefail

echo ""
echo "=== NexSidi Setup ==="
echo ""

# ── 1. .env file ──────────────────────────────────────────────────────────────
if [ -f ".env" ]; then
  echo "[1/4] .env already exists — skipping copy"
else
  cp .env.example .env
  echo "[1/4] .env created from .env.example — fill in your API keys before starting"
fi

# ── 2. RSA keys for context chain (Patent Claims 1/3/7) ──────────────────────
if [ -f "keys/private.pem" ] && [ -f "keys/public.pem" ]; then
  echo "[2/4] RSA keys already exist — skipping generation"
else
  mkdir -p keys
  openssl genrsa -out keys/private.pem 2048 2>/dev/null
  openssl rsa -in keys/private.pem -pubout -out keys/public.pem 2>/dev/null
  chmod 600 keys/private.pem
  echo "[2/4] RSA keys generated at keys/private.pem + keys/public.pem"
fi

# ── 3. Prompt audit encryption key ───────────────────────────────────────────
if grep -q "^PROMPT_AUDIT_KEY=0000" .env 2>/dev/null; then
  AUDIT_KEY=$(openssl rand -hex 32)
  # Replace placeholder with real key (works on macOS and Linux)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^PROMPT_AUDIT_KEY=.*/PROMPT_AUDIT_KEY=${AUDIT_KEY}/" .env
  else
    sed -i "s/^PROMPT_AUDIT_KEY=.*/PROMPT_AUDIT_KEY=${AUDIT_KEY}/" .env
  fi
  echo "[3/4] Prompt audit encryption key generated and written to .env"
else
  echo "[3/4] Prompt audit key already set — skipping"
fi

# ── 4. Install dependencies ───────────────────────────────────────────────────
if [ -d "node_modules" ]; then
  echo "[4/4] node_modules exists — skipping bun install"
else
  echo "[4/4] Running bun install..."
  bun install
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit .env and fill in:"
echo "       NIM_API_KEY        — get free key at nim.nvidia.com"
echo "       CLERK_SECRET_KEY   — from clerk.com dashboard"
echo "       CLERK_PUBLISHABLE_KEY"
echo "       NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
echo "       CLERK_WEBHOOK_SECRET"
echo "       GITHUB_TOKEN       — PAT with repo + org permissions"
echo "       GITHUB_ORG         — your GitHub org name"
echo "       BUILD_DIR          — e.g. C:/tmp/nexsidi-builds (Windows)"
echo ""
echo "  2. Start infrastructure:"
echo "       docker compose -f docker-compose.dev.yml up -d"
echo ""
echo "  3. Wait ~30s for Temporal, then run the DB migration:"
echo "       bun packages/db/src/migrate.ts"
echo ""
echo "  4. Make sure Ollama is running (natively on Windows):"
echo "       ollama run qwen2.5-coder:7b"
echo ""
echo "  5. Open 3 terminals and start:"
echo "       Terminal A (worker): cd pipeline && bun run worker"
echo "       Terminal B (api):    cd apps/api && bun run dev"
echo "       Terminal C (web):    cd apps/web && bun run dev"
echo ""
echo "  6. Open http://localhost:3000 and try:"
echo "       'Build me a task manager with sign up, tasks, due dates'"
echo ""
