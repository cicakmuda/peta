/* core.js — utilities, data model, shared UI components. Reads everything from data.json (see DB in app.js). */
'use strict';
const { useState, useMemo, useEffect, useRef, useCallback, createContext, useContext, Fragment } = React;
const html = htm.bind(React.createElement);
const FRAMED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const cx = (...a) => a.filter(Boolean).join(' ');
const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 8);

/* ---------- formatting ---------- */
const NF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const ok = (v) => v != null && isFinite(v);
function compact(v) { const a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M'; if (a >= 1e4) return (v / 1e3).toFixed(0) + 'K'; return NF.format(Math.round(v)); }
const fmt = {
  idr: (v) => ok(v) ? 'Rp' + compact(v) : '—',
  idrF: (v) => ok(v) ? 'Rp' + NF.format(Math.round(v)) : '—',
  int: (v) => ok(v) ? NF.format(Math.round(v)) : '—',
  dec: (v, d = 1) => ok(v) ? v.toFixed(d) : '—',
  x: (v) => ok(v) ? v.toFixed(2) + 'x' : '—',
  pct: (v, d = 2) => ok(v) ? (v * 100).toFixed(d) + '%' : '—',
  pct1: (v) => ok(v) ? (v * 100).toFixed(1) + '%' : '—',
  sp: (v, d = 1) => ok(v) ? (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%' : '—',
  date: (s) => { if (!s) return '—'; const d = new Date(s.length <= 10 ? s + 'T00:00:00Z' : s); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: s.length <= 10 ? 'UTC' : undefined }); },
  dateY: (s) => { if (!s) return '—'; const d = new Date(s.length <= 10 ? s + 'T00:00:00Z' : s); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: s.length <= 10 ? 'UTC' : undefined }); },
  dt: (s) => { if (!s) return '—'; const d = new Date(s); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); },
};
const METRICS = {
  spend: { label: 'Spend', f: fmt.idr, ff: fmt.idrF, dir: 0 },
  purchase_value: { label: 'Purchase value', f: fmt.idr, ff: fmt.idrF, dir: 1 },
  purchases: { label: 'Purchases', f: fmt.int, dir: 1 },
  roas: { label: 'ROAS', f: fmt.x, dir: 1 },
  cpa: { label: 'CPA', f: fmt.idr, ff: fmt.idrF, dir: -1 },
  cpm: { label: 'CPM', f: fmt.idr, ff: fmt.idrF, dir: -1 },
  ctr: { label: 'CTR (all)', f: fmt.pct, dir: 1 },
  octr: { label: 'Outbound CTR', f: fmt.pct, dir: 1 },
  impressions: { label: 'Impressions', f: fmt.int, dir: 0 },
  outbound_clicks: { label: 'Outbound clicks', f: fmt.int, dir: 1 },
  landing_page_views: { label: 'LPV', f: fmt.int, dir: 1 },
  add_to_cart: { label: 'ATC', f: fmt.int, dir: 1 },
  initiate_checkout: { label: 'Checkout', f: fmt.int, dir: 1 },
  aov: { label: 'AOV', f: fmt.idr, dir: 1 },
  cvr: { label: 'CVR (LPV→Purchase)', f: fmt.pct, dir: 1 },
};

/* ---------- dates ---------- */
const D = {
  add(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
  diff(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); },
  range(a, b) { const out = []; let c = a; while (c <= b) { out.push(c); c = D.add(c, 1); } return out; },
  valid(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z')); }
};

/* ---------- metrics ---------- */
const FIELDS = ['spend', 'impressions', 'clicks', 'outbound_clicks', 'landing_page_views', 'add_to_cart', 'initiate_checkout', 'purchases', 'purchase_value'];
function derive(a) {
  a.roas = a.spend ? a.purchase_value / a.spend : NaN;
  a.cpa = a.purchases ? a.spend / a.purchases : NaN;
  a.cpm = a.impressions ? a.spend / a.impressions * 1000 : NaN;
  a.ctr = a.impressions ? a.clicks / a.impressions : NaN;
  a.octr = a.impressions ? a.outbound_clicks / a.impressions : NaN;
  a.aov = a.purchases ? a.purchase_value / a.purchases : NaN;
  a.cvr = a.landing_page_views ? a.purchases / a.landing_page_views : NaN;
  a.lpvRate = a.outbound_clicks ? a.landing_page_views / a.outbound_clicks : NaN;
  a.atcRate = a.landing_page_views ? a.add_to_cart / a.landing_page_views : NaN;
  a.icRate = a.add_to_cart ? a.initiate_checkout / a.add_to_cart : NaN;
  a.purRate = a.initiate_checkout ? a.purchases / a.initiate_checkout : NaN;
  return a;
}
function agg(rows) { const a = { n: rows.length, days: new Set() }; FIELDS.forEach(f => a[f] = 0); for (const r of rows) { a.days.add(r.date); for (const f of FIELDS) { const v = r[f]; if (v != null) a[f] += v; } } a.nDays = a.days.size; delete a.days; return derive(a); }
function groupBy(rows, key) { const m = new Map(); for (const r of rows) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; }
function dailySeries(rows, dates) { const g = groupBy(rows, 'date'); return dates.map(d => agg(g.get(d) || [])); }
const mapBy = (arr) => Object.fromEntries((arr || []).map(x => [x.id, x]));
const median = (a) => { const s = a.filter(ok).sort((x, y) => x - y); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* ---------- model: normalise data.json ---------- */
function buildModel(db) {
  const ad = mapBy(db.ads);
  const seen = new Map(), dups = [];
  for (const r of db.daily) { const k = r.date + '|' + r.ad_id; if (seen.has(k)) dups.push({ key: k, first: seen.get(k), second: r }); seen.set(k, r); }
  const rows = [];
  for (const r of seen.values()) { const a = ad[r.ad_id]; if (!a) continue; rows.push(Object.assign({}, r, { campaign_id: a.campaign_id, adset_id: a.adset_id, account_id: a.account_id, creative_id: a.creative_id })); }
  let first = null, end = null; for (const r of rows) { if (!first || r.date < first) first = r.date; if (!end || r.date > end) end = r.date; }
  return { acc: mapBy(db.accounts), cmp: mapBy(db.campaigns), adsets: mapBy(db.adsets), ad, cr: mapBy(db.creatives), rows, dups, first, end, keys: seen };
}
function windows(M, range) {
  const end = M.end; const start = D.add(end, -(range - 1));
  const pEnd = D.add(start, -1); const pStart = D.add(pEnd, -(range - 1));
  return { cur: { start, end, dates: D.range(start, end) }, prev: { start: pStart, end: pEnd, dates: D.range(pStart, pEnd) } };
}
function pick(M, { acct = 'all', start, end, key, id, ids } = {}) {
  return M.rows.filter(r => (acct === 'all' || r.account_id === acct) && (!start || r.date >= start) && (!end || r.date <= end) && (!key || (ids ? ids.has(r[key]) : r[key] === id)));
}
const DEFAULT_RULES = { min_purchases: 15, min_spend: 1500000, scale_roas_mult: 1.15, cut_roas_mult: 0.8, cpa_cut_mult: 1.4, eval_window_days: 7, min_days_live: 7, review_interval_days: 3, trend_drop_pct: 20 };

/* ---------- decision engine (campaign level) ---------- */
const REC = {
  'Scale Candidate': 'p-good', 'Maintain': 'p-acc', 'Investigate': 'p-info', 'Improve': 'p-warn', 'Cut Candidate': 'p-bad', 'Insufficient Evidence': 'p-mute'
};
function evidenceLevel(purchases, rules) { if (purchases >= rules.min_purchases * 3) return 3; if (purchases >= rules.min_purchases) return 2; if (purchases > 0) return 1; return 0; }
function recommend(M, db, c, W) {
  const rules = db.rules || DEFAULT_RULES; const t = db.targets[c.account_id] || {};
  const rows = pick(M, { key: 'campaign_id', id: c.id, start: W.cur.start, end: W.cur.end });
  const prow = pick(M, { key: 'campaign_id', id: c.id, start: W.prev.start, end: W.prev.end });
  const m = agg(rows), p = agg(prow);
  const l7s = D.add(M.end, -6), p7s = D.add(M.end, -13), p7e = D.add(M.end, -7);
  const last7 = agg(rows.filter(r => r.date >= l7s));
  const prev7 = agg(pick(M, { key: 'campaign_id', id: c.id, start: p7s, end: p7e }));
  const trend = ok(last7.roas) && ok(prev7.roas) && prev7.roas > 0 ? last7.roas / prev7.roas - 1 : NaN;
  const spark = dailySeries(rows.filter(r => r.date >= l7s), D.range(l7s, M.end)).map(x => x.roas);
  const daysLive = D.diff(c.created, M.end) + 1;
  const ev = evidenceLevel(m.purchases, rules);
  const tr = t.target_roas, be = t.breakeven_roas;
  const reasons = [], risks = [], checks = [];
  let rec;
  if (daysLive < rules.min_days_live || m.purchases < rules.min_purchases || m.spend < rules.min_spend) {
    rec = 'Insufficient Evidence';
    if (daysLive < rules.min_days_live) reasons.push(`Live for ${daysLive} day${daysLive > 1 ? 's' : ''}; rules require ${rules.min_days_live} days before judging.`);
    if (m.purchases < rules.min_purchases) reasons.push(`${fmt.int(m.purchases)} purchases in the period; rules require at least ${rules.min_purchases}.`);
    if (m.spend < rules.min_spend) reasons.push(`Spend ${fmt.idrF(m.spend)} is below the ${fmt.idrF(rules.min_spend)} threshold.`);
    risks.push('Early ROAS swings widely with small purchase counts; a few orders can move it by 1x or more.');
    checks.push('Let the campaign exit learning before changing budget or creatives.');
  } else if (m.roas < be * rules.cut_roas_mult || (m.cpa > t.target_cpa * rules.cpa_cut_mult && m.roas < be)) {
    rec = 'Cut Candidate';
    reasons.push(`ROAS ${fmt.x(m.roas)} is below ${rules.cut_roas_mult}× break-even (${fmt.x(be * rules.cut_roas_mult)}).`);
    if (m.cpa > t.target_cpa) reasons.push(`CPA ${fmt.idr(m.cpa)} is ${fmt.pct1(m.cpa / t.target_cpa - 1)} above target ${fmt.idr(t.target_cpa)}.`);
    risks.push('Cutting removes any upper-funnel contribution this campaign makes to retargeting.');
    checks.push('Check whether one ad set or ad carries most of the loss before cutting the whole campaign.');
  } else if (m.roas < be) {
    rec = 'Improve';
    reasons.push(`ROAS ${fmt.x(m.roas)} is below break-even ${fmt.x(be)}, but within the tolerance band.`);
    risks.push('Each extra day at this ROAS loses contribution margin.');
    checks.push('Look for the weakest funnel stage (CTR, LPV rate, ATC rate) and test one fix.');
  } else if (m.roas < tr || (ok(trend) && trend < -rules.trend_drop_pct / 100)) {
    rec = 'Investigate';
    if (m.roas < tr) reasons.push(`ROAS ${fmt.x(m.roas)} is above break-even ${fmt.x(be)} but below target ${fmt.x(tr)}.`);
    if (ok(trend) && trend < -rules.trend_drop_pct / 100) reasons.push(`Last-7-day ROAS fell ${fmt.pct1(-trend)} versus the 7 days before.`);
    risks.push('Profitable today, but the margin to break-even is thin.');
    checks.push('Compare frequency and CTR over the last 14 days for fatigue signs.');
  } else if (m.roas >= tr * rules.scale_roas_mult && !(ok(trend) && trend < -0.1)) {
    rec = 'Scale Candidate';
    reasons.push(`ROAS ${fmt.x(m.roas)} is ${fmt.pct1(m.roas / tr - 1)} above target ${fmt.x(tr)}.`);
    reasons.push(`${fmt.int(m.purchases)} purchases provide ${ev >= 3 ? 'strong' : 'moderate'} evidence.`);
    risks.push('ROAS usually declines as budget rises; marginal ROAS will be lower than average ROAS.');
    checks.push('Raise budget in steps of 15–20% and re-check after the review window.');
  } else {
    rec = 'Maintain';
    reasons.push(`ROAS ${fmt.x(m.roas)} meets target ${fmt.x(tr)}.`);
    risks.push('No immediate risk; watch for creative fatigue.');
    checks.push('Keep budget steady; queue the next creative test.');
  }
  if (ok(p.roas) && p.spend > 0) reasons.push(`Previous period ROAS: ${fmt.x(p.roas)} (${fmt.sp(m.roas / p.roas - 1)}).`);
  return { c, m, p, rec, ev, trend, spark, daysLive, reasons, risks, checks, review: rules.review_interval_days, t };
}

/* ---------- creative scoring ---------- */
function creativeStats(M, db, W, acct) {
  const rules = db.rules || DEFAULT_RULES;
  const list = db.ads.filter(a => acct === 'all' || a.account_id === acct);
  const out = list.map(a => {
    const rows = pick(M, { key: 'ad_id', id: a.id, start: W.cur.start, end: W.cur.end });
    const m = agg(rows); const t = db.targets[a.account_id] || {};
    const cr = M.cr[a.creative_id] || {};
    const age = D.diff(cr.created || M.end, M.end) + 1;
    const half = Math.floor(W.cur.dates.length / 2);
    const early = agg(rows.filter(r => r.date < W.cur.dates[half])), late = agg(rows.filter(r => r.date >= W.cur.dates[half]));
    const ctrChange = ok(early.ctr) && early.impressions > 2000 && ok(late.ctr) ? late.ctr / early.ctr - 1 : NaN;
    return { a, cr, m, t, age, ctrChange, rows };
  });
  const medCtr = median(out.map(o => o.m.ctr)), medO = median(out.map(o => o.m.octr)), medCvr = median(out.map(o => o.m.cvr));
  for (const o of out) {
    const s = (v, ref, w) => ok(v) && ok(ref) && ref > 0 ? Math.max(0, Math.min(w, w * 0.5 * v / ref)) : 0;
    o.score = { hook: s(o.m.ctr, medCtr, 25), hold: s(o.m.octr, medO, 15), conv: s(o.m.cvr, medCvr, 30), eff: ok(o.m.roas) ? Math.max(0, Math.min(30, 30 * 0.5 * o.m.roas / o.t.target_roas)) : 0 };
    o.score.total = Math.round(o.score.hook + o.score.hold + o.score.conv + o.score.eff);
    let st = 'Stable';
    if (o.m.purchases < 5) st = 'Learning';
    else if (ok(o.ctrChange) && o.ctrChange < -0.2 && o.age > 21) st = 'Fatigue';
    else if (o.m.roas < o.t.breakeven_roas && o.m.spend > rules.min_spend / 2) st = 'Loser';
    else if (o.m.roas >= o.t.target_roas && o.m.purchases >= rules.min_purchases) st = 'Winner';
    o.status = st;
  }
  return out;
}
const CST = { Winner: 'p-good', Stable: 'p-acc', Learning: 'p-mute', Fatigue: 'p-warn', Loser: 'p-bad' };

/* ---------- export helpers ---------- */
function toCSV(cols, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.map(c => esc(c.label)).join(','), ...rows.map(r => cols.map(c => esc(c.raw ? c.raw(r) : (c.get ? c.get(r) : r[c.key]))).join(','))].join('\n');
}
async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; } }
async function saveFile(name, text, type, toast) {
  if (FRAMED) { const okc = await copyText(text); toast(okc ? `Downloads are blocked in this preview. ${name} was copied to the clipboard instead.` : `Downloads are blocked in this preview. Install the app to save ${name}.`); return; }
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); toast(`Saved ${name}`);
}

/* ---------- context ---------- */
const Ctx = createContext(null);
const useApp = () => useContext(Ctx);

/* ---------- small components ---------- */
function Pill({ cls = 'p-mute', plain, children, title }) { return html`<span className=${cx('pill', cls, plain && 'plain')} title=${title}>${children}</span>`; }
function Ev({ level }) { return html`<span className="ev" title=${['No evidence', 'Weak evidence', 'Moderate evidence', 'Strong evidence'][level]} aria-label=${['No', 'Weak', 'Moderate', 'Strong'][level] + ' evidence'}>${[1, 2, 3].map(i => html`<i key=${i} className=${i <= level ? 'on' : ''}></i>`)}</span>`; }
function Delta({ cur, prev, dir = 1, pts }) {
  if (!ok(cur) || !ok(prev) || prev === 0) return html`<span className="d-flat">—</span>`;
  const ch = pts ? cur - prev : cur / prev - 1;
  const good = dir === 0 ? null : (dir > 0 ? ch > 0 : ch < 0);
  const cls = Math.abs(ch) < 0.005 || good === null ? 'd-flat' : good ? 'd-up' : 'd-down';
  return html`<span className=${cls}>${ch > 0 ? '▲' : ch < 0 ? '▼' : ''} ${pts ? (Math.abs(ch) * 100).toFixed(2) + 'pp' : (Math.abs(ch) * 100).toFixed(1) + '%'}</span>`;
}
function Seg({ value, options, onChange, label }) {
  return html`<div className="seg" role="group" aria-label=${label}>${options.map(o => { const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.l : o; return html`<button key=${v} type="button" className=${value === v ? 'on' : ''} aria-pressed=${value === v} onClick=${() => onChange(v)}>${l}</button>`; })}</div>`;
}
function Field({ label, hint, err, children, id }) { return html`<div className="field"><label htmlFor=${id}>${label}</label>${children}${err ? html`<div className="err">${err}</div>` : hint ? html`<div className="hint">${hint}</div>` : null}</div>`; }
function Num({ id, value, onChange, step = 1, min, max, suffix }) {
  return html`<div className="row" style=${{ flexWrap: 'nowrap', gap: 4 }}><input id=${id} className="inp num" style=${{ width: '100%' }} type="number" value=${ok(value) ? value : ''} step=${step} min=${min} max=${max} onChange=${e => onChange(e.target.value === '' ? NaN : +e.target.value)} />${suffix ? html`<span className="muted sm">${suffix}</span>` : null}</div>`;
}
function Panel({ title, sub, right, children, style, bodyless }) {
  return html`<section className="panel" style=${style}>${title || right ? html`<div className="hd"><h3>${title}</h3>${sub ? html`<span className="sub">${sub}</span>` : null}${right ? html`<div className="r">${right}</div>` : null}</div>` : null}${bodyless ? children : html`<div className="bd">${children}</div>`}</section>`;
}
function PageHead({ title, q, actions, crumbs }) {
  return html`<div className="ph"><div style=${{ minWidth: 0 }}>${crumbs || null}<h1>${title}</h1>${q ? html`<div className="q">${q}</div>` : null}</div>${actions ? html`<div className="act">${actions}</div>` : null}</div>`;
}
function Dropdown({ label, children, btnClass = 'btn', align = 'right', ariaLabel }) {
  const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => { if (!open) return; const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; const k = (e) => { if (e.key === 'Escape') setOpen(false); }; document.addEventListener('mousedown', f); document.addEventListener('keydown', k); return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k); }; }, [open]);
  return html`<div className="dd" ref=${ref}><button type="button" className=${btnClass} aria-haspopup="true" aria-expanded=${open} aria-label=${ariaLabel} onClick=${() => setOpen(!open)}>${label}</button>${open ? html`<div className="dd-menu" style=${align === 'left' ? { left: 0, right: 'auto' } : null} onClick=${(e) => { if (e.target.closest('[data-close]')) setOpen(false); }}>${children}</div>` : null}</div>`;
}
function useEsc(fn) { useEffect(() => { const k = (e) => { if (e.key === 'Escape') fn(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [fn]); }
function Drawer({ title, sub, onClose, children, footer, wide }) {
  useEsc(onClose);
  return html`<${Fragment}><div className="scrim" onClick=${onClose}></div><aside className=${cx('drawer', wide && 'wide')} role="dialog" aria-modal="true" aria-label=${typeof title === 'string' ? title : 'Details'}><div className="hd"><div style=${{ minWidth: 0 }}><h2>${title}</h2>${sub ? html`<div className="sub">${sub}</div>` : null}</div><button className="x" aria-label="Close" onClick=${onClose}>×</button></div><div className="bd">${children}</div>${footer ? html`<div className="ft">${footer}</div>` : null}</aside></${Fragment}>`;
}
function Modal({ title, sub, onClose, children, footer, small }) {
  useEsc(onClose);
  return html`<${Fragment}><div className="scrim m" onClick=${onClose}></div><div className=${cx('modal', small && 'sm')} role="dialog" aria-modal="true" aria-label=${title}><div className="hd"><div><h2>${title}</h2>${sub ? html`<div className="sub">${sub}</div>` : null}</div><button className="x" aria-label="Close" onClick=${onClose}>×</button></div><div className="bd">${children}</div>${footer ? html`<div className="ft">${footer}</div>` : null}</div></${Fragment}>`;
}
function KPI({ label, value, cur, prev, dir, target, targetLabel, pts, onClick, selected, bar }) {
  const { compare } = useApp();
  return html`<div className=${cx('kpi', onClick && 'click', selected && 'sel')} onClick=${onClick} role=${onClick ? 'button' : null} tabIndex=${onClick ? 0 : null} onKeyDown=${onClick ? (e) => { if (e.key === 'Enter') onClick(); } : null}>
    <div className="l" title=${label}>${label}</div><div className="v">${value}</div>
    <div className="m">${compare && prev !== undefined ? html`<${Delta} cur=${cur} prev=${prev} dir=${dir} pts=${pts} /><span>vs prev</span>` : null}${target ? html`<span>· ${targetLabel || 'target'} ${target}</span>` : null}</div>
    ${bar != null ? html`<div className="bar"><i className=${bar >= 1 ? 'good' : bar >= 0.8 ? 'warn' : 'bad'} style=${{ width: Math.min(100, bar * 100) + '%' }}></i></div>` : null}
  </div>`;
}

/* ---------- charts ---------- */
function useWidth() { const ref = useRef(null); const [w, setW] = useState(600); useEffect(() => { if (!ref.current) return; const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width))); ro.observe(ref.current); return () => ro.disconnect(); }, []); return [ref, w]; }
function niceMax(v) { if (!ok(v) || v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function LineChart({ series, labels, f = (v) => v, height = 220, refLine, refLabel, area = true, bars }) {
  const [ref, w] = useWidth(); const [hi, setHi] = useState(null);
  const pad = { l: 56, r: 12, t: 12, b: 24 }; const H = height; const iw = w - pad.l - pad.r, ih = H - pad.t - pad.b;
  const all = series.flatMap(s => s.values).filter(ok).concat(refLine != null ? [refLine] : []);
  const ymax = niceMax(Math.max(...all, 0) * 1.08); const n = labels.length;
  const x = (i) => pad.l + (n <= 1 ? iw / 2 : i * iw / (n - 1)); const y = (v) => pad.t + ih - (v / ymax) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(k => k * ymax);
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
  const path = (vals) => { let d = '', pen = false; vals.forEach((v, i) => { if (!ok(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true; }); return d; };
  const onMove = (e) => { const r = e.currentTarget.getBoundingClientRect(); const px = e.clientX - r.left; const i = Math.round((px - pad.l) / (iw / Math.max(1, n - 1))); setHi(i >= 0 && i < n ? i : null); };
  const bw = Math.max(2, iw / n * 0.6);
  return html`<div className="chart" ref=${ref}>
    <svg width=${w} height=${H} onMouseMove=${onMove} onMouseLeave=${() => setHi(null)} role="img" aria-label=${series.map(s => s.name).join(', ') + ' chart'}>
      ${ticks.map((t, i) => html`<g key=${i}><line x1=${pad.l} x2=${w - pad.r} y1=${y(t)} y2=${y(t)} stroke="var(--line)" strokeDasharray=${i ? '2 3' : null} /><text x=${pad.l - 8} y=${y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--fg-3)" style=${{ fontVariantNumeric: 'tabular-nums' }}>${f(t)}</text></g>`)}
      ${labels.map((l, i) => (i % step === 0 && n - 1 - i >= step * 0.6) || i === n - 1 ? html`<text key=${i} x=${x(i)} y=${H - 6} textAnchor=${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="10.5" fill="var(--fg-3)">${l}</text>` : null)}
      ${bars ? bars.values.map((v, i) => ok(v) ? html`<rect key=${'b' + i} x=${x(i) - bw / 2} y=${y(v)} width=${bw} height=${Math.max(0, pad.t + ih - y(v))} fill=${bars.color} opacity="0.35" />` : null) : null}
      ${refLine != null ? html`<g><line x1=${pad.l} x2=${w - pad.r} y1=${y(refLine)} y2=${y(refLine)} stroke="var(--warn)" strokeDasharray="5 4" /><text x=${w - pad.r} y=${y(refLine) - 4} textAnchor="end" fontSize="10.5" fill="var(--warn)">${refLabel}</text></g>` : null}
      ${series.map((s, si) => html`<g key=${si}>
        ${area && si === 0 && !s.dashed ? html`<path d=${path(s.values) + `L${x(n - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z`} fill=${s.color} opacity="0.07" />` : null}
        <path d=${path(s.values)} fill="none" stroke=${s.color} strokeWidth=${s.dashed ? 1.5 : 2} strokeDasharray=${s.dashed ? '4 3' : null} strokeLinejoin="round" />
        ${!s.dashed && ok(s.values[n - 1]) ? html`<circle cx=${x(n - 1)} cy=${y(s.values[n - 1])} r="3" fill=${s.color} />` : null}
      </g>`)}
      ${hi != null ? html`<line x1=${x(hi)} x2=${x(hi)} y1=${pad.t} y2=${pad.t + ih} stroke="var(--line-2)" />` : null}
      ${hi != null ? series.map((s, si) => ok(s.values[hi]) ? html`<circle key=${si} cx=${x(hi)} cy=${y(s.values[hi])} r="3.5" fill="var(--surface)" stroke=${s.color} strokeWidth="2" />` : null) : null}
    </svg>
    ${hi != null ? html`<div className="tip" style=${{ left: Math.min(x(hi) + 10, w - 170), top: 8 }}><div className="muted" style=${{ marginBottom: 3 }}>${labels[hi]}</div>${series.map((s, si) => html`<div key=${si} className="k"><span><i style=${{ display: 'inline-block', width: 8, height: 2, background: s.color, marginRight: 5, verticalAlign: 'middle' }}></i>${s.name}</span><b className="num">${f(s.values[hi])}</b></div>`)}${bars ? html`<div className="k"><span>${bars.name}</span><b className="num">${bars.f(bars.raw ? bars.raw[hi] : bars.values[hi])}</b></div>` : null}</div>` : null}
  </div>`;
}
function Spark({ values, w = 72, h = 20, color = 'var(--s1)', target: refv }) {
  const v = values.filter(ok); if (v.length < 2) return html`<span className="muted sm">—</span>`;
  const mx = Math.max(...v, refv || 0) * 1.05, mn = Math.min(...v, refv != null ? refv : Infinity) * 0.95; const n = values.length;
  const x = (i) => 1 + i * (w - 2) / (n - 1), y = (q) => h - 2 - ((q - mn) / (mx - mn || 1)) * (h - 4);
  let d = '', pen = false; values.forEach((q, i) => { if (!ok(q)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(q).toFixed(1); pen = true; });
  const last = values[n - 1];
  return html`<svg width=${w} height=${h} style=${{ verticalAlign: 'middle' }} aria-hidden="true">${refv != null ? html`<line x1="0" x2=${w} y1=${y(refv)} y2=${y(refv)} stroke="var(--warn)" strokeDasharray="2 2" strokeWidth="1" />` : null}<path d=${d} fill="none" stroke=${color} strokeWidth="1.5" />${ok(last) ? html`<circle cx=${x(n - 1)} cy=${y(last)} r="2" fill=${color} />` : null}</svg>`;
}
function Bars({ items, f, max }) { // horizontal comparison bars
  const mx = max || Math.max(...items.map(i => ok(i.v) ? i.v : 0), 0) || 1;
  return html`<div style=${{ display: 'flex', flexDirection: 'column', gap: 4 }}>${items.map((it, i) => html`<div key=${i} style=${{ display: 'grid', gridTemplateColumns: 'minmax(0,140px) minmax(0,1fr) 72px', gap: 8, alignItems: 'center', fontSize: 12 }}><span style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title=${it.l}>${it.l}</span><div className="bar" style=${{ height: 8, marginTop: 0 }}><i style=${{ width: (ok(it.v) ? Math.max(0, it.v) / mx * 100 : 0) + '%', background: it.c || 'var(--s1)' }}></i></div><span className="num" style=${{ textAlign: 'right' }}>${f(it.v)}</span></div>`)}</div>`;
}

/* ---------- data table ---------- */
function DataTable({ id, cols, rows, rowKey = (r) => r.id, onRow, filters, csvName, selectable, toolbar, empty = 'No rows match these filters.', pageSize = 15, footer, maxH, initialSort, onSelect, selected: selectedProp }) {
  const { toast } = useApp();
  const [sort, setSort] = useState(initialSort || { k: null, d: -1 });
  const [q, setQ] = useState('');
  const [fv, setFv] = useState({});
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState(() => new Set(LS.get('cols.' + id, cols.filter(c => c.hide).map(c => c.key))));
  const [selIn, setSelIn] = useState(new Set());
  const sel = selectedProp || selIn; const setSel = (s) => { if (onSelect) onSelect(s); else setSelIn(s); };
  useEffect(() => { setPage(0); }, [q, fv, rows.length]);
  const vis = cols.filter(c => !hidden.has(c.key));
  const val = (c, r) => c.get ? c.get(r) : r[c.key];
  let data = rows;
  if (q) { const s = q.toLowerCase(); data = data.filter(r => cols.some(c => c.search && String(val(c, r) ?? '').toLowerCase().includes(s))); }
  if (filters) for (const f of filters) { const v = fv[f.key]; if (v && v !== 'all') data = data.filter(r => f.test(r, v)); }
  if (sort.k) { const c = cols.find(c => c.key === sort.k); if (c) data = [...data].sort((a, b) => { const x = c.sortv ? c.sortv(a) : val(c, a), y = c.sortv ? c.sortv(b) : val(c, b); const xa = ok(x) || typeof x === 'string', ya = ok(y) || typeof y === 'string'; if (!xa && !ya) return 0; if (!xa) return 1; if (!ya) return -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.d; }); }
  const pages = Math.max(1, Math.ceil(data.length / pageSize)); const pg = Math.min(page, pages - 1);
  const shown = data.slice(pg * pageSize, pg * pageSize + pageSize);
  const toggleCol = (k) => { const n = new Set(hidden); n.has(k) ? n.delete(k) : n.add(k); setHidden(n); LS.set('cols.' + id, [...n]); };
  const allSel = shown.length > 0 && shown.every(r => sel.has(rowKey(r)));
  const exportCSV = () => { const src = sel.size ? data.filter(r => sel.has(rowKey(r))) : data; saveFile((csvName || id) + '.csv', toCSV(vis.map(c => ({ ...c, raw: c.raw || ((r) => { const v = val(c, r); return typeof v === 'number' ? (ok(v) ? +v.toFixed(4) : '') : v; }) })), src), 'text/csv', toast); };
  return html`<div>
    <div className="tbar">
      <input className="inp" type="search" placeholder="Search…" aria-label="Search table" value=${q} onChange=${e => setQ(e.target.value)} id=${id + '-q'} />
      ${filters ? filters.map(f => html`<select key=${f.key} className="sel" aria-label=${f.label} value=${fv[f.key] || 'all'} onChange=${e => setFv({ ...fv, [f.key]: e.target.value })} id=${id + '-f-' + f.key}><option value="all">${f.label}: All</option>${f.options.map(o => html`<option key=${o} value=${o}>${o}</option>`)}</select>`) : null}
      ${toolbar || null}
      <div style=${{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
        ${selectable && sel.size ? html`<span className="muted sm">${sel.size} selected</span><button className="btn sm ghost" onClick=${() => setSel(new Set())}>Clear</button>` : null}
        <${Dropdown} label="Columns" btnClass="btn sm">${cols.map(c => html`<label key=${c.key} className="it"><input type="checkbox" checked=${!hidden.has(c.key)} disabled=${c.lock} onChange=${() => toggleCol(c.key)} />${c.label}</label>`)}</${Dropdown}>
        <button className="btn sm" onClick=${exportCSV}>Export CSV${selectable && sel.size ? ' (selected)' : ''}</button>
      </div>
    </div>
    <div className="tw" style=${maxH ? { '--tmax': maxH } : null}><table className="t">
      <thead><tr>
        ${selectable ? html`<th className="cb"><input type="checkbox" aria-label="Select page" checked=${allSel} onChange=${() => { const n = new Set(sel); shown.forEach(r => allSel ? n.delete(rowKey(r)) : n.add(rowKey(r))); setSel(n); }} /></th>` : null}
        ${vis.map((c, i) => html`<th key=${c.key} className=${cx(c.num && 'n', c.nosort ? '' : 'sort', i === 0 && !selectable && 'first')} aria-sort=${sort.k === c.key ? (sort.d > 0 ? 'ascending' : 'descending') : null} onClick=${c.nosort ? null : () => setSort({ k: c.key, d: sort.k === c.key ? -sort.d : (c.num ? -1 : 1) })} title=${c.tip}>${c.label}${sort.k === c.key ? html`<span className="ar">${sort.d > 0 ? '▲' : '▼'}</span>` : null}</th>`)}
      </tr></thead>
      <tbody>${shown.length ? shown.map(r => { const k = rowKey(r); return html`<tr key=${k} className=${cx(onRow && 'clk', sel.has(k) && 'selrow')} onClick=${onRow ? (e) => { if (e.target.closest('input,button,select,a')) return; onRow(r); } : null}>
        ${selectable ? html`<td className="cb"><input type="checkbox" aria-label="Select row" checked=${sel.has(k)} onChange=${() => { const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); setSel(n); }} /></td>` : null}
        ${vis.map((c, i) => html`<td key=${c.key} className=${cx(c.num && 'n', i === 0 && !selectable && 'first')} title=${c.titled ? String(val(c, r) ?? '') : null}>${c.render ? c.render(r) : c.f ? c.f(val(c, r)) : val(c, r)}</td>`)}
      </tr>`; }) : html`<tr><td colSpan=${vis.length + (selectable ? 1 : 0)}><div className="empty">${empty}</div></td></tr>`}</tbody>
      ${footer && data.length ? html`<tfoot><tr>${selectable ? html`<td></td>` : null}${vis.map((c, i) => html`<td key=${c.key} className=${cx(c.num && 'n', i === 0 && !selectable && 'first')}>${footer(c, data)}</td>`)}</tr></tfoot>` : null}
    </table></div>
    <div className="tfoot"><span>${data.length} row${data.length === 1 ? '' : 's'}${data.length !== rows.length ? ` of ${rows.length}` : ''}</span>
      ${pages > 1 ? html`<div className="r"><button className="btn sm" disabled=${pg === 0} onClick=${() => setPage(pg - 1)} aria-label="Previous page">‹</button><span>Page ${pg + 1} of ${pages}</span><button className="btn sm" disabled=${pg >= pages - 1} onClick=${() => setPage(pg + 1)} aria-label="Next page">›</button></div>` : null}
    </div>
  </div>`;
}
/* shared metric columns for entity tables */
function metricCols(extra = {}) {
  const c = (key, label, f, o = {}) => ({ key, label, f, num: true, get: (r) => r.m[key], ...o });
  return [
    c('spend', 'Spend', fmt.idr), c('purchase_value', 'Value', fmt.idr), c('purchases', 'Purch.', fmt.int), c('roas', 'ROAS', fmt.x, extra.roasRender ? { render: extra.roasRender } : {}), c('cpa', 'CPA', fmt.idr),
    c('cpm', 'CPM', fmt.idr), c('ctr', 'CTR', fmt.pct, { hide: true }), c('octr', 'Out. CTR', fmt.pct), c('impressions', 'Impr.', fmt.int, { hide: true }), c('landing_page_views', 'LPV', fmt.int, { hide: true }), c('add_to_cart', 'ATC', fmt.int, { hide: true }),
  ];
}
function sumFooter(c, data) {
  if (!c.num) return c === undefined ? '' : (c.key === 'name' ? 'Total' : '');
  const t = agg([]); for (const r of data) for (const f of FIELDS) t[f] += r.m[f] || 0; derive(t);
  const v = t[c.key]; return ok(v) && c.f ? c.f(v) : '';
}
function roasCell(r) { const t = r.t || {}; const v = r.m.roas; const cls = !ok(v) ? '' : v >= t.target_roas ? 'd-up' : v < t.breakeven_roas ? 'd-down' : ''; return html`<span className=${cls}>${fmt.x(v)}</span>`; }

/* creative preview (generated, no real images) */
function Preview({ cr, large }) {
  if (!cr) return null; const h = cr.hue || 200;
  const bg = `linear-gradient(160deg, hsl(${h} 32% 46%), hsl(${(h + 30) % 360} 30% 22%))`;
  return html`<div className=${cx('prev', large && 'lg')} style=${{ background: bg }} aria-label=${'Creative preview: ' + cr.headline}>
    <span className="fmt">${(cr.format || '').toUpperCase()}${cr.duration_s ? ' · ' + cr.duration_s + 's' : ''}</span><span className="dl">DEMO</span>
    ${cr.format === 'Video' ? html`<span className="play"></span>` : null}
    ${cr.format === 'Carousel' ? html`<span style=${{ position: 'absolute', top: 10, right: 54, display: 'flex', gap: 3 }}>${[0, 1, 2].map(i => html`<i key=${i} style=${{ width: 5, height: 5, borderRadius: '50%', background: i ? 'rgba(255,255,255,.5)' : '#fff' }}></i>`)}</span>` : null}
    <div className="hl">${cr.headline}</div><span className="cta">${cr.cta}</span>
  </div>`;
}
