#!/usr/bin/env bash
# Rotate the leaked secrets WITHOUT ever pasting them into a chat.
#
# For each secret you choose to rotate:
#   1. Generate a NEW value in the provider dashboard (see URLs below) and
#      REVOKE the old one there.
#   2. Run this script. It removes the old Vercel env var and re-adds it,
#      prompting you for the new value at YOUR terminal (hidden input) — the
#      value is never typed into chat or logged.
#   3. Redeploy so the new value takes effect.
#
# Provider dashboards (revoke old + create new there first):
#   NVIDIA  (NVIDIA_API_KEY  nvapi-…) : https://build.nvidia.com  → profile → API Keys
#   Anthropic (ANTHROPIC_API_KEY)     : https://console.anthropic.com → Settings → API Keys
#   Telegram (TELEGRAM_BOT_TOKEN)     : Telegram → @BotFather → /revoke → @HermesElBolitero_bot
#   Bland   (VOICE_API_KEY)           : https://app.bland.ai → Dashboard → API Keys
#   Resend  (MAIL_API_KEY  re_…)      : https://resend.com/api-keys
#
# Usage:  bash scripts/rotate-secrets.sh [SECRET_NAME ...]
#   no args  → rotates the full leaked set below
#   args     → rotates only the named vars (e.g. `... TELEGRAM_BOT_TOKEN MAIL_API_KEY`)

set -euo pipefail

SCOPE="juan-gonzalezs-projects-64148cf1"
ENVIRONMENT="production"
DEFAULT_SECRETS=(NVIDIA_API_KEY ANTHROPIC_API_KEY TELEGRAM_BOT_TOKEN VOICE_API_KEY MAIL_API_KEY)

SECRETS=("$@")
if [ ${#SECRETS[@]} -eq 0 ]; then
  SECRETS=("${DEFAULT_SECRETS[@]}")
fi

echo "Rotating in Vercel (${SCOPE} / ${ENVIRONMENT}): ${SECRETS[*]}"
echo "Make sure you have ALREADY revoked the old value + created a new one in each provider dashboard."
echo

for name in "${SECRETS[@]}"; do
  echo "──────── $name ────────"
  # Remove the old value (ignore error if it doesn't exist yet).
  npx vercel env rm "$name" "$ENVIRONMENT" --scope "$SCOPE" --yes 2>/dev/null || true
  # Re-add: vercel prompts for the value at the terminal (hidden), not via chat.
  echo "Paste the NEW $name value at the prompt below (input is local to your terminal):"
  npx vercel env add "$name" "$ENVIRONMENT" --scope "$SCOPE"
  echo
done

echo "All requested secrets rotated. Now redeploy to apply:"
echo "  npx vercel deploy --prod --scope ${SCOPE}"
