# HERMES EL BOLITERO

App informativa cubana de resultados de la bolita, estadísticas, charada y el
agente IA **Hermes**. Solo entretenimiento e información — no es una casa de
apuestas.

## Arquitectura

- **Frontend estático** — `index.html` carga React + Recharts desde CDN, baja
  `app/p1.txt … p4.txt`, los une, los transpila con Babel en el navegador y
  arranca la app. No hay paso de build.
- **Cerebro Hermes** — `api/hermes.js` es una función serverless de Vercel que
  llama al modelo de lenguaje. La clave del proveedor vive **solo en el
  servidor**; el navegador habla con `/api/hermes`.

El frontend usa `/api/hermes` por defecto (la clave nunca sale del servidor).
Solo si el proxy no está disponible cae a una clave guardada en el panel de
Admin (localStorage).

**Resiliencia del motor:** con NVIDIA, el proxy prueba el modelo configurado y,
ante cualquier fallo (404 sin acceso, 429, 5xx, timeout), rota automáticamente
por una lista de modelos NIM gratuitos verificados — sin redeploy. Si hay varios
proveedores configurados, se intentan en orden `engine → nvidia → anthropic`.

**Status / health:** `GET /api/hermes` devuelve los proveedores configurados y la
rotación de modelos (sin exponer claves). `POST` solo acepta orígenes propios
(`*.vercel.app`, `APP_URL`, localhost) o sin Origin, para evitar abuso de cuota.

## Despliegue en Vercel (producción)

El proyecto está conectado a este repo de GitHub: cada push a `main` despliega
en producción automáticamente. No requiere build command ni framework.

### Activar Hermes (paso obligatorio)

Para que el agente IA responda, configura **un** proveedor en
Vercel → Project → Settings → Environment Variables, y vuelve a desplegar:

| Variable          | Ejemplo / default                                   |
|-------------------|-----------------------------------------------------|
| `NVIDIA_API_KEY`  | tu clave de NVIDIA NIM **(proveedor por defecto)**  |
| `NVIDIA_MODEL`    | `nvidia/llama-3.1-nemotron-70b-instruct`            |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1`               |

Alternativas (define solo una familia de claves):

- **OpenRouter / OpenAI-compatible**: `ENGINE_API_KEY`, `ENGINE_MODEL`, `ENGINE_BASE_URL`
- **Anthropic**: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`)

Sin ninguna clave configurada, la app carga y funciona (resultados,
estadísticas, charada), pero `/api/hermes` responde `503 no_engine_configured`
hasta que añadas la clave.

## Desarrollo local

```bash
npm i -g vercel
vercel dev          # sirve el estático + la función /api/hermes
```
