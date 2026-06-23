# 🔐 HERMES EL BOLITERO — Catálogo de Secretos (Environment Variables)

**Regla de oro:** ninguna clave va en el código ni en el repo. **Todas** viven SOLO en
Vercel → *Project → Settings → Environment Variables*. Este archivo lista los **nombres**
y dónde conseguir cada clave — **nunca** sus valores.

> Auditoría del repo: ✅ sin secretos hardcodeados · ✅ `.gitignore` protege `.env*` ·
> ✅ todo se lee por `process.env`.

---

## 🧠 Cerebro de IA — Hermes (`api/hermes.js`, `api/numeros.js`)
Se intentan en orden (engine → nvidia → anthropic); el primero sano responde.

| Variable | Req. | Para qué | Dónde sacarla |
|---|---|---|---|
| `NVIDIA_API_KEY` | ⭐ Principal | NVIDIA NIM (compatible OpenAI), clave `nvapi-…` | https://build.nvidia.com → perfil → API Keys |
| `NVIDIA_MODEL` | Opcional | Modelo (default: `nvidia/llama-3.1-nemotron-70b-instruct`) | — |
| `NVIDIA_BASE_URL` | Opcional | default `https://integrate.api.nvidia.com/v1` | — |
| `ENGINE_API_KEY` | Opcional | OpenRouter / cualquier motor OpenAI-compatible | https://openrouter.ai/keys |
| `ENGINE_MODEL` / `ENGINE_BASE_URL` | Opcional | modelo / URL del motor anterior | — |
| `ANTHROPIC_API_KEY` | Respaldo | Claude (fallback), clave `sk-ant-…` | https://console.anthropic.com → API Keys |
| `ANTHROPIC_MODEL` | Opcional | default `claude-sonnet-4-6` | — |

## 🗄️ Base de datos compartida (`api/db.js`, `api/push.js`, etc.)
Se autodetecta: Supabase primero, si no Upstash/KV.

| Variable | Req. | Para qué | Dónde |
|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` | ✅ (actual) | Upstash Redis REST URL | https://console.upstash.com |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ (actual) | Upstash Redis REST token | id. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Alt. | Vercel KV (mismo rol que Upstash) | Vercel → Storage |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Alt. | Backend Supabase (opcional) | https://supabase.com → Project Settings → API |

## 🔔 Notificaciones push (`api/push.js`, `sw.js`)
| Variable | Req. | Para qué | Dónde |
|---|---|---|---|
| `VAPID_PUBLIC_KEY` | ✅ | Clave pública Web Push | generada con `web-push` |
| `VAPID_PRIVATE_KEY` | ✅ | Clave privada Web Push | id. (¡secreta!) |

## 🎱 Números oficiales (`api/numeros-oficial.js`)
| Variable | Req. | Para qué | Dónde |
|---|---|---|---|
| `MAGAYO_API_KEY` | Opcional | Resultados oficiales (cuenta suspendida hoy) | https://www.magayo.com → API |
| `MAGAYO_BOARDS` | Opcional | Tableros que SÍ se consultan en magayo (ahorra cuota). Por defecto `florida,georgia,chicago,pr,texas`. New York es gratis y siempre real; el resto muestra DEMO. Pon `all` para todos | ids de tablero |
| `MAGAYO_MONTHLY_CAP` | Opcional | Tope duro de llamadas/mes (default 950) — al llegar, se frena todo (error 303 imposible) | número |

## ✉️ Email (`lib/notify.js`) — Resend **o** SMTP
| Variable | Req. | Para qué | Dónde |
|---|---|---|---|
| `MAIL_API_KEY` | Opción A | Resend, clave `re_…` | https://resend.com/api-keys |
| `MAIL_FROM` / `MAIL_FROM_NAME` / `MAIL_REPLY_TO` | Opcional | Remitente y respuesta | — |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Opción B | Servidor SMTP propio | tu proveedor de correo |

## 📣 Telegram (`lib/notify.js`)
| Variable | Req. | Para qué | Dónde |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Opcional | Bot que canta el número | Telegram → @BotFather |
| `TELEGRAM_CHAT_ID` | Opcional | Grupo/canal destino | id. |
| `TELEGRAM_OWNER_CHAT_ID` | Opcional | Chat privado del dueño para avisos solo-dueño (p. ej. pagos pendientes). Si falta, usa `TELEGRAM_CHAT_ID` | id. |

> **Conseguir tu `TELEGRAM_OWNER_CHAT_ID` (chat privado, 1 min):**
> 1. En Telegram, abre un chat con **tu bot** (el de `TELEGRAM_BOT_TOKEN`) y envíale cualquier mensaje (ej. `hola`).
> 2. Abre en el navegador: `https://api.telegram.org/bot<TU_TOKEN>/getUpdates` (pega tu token real).
> 3. Copia el número en `"chat":{"id": ...}` — ese es tu ID privado (a veces empieza con `-` o es largo).
> 4. Pégalo en **Vercel → Settings → Environment Variables** como `TELEGRAM_OWNER_CHAT_ID` (Production) y **Redeploy/Promote**.
> Sin esta variable, el aviso de pagos pendientes cae en el grupo de `TELEGRAM_CHAT_ID` (solo un conteo, sin datos sensibles).

## 📞 Llamadas de voz (`lib/notify.js` — Bland.ai)
| Variable | Req. | Para qué | Dónde |
|---|---|---|---|
| `VOICE_API_KEY` | Opcional | Llamada de Hermes | https://app.bland.ai → API Keys |
| `VOICE_FROM_NUMBER` | Opcional | Número emisor | id. |

## 🛡️ Seguridad / sistema
| Variable | Req. | Para qué |
|---|---|---|
| `RESULTS_API_SECRET` | ✅ | Protege el broadcast (push/email/voz/telegram) y el envío manual |
| `CRON_SECRET` | Opcional | Protege los cron jobs |
| `APP_URL` | Recomendado | Bloqueo por origen (ej. `https://www.hermeselbolitero.com`) |
| `NODE_ENV` | Auto | Lo pone Vercel |

---

## 🔁 Rotar un secreto expuesto
Usa `scripts/rotate-secrets.sh` (pide el valor en TU terminal, nunca en el chat):
```bash
bash scripts/rotate-secrets.sh NVIDIA_API_KEY ANTHROPIC_API_KEY
```
Primero **revoca** el viejo y **crea** el nuevo en el panel del proveedor; luego corre el
script y haz **Redeploy**.

### ⚠️ Pendiente de rotar (se expusieron en chat anteriormente)
- `MAGAYO_API_KEY` y las contraseñas de magayo
- Cualquier clave que se haya pegado en una conversación
