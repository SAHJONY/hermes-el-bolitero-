// magayo.com game-code map — powers REAL data for every board once MAGAYO_API_KEY
// is set in Vercel. Each board maps its sessions to magayo game codes:
//   { "<board>": { "<Sesión>": { p3: "<pick3 code>", p4: "<pick4 code>" }, default: {...} } }
//
// Find your exact codes in the magayo dashboard (API → game codes) — they look
// like "us_fl_p3" / "us_fl_p4" etc. Unmapped or wrong codes simply fall back to
// the reference engine (no breakage). New York is handled by its free official
// feed and does not need a code here.
//
// Below are best-effort codes following magayo's documented pattern. VERIFY each
// against your magayo account; correct any that don't return data.

module.exports = {
  // ----- USA (Pick 3 / Pick 4 daily numbers) -----
  florida:        { "Mediodía": { p3: "us_fl_p3_mid", p4: "us_fl_p4_mid" }, "Noche": { p3: "us_fl_p3", p4: "us_fl_p4" } },
  georgia:        { "Mediodía": { p3: "us_ga_c3_mid", p4: "us_ga_c4_mid" }, "Tarde": { p3: "us_ga_c3_eve", p4: "us_ga_c4_eve" }, "Noche": { p3: "us_ga_c3", p4: "us_ga_c4" } },
  chicago:        { "Mediodía": { p3: "us_il_p3_mid", p4: "us_il_p4_mid" }, "Noche": { p3: "us_il_p3", p4: "us_il_p4" } },
  california:     { "Mediodía": { p3: "us_ca_d3_mid" }, "Noche": { p3: "us_ca_d3" } },
  texas:          { "Mediodía": { p3: "us_tx_p3_day", p4: "us_tx_p4_day" }, "Noche": { p3: "us_tx_p3_ngt", p4: "us_tx_p4_ngt" } },
  newjersey:      { "Mediodía": { p3: "us_nj_p3_mid", p4: "us_nj_p4_mid" }, "Noche": { p3: "us_nj_p3", p4: "us_nj_p4" } },
  pennsylvania:   { "Mediodía": { p3: "us_pa_p3_day", p4: "us_pa_p4_day" }, "Noche": { p3: "us_pa_p3", p4: "us_pa_p4" } },
  // ----- Caribe / LatAm / España (verify availability + codes in magayo) -----
  pr:             { "default": { p3: "pr_pega3", p4: "pr_pega4" } },
  // rd / venezuela / espana: add codes here if your magayo plan covers them.
};
