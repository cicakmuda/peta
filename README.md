# Performance Workspace (PWA prototype)

The app and the database are separate:

| File | Role |
|---|---|
| `index.html`, `core.js`, `screens.js`, `app.js` | The app (UI only, no data inside) |
| `data.json` | The database. Replace it to change what the app shows |
| `manifest.webmanifest`, `sw.js`, `icon*` | Makes it installable and usable offline |

## Run it
Any static host works (cPanel `public_html/subfolder`, Netlify, Vercel, GitHub Pages). It must be served over HTTPS
(or `localhost`) for install and offline to work. Opening `index.html` straight from disk will not load `data.json`.

Local test: `python3 -m http.server 8080` in this folder, then open http://localhost:8080

## How data flows
1. On start the app fetches `data.json`.
2. Edits, imports, experiments, decisions and watchlist entries are kept in the browser (localStorage) as a working copy.
3. Settings → Preferences → **Export database** downloads the updated `data.json`. Upload it to the host to make it the new shared baseline.
4. **Reset to shipped data.json** drops the local working copy.

## data.json (schema 1.0)
```
schema_version, demo, notice, generated_at
workspace   { name, owner, default_currency, default_attribution }
accounts    [ { id, name, currency, timezone, status, product, attribution } ]
targets     { <account_id>: { target_roas, breakeven_roas, target_cpa, aov, contribution_margin } }
rules       { min_purchases, min_spend, scale_roas_mult, cut_roas_mult, cpa_cut_mult,
              eval_window_days, min_days_live, review_interval_days, trend_drop_pct }
campaigns   [ { id, account_id, name, objective, status, daily_budget, created, bid_strategy } ]
adsets      [ { id, campaign_id, account_id, name, status, optimization } ]
ads         [ { id, adset_id, campaign_id, account_id, creative_id, name, status } ]
creatives   [ { id, account_id, name, format, headline, primary_text, cta, created, hue,
                duration_s, placements{Feeds,Reels,Stories,Other}, notes } ]
daily       [ { date, ad_id, spend, impressions, clicks, outbound_clicks, landing_page_views,
                add_to_cart, initiate_checkout, purchases, purchase_value } ]   key = date + ad_id
experiments [ ... ]   decisions [ ... ]   imports [ ... ]   watchlist [ ... ] (optional)
```
All derived metrics (ROAS, CPA, CPM, CTR, funnel rates) are calculated in the app from `daily`, never stored.

## Import file (what Claude should export each day/week)
```json
{ "schema_version": "1.0", "source": "claude-meta-export", "account_id": "act_alpha",
  "period": { "start": "2026-10-25", "end": "2026-10-31" }, "attribution": "7d_click_1d_view",
  "rows": [ { "date": "2026-10-31", "ad_id": "ad_001", "spend": 512300, "impressions": 13120,
              "clicks": 201, "outbound_clicks": 131, "landing_page_views": 98, "add_to_cart": 14,
              "initiate_checkout": 8, "purchases": 4, "purchase_value": 1188000 } ] }
```
New campaigns/ads must exist in the workspace before their rows import, or be included in the same file under
`"entities": { "accounts": [], "campaigns": [], "adsets": [], "ads": [], "creatives": [] }`.

Import Data also accepts a full `data.json`: its daily rows are merged by date + ad_id and new entities are added.
Use **Replace database** on that screen to swap the whole database instead.

All figures in the shipped `data.json` are synthetic demo data.
