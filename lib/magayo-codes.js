// magayo.com game-code map — powers REAL data for every mapped board once a
// MAGAYO_API_KEY from an ACTIVE (non-suspended) magayo account is set in Vercel.
//
// Shape: { "<board>": { "<Sesión>": { p3: "<pick3 code>", p4: "<pick4 code>" } } }
// App sessions are Spanish; the magayo suffix per state varies (taken verbatim
// from magayo's Supported Games docs — they are NOT uniform):
//   Mediodía → _mid | _day,   Noche → _eve | _night,   Mañana → _morning | _mor.
//
// INTEGRITY RULE: only boards where magayo serves BOTH a real 3-digit game and a
// real 4-digit game are mapped here. The results engine (lib/results.js) would
// otherwise pad a missing draw to "000"/"0000" and label it source:"real" — i.e.
// fabricate an official number. So pick3-only or pick4-only states are LEFT OUT
// on purpose and keep showing the clearly-labeled "DEMO · referencia" board:
//   California midday (no midday Daily 4), Minnesota, Arizona, Colorado, Kansas,
//   Oklahoma (pick3-only); Oregon, Massachusetts, Rhode Island, Washington
//   (pick4-only); Rep. Dominicana (do_pega3 only). New York is REAL via its own
//   free official feed and is intentionally omitted here. Unknown codes fall back
//   to the deterministic demo engine — no breakage.
//
// Codes are the OFFICIAL magayo identifiers from
// https://www.magayo.com/lottery-docs/api/supported-games/ (verified 2026-06-19).
// STATUS: live coverage requires an ACTIVE magayo account — a suspended account
// returns error 300 for every game (see /api/health?deep=1 to confirm the state).
// Maine/New Hampshire/Vermont share the Tri-State (us_ts_*) draw — same numbers.

module.exports = {
  // ----- USA: states with both a 3-digit and 4-digit daily game -----
  florida: {
    "Mediodía": { p3: "us_fl_cash3_mid", p4: "us_fl_play4_mid" },
    "Noche":    { p3: "us_fl_cash3_eve", p4: "us_fl_play4_eve" },
  },
  georgia: { // Cash 3/4 — midday, evening, night
    "Mediodía": { p3: "us_ga_cash3_mid",   p4: "us_ga_cash4_mid" },
    "Tarde":    { p3: "us_ga_cash3_eve",   p4: "us_ga_cash4_eve" },
    "Noche":    { p3: "us_ga_cash3_night", p4: "us_ga_cash4_night" },
  },
  chicago: { // Illinois
    "Mediodía": { p3: "us_il_pick3_mid", p4: "us_il_pick4_mid" },
    "Noche":    { p3: "us_il_pick3_eve", p4: "us_il_pick4_eve" },
  },
  california: { // Daily 4 draws only in the evening, so midday stays demo
    "Noche": { p3: "us_ca_daily3_eve", p4: "us_ca_daily4" },
  },
  texas: { // 4 daily draws
    "Mañana":   { p3: "us_tx_pick3_morning", p4: "us_tx_daily4_morning" },
    "Mediodía": { p3: "us_tx_pick3_day",     p4: "us_tx_daily4_day" },
    "Tarde":    { p3: "us_tx_pick3_evening", p4: "us_tx_daily4_evening" },
    "Noche":    { p3: "us_tx_pick3_night",   p4: "us_tx_daily4_night" },
  },
  newjersey: {
    "Mediodía": { p3: "us_nj_pick3_mid", p4: "us_nj_pick4_mid" },
    "Noche":    { p3: "us_nj_pick3_eve", p4: "us_nj_pick4_eve" },
  },
  pennsylvania: {
    "Mediodía": { p3: "us_pa_pick3_day", p4: "us_pa_pick4_day" },
    "Noche":    { p3: "us_pa_pick3_eve", p4: "us_pa_pick4_eve" },
  },
  ohio: {
    "Mediodía": { p3: "us_oh_pick3_mid", p4: "us_oh_pick4_mid" },
    "Noche":    { p3: "us_oh_pick3_eve", p4: "us_oh_pick4_eve" },
  },
  michigan: {
    "Mediodía": { p3: "us_mi_daily3_mid", p4: "us_mi_daily4_mid" },
    "Noche":    { p3: "us_mi_daily3_eve", p4: "us_mi_daily4_eve" },
  },
  virginia: {
    "Mediodía": { p3: "us_va_pick3_day",   p4: "us_va_pick4_day" },
    "Noche":    { p3: "us_va_pick3_night", p4: "us_va_pick4_night" },
  },
  northcarolina: {
    "Mediodía": { p3: "us_nc_pick3_day", p4: "us_nc_pick4_day" },
    "Noche":    { p3: "us_nc_pick3_eve", p4: "us_nc_pick4_eve" },
  },
  southcarolina: {
    "Mediodía": { p3: "us_sc_pick3_mid", p4: "us_sc_pick4_mid" },
    "Noche":    { p3: "us_sc_pick3_eve", p4: "us_sc_pick4_eve" },
  },
  tennessee: { // Cash 3/4 — morning, midday, evening
    "Mañana":   { p3: "us_tn_cash3_mor", p4: "us_tn_cash4_mor" },
    "Mediodía": { p3: "us_tn_cash3_mid", p4: "us_tn_cash4_mid" },
    "Noche":    { p3: "us_tn_cash3_eve", p4: "us_tn_cash4_eve" },
  },
  maryland: {
    "Mediodía": { p3: "us_md_pick3_mid", p4: "us_md_pick4_mid" },
    "Noche":    { p3: "us_md_pick3_eve", p4: "us_md_pick4_eve" },
  },
  connecticut: {
    "Mediodía": { p3: "us_ct_play3_day",   p4: "us_ct_play4_day" },
    "Noche":    { p3: "us_ct_play3_night", p4: "us_ct_play4_night" },
  },
  dc: { // Washington DC — DC-3 / DC-4
    "Mediodía": { p3: "us_dc_dc3_mid", p4: "us_dc_dc4_mid" },
    "Noche":    { p3: "us_dc_dc3_eve", p4: "us_dc_dc4_eve" },
  },
  indiana: {
    "Mediodía": { p3: "us_in_daily3_mid", p4: "us_in_daily4_mid" },
    "Noche":    { p3: "us_in_daily3_eve", p4: "us_in_daily4_eve" },
  },
  missouri: {
    "Mediodía": { p3: "us_mo_pick3_mid", p4: "us_mo_pick4_mid" },
    "Noche":    { p3: "us_mo_pick3_eve", p4: "us_mo_pick4_eve" },
  },
  kentucky: {
    "Mediodía": { p3: "us_ky_pick3_mid", p4: "us_ky_pick4_mid" },
    "Noche":    { p3: "us_ky_pick3_eve", p4: "us_ky_pick4_eve" },
  },
  arkansas: {
    "Mediodía": { p3: "us_ar_cash3_mid", p4: "us_ar_cash4_mid" },
    "Noche":    { p3: "us_ar_cash3_eve", p4: "us_ar_cash4_eve" },
  },
  iowa: {
    "Mediodía": { p3: "us_ia_pick3_mid", p4: "us_ia_pick4_mid" },
    "Noche":    { p3: "us_ia_pick3_eve", p4: "us_ia_pick4_eve" },
  },
  mississippi: {
    "Mediodía": { p3: "us_ms_cash3_mid", p4: "us_ms_cash4_mid" },
    "Noche":    { p3: "us_ms_cash3_eve", p4: "us_ms_cash4_eve" },
  },
  delaware: {
    "Mediodía": { p3: "us_de_play3_day",   p4: "us_de_play4_day" },
    "Noche":    { p3: "us_de_play3_night", p4: "us_de_play4_night" },
  },
  // Tri-State (Maine / New Hampshire / Vermont share one draw)
  maine: {
    "Mediodía": { p3: "us_ts_pick3_day", p4: "us_ts_pick4_day" },
    "Noche":    { p3: "us_ts_pick3_eve", p4: "us_ts_pick4_eve" },
  },
  newhampshire: {
    "Mediodía": { p3: "us_ts_pick3_day", p4: "us_ts_pick4_day" },
    "Noche":    { p3: "us_ts_pick3_eve", p4: "us_ts_pick4_eve" },
  },
  vermont: {
    "Mediodía": { p3: "us_ts_pick3_day", p4: "us_ts_pick4_day" },
    "Noche":    { p3: "us_ts_pick3_eve", p4: "us_ts_pick4_eve" },
  },
  // ----- USA: single evening draw (app session "Noche" only) -----
  wisconsin:    { "Noche": { p3: "us_wi_pick3_eve", p4: "us_wi_pick4_eve" } },
  louisiana:    { "Noche": { p3: "us_la_pick3",     p4: "us_la_pick4" } },
  newmexico:    { "Noche": { p3: "us_nm_pick3_eve", p4: "us_nm_pick4_eve" } },
  idaho:        { "Noche": { p3: "us_id_pick3_night", p4: "us_id_pick4_night" } },
  westvirginia: { "Noche": { p3: "us_wv_daily3",    p4: "us_wv_daily4" } },
  nebraska:     { "Noche": { p3: "us_ne_pick3",     p4: "us_ne_pick4" } },
  // ----- Caribe -----
  pr: { // Puerto Rico Pega 3 / Pega 4
    "Mediodía": { p3: "pr_pega3_day",   p4: "pr_pega4_day" },
    "Noche":    { p3: "pr_pega3_night", p4: "pr_pega4_night" },
  },
};
