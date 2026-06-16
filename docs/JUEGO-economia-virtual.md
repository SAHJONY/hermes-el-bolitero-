# HERMES EL BOLITERO — Modo Juego (economía virtual)

> Juego de competencia con **monedas virtuales**, estilo Monopoly. **Sin dinero
> real ni transacciones reales.** Es entretenimiento por suscripción: los
> jugadores reciben un capital virtual, juegan números contra los resultados
> oficiales reales que ya muestra la app, y cuando aciertan **su capital crece**
> y reciben **premios y bonos**. Compiten por ser el más rico del juego.

## 1. El ecosistema (pirámide)

```
🏛️ BANCO CENTRAL  =  el dueño / master del juego (autoridad total)
   · imprime las monedas virtuales · fija premios y bonos · ve y controla TODO
   │
   ├── 🏦 SUCURSAL A  (jugador-banquero, su propio banco)
   │      · su capital crece · compite con las otras sucursales
   │      └── 👤 clientes → juegan, ganan, su capital sube   ← AISLADOS
   ├── 🏦 SUCURSAL B   ← su propio mundo, NO ve a la Sucursal A
   └── 🏦 SUCURSAL C ...
```

- **Banco Central:** una sola autoridad. Imprime/reparte monedas, fija cuánto
  paga cada acierto y los bonos, crea/suspende sucursales, ve todos los
  capitales y rankings, ajusta la economía. Override total.
- **Sucursal (banco):** un jugador-banquero con su propio banco aislado. Tiene
  sus clientes, su capital, su ranking. No ve ni toca a otras sucursales. Opera
  dentro de los límites que le fija el central.
- **Cliente:** juega dentro de una sucursal. Su capital crece al ganar.

## 2. La economía virtual

- 💰 **Capital que crece** — cada jugador y cada sucursal tienen un saldo en
  monedas virtuales que sube al ganar.
- 🎁 **Premios y bonos** — la plataforma premia al acertar. Tipos sugeridos:
  bienvenida, racha (días seguidos jugando/ganando), jugador del día,
  referidos, login diario. Todos los define el banco central.
- 🏆 **Competencia** — rankings de jugadores y de sucursales (más capital, mejor
  racha). El gancho del juego.
- 🎟️ **Suscripción** para entrar a jugar (tiers ya existentes:
  MIEMBRO $19.99 / VIP 👑 $39.99). Se paga el ACCESO, nunca se compran monedas
  con dinero real.

### Reglas de oro (no romper)
- **Nunca dinero real.** Las monedas no se compran ni se cobran; son del juego.
- **Sin apuestas reales.** Es un juego de competencia, no una casa de apuestas.
- Los números que se usan como "resultado" salen SOLO de los resultados
  oficiales reales que ya sirve `/api/results` (regla de oro existente de Hermes:
  jamás inventar números de lotería).

## 2.5 Hermes = el cerebro y el motor (brain & engine)

Hermes no es solo el asistente que conversa: es **el cerebro y el motor del
juego**. Todo pasa por él:

- **Cerebro (brain):** Hermes interpreta sueños/charada, recomienda jugadas,
  explica reglas, narra los resultados y felicita a los ganadores por voz/email/
  Telegram. Es la cara y la inteligencia del ecosistema.
- **Motor (engine):** la lógica de la economía corre en el servidor bajo el
  mando de Hermes — `db.js` (el almacén central) + los endpoints calculan los
  capitales, aplican premios y bonos, llevan rankings y hacen cumplir las reglas
  del banco central. El navegador solo muestra; Hermes (servidor) decide.

Regla de marca: en toda la app el motor/IA se llama **Hermes**, nunca "IA"/"AI".

## 3. Requisito técnico ineludible: el "cerebro central"

Aunque sea juego virtual, necesita un **almacén central en el servidor**
(Upstash Redis vía Vercel Marketplace; `db.js` ya está listo para usarlo en
cuanto se fijen `KV_REST_API_URL` + `KV_REST_API_TOKEN`). Razones:

1. **Multijugador:** banco central y sucursales ven el mismo estado desde
   distintos dispositivos. El `localStorage` actual es por-dispositivo, no se
   comparte → hoy `db.js` reporta `configured:false`.
2. **Anti-trampa:** si las monedas viven en el navegador, cualquiera edita su
   saldo. El capital DEBE vivir y calcularse en el servidor.

> Estado (2026-06-15): aprobado conectar el cerebro central. La instalación de
> **Upstash for Redis** (`upstash/upstash-kv`) en el proyecto Vercel quedó
> `action_required`: hay que **aceptar los términos del marketplace de Upstash
> en el navegador** (confirmación legal, una sola vez) en:
> https://vercel.com/juan-gonzalezs-projects-64148cf1/~/integrations/accept-terms/upstash?source=cli
> Tras aceptar, se reintenta `vercel integration add upstash/upstash-kv -e production`
> y se inyectan `KV_REST_API_URL` + `KV_REST_API_TOKEN` → `db.js` pasa a
> `configured:true`. Luego se construye el motor (tokens por rol + saldos
> server-authoritative). Es el candado de la Fase 0.

## 4. Modelo de datos (namespacing por sucursal en Redis)

Aislamiento real = cada dato lleva el namespace de su sucursal. Una sucursal
SOLO puede leer/escribir keys con SU prefijo; el central puede con todas.

```
central:meta                     → config global (cuántas monedas circulan, reglas)
central:branches                 → índice de sucursales
branch:<bid>:meta                → {nombre, estado activo/suspendido, límites, comisión}
branch:<bid>:clients             → índice de clientes de la sucursal
branch:<bid>:client:<cid>        → {alias, capital, racha, creado}
branch:<bid>:plays               → jugadas de la sucursal
branch:<bid>:ranking             → ranking interno
cap:<bid>:<cid>                  → capital (saldo) del cliente   ← server-authoritative
```

## 5. Seguridad / enforcement (en el servidor, nunca en el navegador)

Hoy `db.js` está abierto: con solo pasar el origin, cualquiera lee/escribe
CUALQUIER key. Para el juego hay que volverlo **token-scoped** (dentro del mismo
`db.js`, porque el plan Hobby topa en 12 funciones — NO crear archivos nuevos en
`api/`):

- Cada request manda un token. El servidor resuelve token → {rol, bid}.
- **rol = sucursal:** solo permite keys que empiecen con `branch:<bid>:` y
  `cap:<bid>:`. Cualquier otra → 403.
- **rol = central:** acceso total + operaciones de administración (crear/
  suspender sucursal, imprimir monedas, reportes consolidados).
- Las monedas y los premios se calculan en el servidor; el cliente solo muestra.

## 6. Plan por fases

| Fase | Qué incluye | Requiere |
|---|---|---|
| **0. Cerebro central** | Conectar Upstash Redis + saldos server-authoritative + tokens por rol en `db.js` | (pendiente: el dueño dijo "todavía no") |
| **1. Economía base** | Capital virtual por jugador, jugar números, ganar al salir el número, premio en monedas | Fase 0 |
| **2. Sucursales** | Banco central crea sucursales aisladas; cada banquero con sus clientes | Fase 1 |
| **3. Bonos y rankings** | Bonos automáticos (bienvenida, racha, etc.) + tablas de líderes | Fase 2 |
| **4. Panel central** | Consola del banco central: ver/controlar todo, ajustar la economía, suspender | Fase 2 |

## 7. Decisiones aún por definir

- ¿Tú creas todas las sucursales, o un VIP puede abrir la suya?
- ¿Cómo inicia sesión cada sucursal? (recomendado: código + PIN)
- ¿Cómo se ata un cliente a su sucursal? (recomendado: link/código de sucursal)
- ¿De dónde salen las monedas iniciales de un cliente? (sucursal las reparte /
  suscripción da X al mes / se ganan jugando)
- ¿Qué gana la sucursal? (comisión en monedas, ranking, su propia economía)
- Tabla de pagos: ¿cuántas monedas paga cada tipo de acierto y cada bono?
