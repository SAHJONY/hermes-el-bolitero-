// magayo.com game-code map — powers REAL data for every mapped board once a
// MAGAYO_API_KEY from an ACTIVE (non-suspended) magayo account is set in Vercel.
//
// Shape: { "<board>": { "<Sesión>": { p3: "<pick3 code>", p4: "<pick4 code>" } } }
// App sessions are Spanish; magayo suffixes map as:
//   Mediodía → _mid (or _day),  Noche → _eve (or _night/_evening),
//   Mañana  → _morning,         Tarde → (only where magayo has a 3rd draw)
//
// Codes below are the OFFICIAL magayo codes from their Supported Games docs
// (verified format, e.g. us_fl_cash3_mid). New York is served by its free
// official feed and is intentionally omitted here. Unmapped/unknown codes fall
// back to the deterministic demo engine — no breakage.
//
// STATUS 2026-06-15: the provided API key's account returns error 300
// ("Account suspended") for every game, so none of these can be live-verified
// until the magayo account is reactivated. Once active, each should return real
// draws as-is; correct any that don't against the magayo dashboard.

module.exports = {
  // ----- USA (Pick 3 / Pick 4 daily numbers) -----
  florida: {
    "Mediodía": { p3: "us_fl_cash3_mid", p4: "us_fl_play4_mid" },
    "Noche":    { p3: "us_fl_cash3_eve", p4: "us_fl_play4_eve" },
  },
  georgia: {
    // magayo serves GA Cash 3/4 midday + evening; the app's "Tarde" has no
    // distinct magayo draw, so it stays demo.
    "Mediodía": { p3: "us_ga_cash3_mid", p4: "us_ga_cash4_mid" },
    "Noche":    { p3: "us_ga_cash3_eve", p4: "us_ga_cash4_eve" },
  },
  chicago: { // Illinois
    "Mediodía": { p3: "us_il_pick3_mid", p4: "us_il_pick4_mid" },
    "Noche":    { p3: "us_il_pick3_eve", p4: "us_il_pick4_eve" },
  },
  texas: {
    "Mañana":   { p3: "us_tx_pick3_morning", p4: "us_tx_daily4_morning" },
    "Mediodía": { p3: "us_tx_pick3_day",     p4: "us_tx_daily4_day" },
    "Noche":    { p3: "us_tx_pick3_evening", p4: "us_tx_daily4_evening" },
  },
  newjersey: {
    "Mediodía": { p3: "us_nj_pick3_mid", p4: "us_nj_pick4_mid" },
    "Noche":    { p3: "us_nj_pick3_eve", p4: "us_nj_pick4_eve" },
  },
  // ----- Caribe -----
  pr: { // Puerto Rico Pega 3 / Pega 4
    "Mediodía": { p3: "pr_pega3_day",   p4: "pr_pega4_day" },
    "Noche":    { p3: "pr_pega3_night", p4: "pr_pega4_night" },
  },
  // Other US states + RD/Venezuela/España: add their official magayo codes from
  // the Supported Games docs here once the account is active and coverage is
  // confirmed.
};
