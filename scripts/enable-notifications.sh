#!/usr/bin/env bash
# Turn ON Telegram / email / voice notifications in ONE command.
#
# It reads your secrets from an untracked file (.env.notify, git-ignored), pushes
# each as a Production environment variable on the linked Vercel project, then
# triggers a redeploy. Nothing here is committed — secrets stay on your machine
# and in Vercel only.
#
# USAGE
#   1. cp .env.notify.example .env.notify   &&   fill in your values
#   2. npx vercel login                      (once, to authenticate this machine)
#   3. bash scripts/enable-notifications.sh
#
# Re-running is safe: existing vars are removed then re-added with the new value.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${1:-.env.notify}"
[ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE not found. Copy .env.notify.example to $ENV_FILE and fill it in."; exit 1; }

# Load KEY=VALUE lines (ignore blanks/comments).
set -a; . "./$ENV_FILE"; set +a

# Every var the notification system can use. Only the ones you actually set are pushed.
VARS=(
  TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
  MAIL_API_KEY MAIL_FROM MAIL_FROM_NAME MAIL_REPLY_TO
  SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM
  VOICE_API_KEY VOICE_FROM_NUMBER
  APP_URL CRON_SECRET
)

echo "→ Pushing Production env vars to the linked Vercel project…"
pushed=0
for v in "${VARS[@]}"; do
  val="${!v:-}"
  [ -z "$val" ] && continue
  # Remove if present (ignore error), then add fresh. Production scope.
  npx vercel env rm "$v" production -y >/dev/null 2>&1 || true
  printf '%s' "$val" | npx vercel env add "$v" production >/dev/null 2>&1 \
    && { echo "   ✓ $v"; pushed=$((pushed+1)); } \
    || echo "   ✗ $v (failed — are you logged in? run: npx vercel login)"
done
echo "→ $pushed variable(s) set."

echo "→ Redeploying to production so the new env takes effect…"
npx vercel --prod >/dev/null 2>&1 && echo "   ✓ redeploy triggered" || echo "   ✗ redeploy failed (deploy manually or git push)"

echo "→ Verifying (give it ~30s, then):"
echo "     curl -s https://www.hermeselbolitero.com/api/health | python3 -m json.tool | grep -A4 notify"
echo "Done. notify.telegram/email/voice should now read true."
