// Shared helpers for the result-broadcast endpoints (Telegram / email / voice).
// Not a route itself — lives outside /api so Vercel doesn't expose it.

function readBody(req) {
  let b = req.body || {};
  if (typeof b === "string") {
    try { b = JSON.parse(b || "{}"); } catch { b = {}; }
  }
  return b && typeof b === "object" ? b : {};
}

// The broadcast endpoints can place phone calls, send email from your domain,
// and post to Telegram — so they must not be open to the public internet.
// Require a shared secret (RESULTS_API_SECRET). Vercel Cron's CRON_SECRET is
// also accepted so scheduled jobs work without extra config.
function checkSecret(req) {
  const need = process.env.RESULTS_API_SECRET;
  if (!need) {
    return { ok: false, code: 503, body: { error: "secret_not_configured",
      detail: "Set RESULTS_API_SECRET in the Vercel project env vars to enable the broadcast endpoints." } };
  }
  const h = req.headers || {};
  const auth = String(h.authorization || h.Authorization || "");
  const token = auth.replace(/^Bearer\s+/i, "").trim() || String(h["x-results-secret"] || "").trim();
  const cronOk = process.env.CRON_SECRET && token === process.env.CRON_SECRET;
  if (token && (token === need || cronOk)) return { ok: true };
  return { ok: false, code: 401, body: { error: "unauthorized" } };
}

async function sendTelegram(text, chatId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat_id = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat_id) return { channel: "telegram", ok: false, detail: "telegram_not_configured" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const d = await r.json().catch(() => ({}));
    return { channel: "telegram", ok: !!(r.ok && d.ok), status: r.status, detail: d.description || undefined };
  } catch (e) {
    return { channel: "telegram", ok: false, detail: String((e && e.message) || e) };
  }
}

const FROM_NAME = () => process.env.MAIL_FROM_NAME || "HERMES EL BOLITERO";
const withName = (addr) => (/</.test(addr) ? addr : `${FROM_NAME()} <${addr}>`);

// SMTP path — the way to truly send FROM your own address (e.g. hermeselbolitero@outlook.com).
// Requires SMTP_HOST + SMTP_USER + SMTP_PASS (for Outlook: smtp.office365.com + an app password).
async function sendViaSmtp({ to, subject, html, replyTo }) {
  const nodemailer = require("nodemailer");
  const port = Number(process.env.SMTP_PORT) || 587;
  const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465=implicit TLS, 587=STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await transporter.sendMail({
    from: withName(fromAddr),
    to: Array.isArray(to) ? to.join(", ") : to,
    subject, html,
    replyTo: replyTo || undefined,
  });
  return { channel: "email", ok: true, status: 200, via: "proton-smtp", id: info.messageId };
}

async function sendEmail({ to, subject, html }) {
  if (!to) return { channel: "email", ok: false, detail: "missing_to" };
  const replyTo = process.env.MAIL_REPLY_TO;

  // Prefer Proton SMTP when fully configured (sends from the real Proton address).
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      return await sendViaSmtp({ to, subject, html, replyTo });
    } catch (e) {
      return { channel: "email", ok: false, via: "proton-smtp", detail: String((e && e.message) || e) };
    }
  }

  // Fallback: Resend HTTP API (sender must be a Resend-verified address).
  const key = process.env.MAIL_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return { channel: "email", ok: false, detail: "email_not_configured" };
  try {
    const payload = { from: withName(from), to, subject, html };
    if (replyTo) payload.reply_to = replyTo;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    return { channel: "email", ok: r.ok, status: r.status, via: "resend", detail: d.message || undefined };
  } catch (e) {
    return { channel: "email", ok: false, detail: String((e && e.message) || e) };
  }
}

async function placeCall({ phone, task }) {
  const key = process.env.VOICE_API_KEY;
  if (!key) return { channel: "voice", ok: false, detail: "voice_not_configured" };
  if (!phone) return { channel: "voice", ok: false, detail: "missing_phone" };
  try {
    const r = await fetch("https://api.bland.ai/v1/calls", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        phone_number: phone,
        from: process.env.VOICE_FROM_NUMBER || undefined,
        voice: "june",
        language: "es",
        max_duration: 2,
        task,
      }),
    });
    const d = await r.json().catch(() => ({}));
    return { channel: "voice", ok: r.ok, status: r.status, detail: d.message || d.errors || undefined };
  } catch (e) {
    return { channel: "voice", ok: false, detail: String((e && e.message) || e) };
  }
}

module.exports = { readBody, checkSecret, sendTelegram, sendEmail, placeCall };
