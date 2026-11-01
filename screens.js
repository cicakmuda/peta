/* screens.js — every workspace module. All numbers come from the shared model built from data.json. */
'use strict';

function entityRows(M, db, level, W, acct, filter) {
  const list = { campaign: db.campaigns, adset: db.adsets, ad: db.ads, account: db.accounts }[level];
  const key = level === 'account' ? 'account_id' : level + '_id';
  const cur = groupBy(pick(M, { acct, start: W.cur.start, end: W.cur.end }), key);
  const prev = groupBy(pick(M, { acct, start: W.prev.start, end: W.prev.end }), key);
  return list.filter(x => acct === 'all' || (level === 'account' ? x.id === acct : x.account_id === acct)).filter(filter || (() => true))
    .map(x => ({ ...x, m: agg(cur.get(x.id) || []), p: agg(prev.get(x.id) || []), t: db.targets[level === 'account' ? x.id : x.account_id] || {} }));
}
function weightedTarget(db, rows, field = 'target_roas') { let s = 0, w = 0; for (const r of rows) { const t = db.targets[r.account_id]; if (t) { s += t[field] * r.spend; w += r.spend; } } return w ? s / w : NaN; }
const accName = (M, id) => id === 'all' ? 'All accounts' : (M.acc[id] ? M.acc[id].name : id);
const entName = (M, level, id) => { const o = level === 'campaign' ? M.cmp[id] : level === 'adset' ? M.adsets[id] : level === 'ad' ? M.ad[id] : null; return o ? o.name : id; };

/* ---------- alerts ---------- */
function computeAlerts(M, db, W, acct) {
  const out = []; const rules = db.rules || DEFAULT_RULES;
  db.campaigns.filter(c => acct === 'all' || c.account_id === acct).forEach(c => {
    const r = recommend(M, db, c, W);
    if (r.rec === 'Cut Candidate') out.push({ sev: 'bad', title: `${c.name}: ROAS ${fmt.x(r.m.roas)} vs break-even ${fmt.x(r.t.breakeven_roas)}`, detail: `${fmt.idr(r.m.spend)} spent this period. Recommendation: cut candidate.`, go: { page: 'decision', id: c.id } });
    else if (r.rec === 'Improve') out.push({ sev: 'warn', title: `${c.name}: below break-even`, detail: `ROAS ${fmt.x(r.m.roas)}; improve the weakest funnel stage.`, go: { page: 'decision', id: c.id } });
    else if (ok(r.trend) && r.trend < -rules.trend_drop_pct / 100 && r.rec !== 'Insufficient Evidence') out.push({ sev: 'warn', title: `${c.name}: ROAS down ${fmt.pct1(-r.trend)} week over week`, detail: `Last 7 days ${fmt.x(agg(pick(M, { key: 'campaign_id', id: c.id, start: D.add(M.end, -6), end: M.end })).roas)}.`, go: { page: 'decision', id: c.id } });
  });
  creativeStats(M, db, W, acct).forEach(o => {
    if (o.status === 'Fatigue') out.push({ sev: 'warn', title: `Creative fatigue: ${o.cr.name}`, detail: `CTR ${fmt.sp(o.ctrChange)} from first to second half of the period; ${o.age} days old.`, go: { page: 'creative', id: o.a.id } });
    else if (o.m.spend > rules.min_spend && o.m.roas < o.t.breakeven_roas * 0.5) out.push({ sev: 'bad', title: `High spend, low conversion: ${o.cr.name}`, detail: `${fmt.idr(o.m.spend)} spend, ${fmt.int(o.m.purchases)} purchases, ROAS ${fmt.x(o.m.roas)}.`, go: { page: 'creative', id: o.a.id } });
  });
  const lag = D.diff(M.end, new Date().toISOString().slice(0, 10));
  if (lag > 2) out.push({ sev: 'info', title: `Data is ${lag} days old`, detail: `Latest row: ${fmt.dateY(M.end)}. Import a fresh export.`, go: { page: 'import' } });
  const rank = { bad: 0, warn: 1, info: 2 }; return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}

/* ---------- campaign drawer (shared by Overview + Decision) ---------- */
function CampaignDrawer({ id, onClose }) {
  const { M, db, W, nav, openModal, compare } = useApp();
  const c = M.cmp[id]; const [metric, setMetric] = useState('roas');
  if (!c) return null;
  const r = recommend(M, db, c, W);
  const rows = pick(M, { key: 'campaign_id', id, start: W.cur.start, end: W.cur.end });
  const prow = pick(M, { key: 'campaign_id', id, start: W.prev.start, end: W.prev.end });
  const ds = dailySeries(rows, W.cur.dates), pds = dailySeries(prow, W.prev.dates);
  const adsets = entityRows(M, db, 'adset', W, c.account_id, x => x.campaign_id === id);
  const watching = (db.watchlist || []).some(w => w.campaign_id === id);
  const mm = METRICS[metric];
  return html`<${Drawer} wide title=${c.name} sub=${html`${accName(M, c.account_id)} · created ${fmt.dateY(c.created)} · ${r.daysLive} days live · daily budget ${fmt.idrF(c.daily_budget)}`} onClose=${onClose}
    footer=${html`<button className="btn" onClick=${() => openModal({ type: 'watch', campaign_id: id })}>${watching ? 'Edit watchlist entry' : 'Add to watchlist'}</button><button className="btn" onClick=${() => openModal({ type: 'experiment', prefill: { account_id: c.account_id, campaign_id: id } })}>Create experiment</button><button className="btn pri" onClick=${() => openModal({ type: 'decision', prefill: { account_id: c.account_id, level: 'campaign', entity_id: id, metric: 'ROAS' } })}>Record decision</button><span style=${{ marginLeft: 'auto' }}></span><button className="btn ghost" onClick=${() => { onClose(); nav('overview', { drill: { campaign: id }, tab: 'adset' }); }}>Open ad sets</button>`}>
    <div className="row" style=${{ gap: 10 }}><${Pill} cls=${REC[r.rec]}>${r.rec}</${Pill}><span className="sm muted">Evidence</span><${Ev} level=${r.ev} /><span className="sm muted">${fmt.int(r.m.purchases)} purchases · review in ${r.review} days</span>${watching ? html`<${Pill} cls="p-info" plain>On watchlist</${Pill}>` : null}</div>
    <div className="kpis k6">
      <${KPI} label="Spend" value=${fmt.idr(r.m.spend)} cur=${r.m.spend} prev=${r.p.spend} dir=${0} />
      <${KPI} label="Purchases" value=${fmt.int(r.m.purchases)} cur=${r.m.purchases} prev=${r.p.purchases} dir=${1} />
      <${KPI} label="ROAS" value=${fmt.x(r.m.roas)} cur=${r.m.roas} prev=${r.p.roas} dir=${1} target=${fmt.x(r.t.target_roas)} />
      <${KPI} label="CPA" value=${fmt.idr(r.m.cpa)} cur=${r.m.cpa} prev=${r.p.cpa} dir=${-1} target=${fmt.idr(r.t.target_cpa)} />
      <${KPI} label="CPM" value=${fmt.idr(r.m.cpm)} cur=${r.m.cpm} prev=${r.p.cpm} dir=${-1} />
      <${KPI} label="Out. CTR" value=${fmt.pct(r.m.octr)} cur=${r.m.octr} prev=${r.p.octr} dir=${1} pts />
    </div>
    <${Panel} title="Daily trend" right=${html`<${Seg} label="Metric" value=${metric} onChange=${setMetric} options=${[{ v: 'roas', l: 'ROAS' }, { v: 'spend', l: 'Spend' }, { v: 'purchases', l: 'Purch.' }, { v: 'cpa', l: 'CPA' }]} />`}>
      <${LineChart} height=${180} labels=${W.cur.dates.map(fmt.date)} f=${mm.f} refLine=${metric === 'roas' ? r.t.target_roas : metric === 'cpa' ? r.t.target_cpa : null} refLabel="Target"
        series=${[{ name: 'Current', values: ds.map(d => d[metric]), color: 'var(--s1)' }, ...(compare ? [{ name: 'Previous period', values: pds.map(d => d[metric]), color: 'var(--s2)', dashed: true }] : [])]} />
    </${Panel}>
    <div className="grid g3">
      <div className="sec"><h4>Why this recommendation</h4><ul className="list">${r.reasons.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></div>
      <div className="sec"><h4>Risks</h4><ul className="list">${r.risks.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></div>
      <div className="sec"><h4>Suggested check</h4><ul className="list">${r.checks.map((x, i) => html`<li key=${i}>${x}</li>`)}<li>Review again on ${fmt.dateY(D.add(M.end, r.review))}.</li></ul></div>
    </div>
    <${Panel} title="Ad sets" sub="Click an ad set to see its ads" bodyless>
      <div className="tw"><table className="t"><thead><tr><th>Ad set</th><th className="n">Spend</th><th className="n">Purch.</th><th className="n">ROAS</th><th className="n">CPA</th><th className="n">Out. CTR</th><th className="n">Share</th></tr></thead>
      <tbody>${adsets.map(a => html`<tr key=${a.id} className="clk" onClick=${() => { onClose(); nav('overview', { drill: { campaign: id, adset: a.id }, tab: 'ad' }); }}><td className="name">${a.name}</td><td className="n">${fmt.idr(a.m.spend)}</td><td className="n">${fmt.int(a.m.purchases)}</td><td className="n">${roasCell(a)}</td><td className="n">${fmt.idr(a.m.cpa)}</td><td className="n">${fmt.pct(a.m.octr)}</td><td className="n">${fmt.pct1(a.m.spend / (r.m.spend || 1))}</td></tr>`)}</tbody></table></div>
    </${Panel}>
    <div className="note">Recommendations are rule-based on observed demo data and your Decision Rules. They do not change anything in Meta Ads.</div>
  </${Drawer}>`;
}

/* ---------- 1. Overview ---------- */
function Overview({ params }) {
  const { M, db, W, acct, compare, nav, setDrawer } = useApp();
  const [metric, setMetric] = useState('roas');
  const [tab, setTab] = useState(params.tab || 'campaign');
  const [drill, setDrill] = useState(params.drill || {});
  useEffect(() => { if (params.tab) setTab(params.tab); if (params.drill) setDrill(params.drill); }, [params]);
  const cur = pick(M, { acct, start: W.cur.start, end: W.cur.end }), prev = pick(M, { acct, start: W.prev.start, end: W.prev.end });
  const m = agg(cur), p = agg(prev);
  const tRoas = acct === 'all' ? weightedTarget(db, cur) : db.targets[acct].target_roas;
  const tRoasP = acct === 'all' ? weightedTarget(db, prev) : tRoas;
  const tCpa = acct === 'all' ? weightedTarget(db, cur, 'target_cpa') : db.targets[acct].target_cpa;
  const ds = dailySeries(cur, W.cur.dates), pds = dailySeries(prev, W.prev.dates);
  const alerts = useMemo(() => computeAlerts(M, db, W, acct), [M, db, W, acct]);
  const mm = METRICS[metric];
  const levels = { campaign: 'Campaigns', adset: 'Ad sets', ad: 'Ads / creatives', account: 'Accounts' };
  const filt = tab === 'adset' && drill.campaign ? (x) => x.campaign_id === drill.campaign : tab === 'ad' && drill.adset ? (x) => x.adset_id === drill.adset : tab === 'ad' && drill.campaign ? (x) => x.campaign_id === drill.campaign : null;
  const rows = entityRows(M, db, tab, W, acct, filt);
  const nameCol = { key: 'name', label: tab === 'account' ? 'Account' : levels[tab].replace(/s$/, '').replace('Ads / creative', 'Ad'), lock: true, search: true, titled: true, sortv: r => r.name,
    render: (r) => tab === 'campaign' ? html`<button className="link" onClick=${() => setDrawer({ type: 'campaign', id: r.id })}>${r.name}</button>`
      : tab === 'adset' ? html`<button className="link" onClick=${() => { setDrill({ ...drill, campaign: r.campaign_id, adset: r.id }); setTab('ad'); }}>${r.name}</button>`
      : tab === 'ad' ? html`<button className="link" onClick=${() => setDrawer({ type: 'creative', id: r.id })}>${r.name}</button>`
      : html`<button className="link" onClick=${() => nav(null, { acct: r.id })}>${r.name}</button>` };
  const cols = [nameCol,
    ...(tab !== 'account' && acct === 'all' ? [{ key: 'acc', label: 'Account', get: r => accName(M, r.account_id), search: true }] : []),
    ...(tab === 'adset' || tab === 'ad' ? [{ key: 'cmp', label: 'Campaign', get: r => (M.cmp[r.campaign_id] || {}).name, search: true, hide: !!drill.campaign, titled: true }] : []),
    { key: 'status', label: 'Status', get: r => r.status || '—', render: r => html`<${Pill} cls=${r.status === 'Active' ? 'p-good' : 'p-mute'}>${r.status}</${Pill}>` },
    ...metricCols({ roasRender: roasCell }),
    { key: 'droas', label: 'Δ ROAS', num: true, get: r => ok(r.m.roas) && ok(r.p.roas) && r.p.roas ? r.m.roas / r.p.roas - 1 : NaN, render: r => html`<${Delta} cur=${r.m.roas} prev=${r.p.roas} dir=${1} />`, hide: !compare },
  ];
  const crumbs = (drill.campaign || drill.adset) && tab !== 'campaign' ? html`<div className="crumbs" style=${{ padding: '8px 12px 0' }}><button onClick=${() => { setDrill({}); setTab('campaign'); }}>All campaigns</button>
    ${drill.campaign ? html`<span className="sep">/</span><button onClick=${() => { setDrill({ campaign: drill.campaign }); setTab('adset'); }}>${entName(M, 'campaign', drill.campaign)}</button>` : null}
    ${drill.adset ? html`<span className="sep">/</span><span>${entName(M, 'adset', drill.adset)}</span>` : null}
    <span className="sep">·</span><button onClick=${() => setDrill({})}>Clear filter</button></div>` : null;
  return html`<div className="page">
    <${PageHead} title="Overview" q=${`${accName(M, acct)} · ${fmt.date(W.cur.start)} – ${fmt.dateY(W.cur.end)}${compare ? ` vs ${fmt.date(W.prev.start)} – ${fmt.date(W.prev.end)}` : ''}`} />
    <div className="kpis">
      <${KPI} label="Total spend" value=${fmt.idr(m.spend)} cur=${m.spend} prev=${p.spend} dir=${0} />
      <${KPI} label="Purchase value" value=${fmt.idr(m.purchase_value)} cur=${m.purchase_value} prev=${p.purchase_value} dir=${1} />
      <${KPI} label="Purchases" value=${fmt.int(m.purchases)} cur=${m.purchases} prev=${p.purchases} dir=${1} />
      <${KPI} label="ROAS" value=${fmt.x(m.roas)} cur=${m.roas} prev=${p.roas} dir=${1} target=${fmt.x(tRoas)} />
      <${KPI} label="CPA" value=${fmt.idr(m.cpa)} cur=${m.cpa} prev=${p.cpa} dir=${-1} target=${fmt.idr(tCpa)} />
      <${KPI} label="CPM" value=${fmt.idr(m.cpm)} cur=${m.cpm} prev=${p.cpm} dir=${-1} />
      <${KPI} label="Outbound CTR" value=${fmt.pct(m.octr)} cur=${m.octr} prev=${p.octr} dir=${1} pts />
      <${KPI} label="Target ROAS achieved" value=${fmt.pct1(m.roas / tRoas)} cur=${m.roas / tRoas} prev=${p.roas / tRoasP} dir=${1} bar=${m.roas / tRoas} />
    </div>
    <div className="split">
      <${Panel} title="Daily performance" sub=${compare ? 'Dashed: previous period, aligned by day' : null} right=${html`<${Seg} label="Chart metric" value=${metric} onChange=${setMetric} options=${[{ v: 'roas', l: 'ROAS' }, { v: 'spend', l: 'Spend' }, { v: 'purchases', l: 'Purchases' }, { v: 'cpa', l: 'CPA' }]} />`}>
        <${LineChart} labels=${W.cur.dates.map(fmt.date)} f=${mm.f} refLine=${metric === 'roas' ? tRoas : metric === 'cpa' ? tCpa : null} refLabel=${'Target ' + (metric === 'roas' ? fmt.x(tRoas) : fmt.idr(tCpa))}
          series=${[{ name: mm.label, values: ds.map(d => d[metric]), color: 'var(--s1)' }, ...(compare ? [{ name: 'Previous', values: pds.map(d => d[metric]), color: 'var(--s2)', dashed: true }] : [])]}
          bars=${metric === 'roas' ? { name: 'Spend', values: ds.map(d => d.spend).map(v => v / Math.max(...ds.map(d => d.spend), 1) * tRoas * 0.6), color: 'var(--s2)', raw: ds.map(d => d.spend), f: fmt.idr } : null} />
        <div className="legend" style=${{ marginTop: 6 }}><span><i style=${{ background: 'var(--s1)' }}></i>${mm.label}</span>${compare ? html`<span><i className="dash"></i>Previous period</span>` : null}${metric === 'roas' || metric === 'cpa' ? html`<span><i style=${{ background: 'var(--warn)' }}></i>Target</span>` : null}${metric === 'roas' ? html`<span><i style=${{ background: 'var(--s2)', opacity: .5, height: 8 }}></i>Relative daily spend</span>` : null}</div>
      </${Panel}>
      <${Panel} title="Performance alerts" sub=${alerts.length + ' open'} bodyless>
        <div className="alerts" style=${{ maxHeight: 300, overflow: 'auto' }}>${alerts.length ? alerts.slice(0, 12).map((a, i) => html`<button key=${i} className="alert" onClick=${() => a.go.id ? (a.go.page === 'creative' ? setDrawer({ type: 'creative', id: a.go.id }) : setDrawer({ type: 'campaign', id: a.go.id })) : nav(a.go.page)}><span className=${'sv ' + a.sev}></span><div><div className="tt">${a.title}</div><div className="dd2">${a.detail}</div></div></button>`) : html`<div className="empty">No alerts for this selection.</div>`}</div>
      </${Panel}>
    </div>
    <section className="panel">
      <div className="tabs" role="tablist">${Object.entries(levels).map(([k, l]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => { setTab(k); if (k === 'campaign' || k === 'account') setDrill({}); }}>${l}</button>`)}</div>
      ${crumbs}
      <${DataTable} key=${tab + JSON.stringify(drill)} id=${'ov-' + tab} cols=${cols} rows=${rows} selectable csvName=${'overview-' + tab}
        initialSort=${{ k: 'spend', d: -1 }} footer=${(c, data) => c.key === 'name' ? 'Total' : sumFooter(c, data)}
        filters=${tab === 'account' ? null : [{ key: 'perf', label: 'ROAS', options: ['Above target', 'Between', 'Below break-even', 'No purchases'], test: (r, v) => v === 'Above target' ? r.m.roas >= r.t.target_roas : v === 'Between' ? r.m.roas < r.t.target_roas && r.m.roas >= r.t.breakeven_roas : v === 'Below break-even' ? r.m.roas < r.t.breakeven_roas : !(r.m.purchases > 0) }]} />
    </section>
  </div>`;
}

/* ---------- 2. Campaign Decision ---------- */
function Decision() {
  const { M, db, W, acct, setDrawer } = useApp();
  const [f, setF] = useState('all');
  const recs = useMemo(() => db.campaigns.filter(c => acct === 'all' || c.account_id === acct).map(c => recommend(M, db, c, W)), [M, db, W, acct]);
  const watch = new Set((db.watchlist || []).map(w => w.campaign_id));
  const cnt = (k) => recs.filter(r => r.rec === k).length;
  const attention = recs.filter(r => ['Cut Candidate', 'Improve', 'Investigate'].includes(r.rec));
  const atRisk = recs.filter(r => ['Cut Candidate', 'Improve'].includes(r.rec)).reduce((s, r) => s + r.m.spend, 0);
  const total = recs.reduce((s, r) => s + r.m.spend, 0);
  const shown = recs.filter(r => f === 'all' ? true : f === 'attention' ? attention.includes(r) : f === 'under' ? ['Cut Candidate', 'Improve'].includes(r.rec) : f === 'watch' ? watch.has(r.c.id) : r.rec === f).map(r => ({ ...r, id: r.c.id }));
  const tile = (key, label, v, sub, cls) => html`<div className=${cx('kpi click', f === key && 'sel')} role="button" tabIndex="0" aria-pressed=${f === key} onClick=${() => setF(f === key ? 'all' : key)} onKeyDown=${e => e.key === 'Enter' && setF(f === key ? 'all' : key)}><div className="l">${label}</div><div className=${cx('v', cls)}>${v}</div><div className="m">${sub}</div></div>`;
  const cols = [
    { key: 'name', label: 'Campaign', lock: true, search: true, get: r => r.c.name, titled: true, render: r => html`<button className="link" onClick=${() => setDrawer({ type: 'campaign', id: r.c.id })}>${r.c.name}</button>${watch.has(r.c.id) ? html` <span className="sub" title="On watchlist">· watching</span>` : null}` },
    { key: 'acc', label: 'Account', get: r => accName(M, r.c.account_id), search: true },
    { key: 'spend', label: 'Spend', num: true, get: r => r.m.spend, f: fmt.idr },
    { key: 'purch', label: 'Purch.', num: true, get: r => r.m.purchases, f: fmt.int },
    { key: 'roas', label: 'ROAS', num: true, get: r => r.m.roas, render: r => roasCell({ m: r.m, t: r.t }) },
    { key: 'troas', label: 'Target', num: true, get: r => r.t.target_roas, f: fmt.x },
    { key: 'cpa', label: 'CPA', num: true, get: r => r.m.cpa, f: fmt.idr },
    { key: 'trend', label: '7-day ROAS', nosort: true, render: r => html`<span style=${{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><${Spark} values=${r.spark} ref=${r.t.target_roas} color=${r.trend < -0.15 ? 'var(--bad)' : 'var(--s1)'} /><span className=${cx('sm', r.trend < 0 ? 'd-down' : 'd-up')}>${ok(r.trend) ? fmt.sp(r.trend, 0) : ''}</span></span>` },
    { key: 'ev', label: 'Evidence', get: r => r.ev, render: r => html`<${Ev} level=${r.ev} />` },
    { key: 'rec', label: 'Recommendation', get: r => r.rec, search: true, sortv: r => Object.keys(REC).indexOf(r.rec), render: r => html`<${Pill} cls=${REC[r.rec]}>${r.rec}</${Pill}>` },
  ];
  return html`<div className="page">
    <${PageHead} title="Campaign Decision" q="What should I do with my campaigns today, and why?" />
    <div className="kpis k5">
      ${tile('attention', 'Needs attention', attention.length, 'cut, improve, investigate')}
      ${tile('Scale Candidate', 'Scale candidates', cnt('Scale Candidate'), 'above target with evidence', 'd-up')}
      ${tile('under', 'Underperforming', cnt('Cut Candidate') + cnt('Improve'), 'below break-even', 'd-down')}
      ${tile('Insufficient Evidence', 'Insufficient evidence', cnt('Insufficient Evidence'), 'too early to judge')}
      ${tile('under', 'Spend at risk', fmt.idr(atRisk), fmt.pct1(atRisk / (total || 1)) + ' of period spend')}
    </div>
    <section className="panel"><div className="tabs">${[['all', 'All'], ...Object.keys(REC).map(k => [k, k]), ['watch', 'Watchlist']].map(([k, l]) => html`<button key=${k} className=${f === k ? 'on' : ''} onClick=${() => setF(k)}>${l}<span className="c">${k === 'all' ? recs.length : k === 'watch' ? watch.size : cnt(k)}</span></button>`)}</div>
      <${DataTable} id="dec" cols=${cols} rows=${shown} onRow=${r => setDrawer({ type: 'campaign', id: r.c.id })} initialSort=${{ k: 'rec', d: 1 }} csvName="campaign-decisions" empty=${f === 'watch' ? 'No campaigns on your watchlist yet. Open a campaign and choose Add to watchlist.' : 'No campaigns in this state.'} />
    </section>
    <div className="note">Rules: minimum ${db.rules.min_purchases} purchases, ${fmt.idr(db.rules.min_spend)} spend and ${db.rules.min_days_live} days live before any verdict. Scale needs ROAS ≥ ${db.rules.scale_roas_mult}× target. Cut when ROAS is below ${db.rules.cut_roas_mult}× break-even. Edit in Settings → Decision Rules.</div>
  </div>`;
}

/* ---------- 3. Creative Intelligence ---------- */
function CreativeDrawer({ id, onClose }) {
  const { M, db, W, setDb, toast, openModal } = useApp();
  const stats = useMemo(() => creativeStats(M, db, W, 'all'), [M, db, W]);
  const o = stats.find(s => s.a.id === id); const [note, setNote] = useState(o ? o.cr.notes || '' : '');
  if (!o) return null;
  const ds = dailySeries(o.rows, W.cur.dates);
  const linked = db.experiments.filter(e => e.control === id || (e.variants || []).includes(id));
  const sameCr = db.ads.filter(a => a.creative_id === o.cr.id);
  const pl = o.cr.placements || {};
  const save = () => { setDb(d => ({ ...d, creatives: d.creatives.map(c => c.id === o.cr.id ? { ...c, notes: note } : c) })); toast('Note saved'); };
  const fun = [['Impressions', o.m.impressions], ['Outbound clicks', o.m.outbound_clicks], ['LPV', o.m.landing_page_views], ['Add to cart', o.m.add_to_cart], ['Checkout', o.m.initiate_checkout], ['Purchases', o.m.purchases]];
  return html`<${Drawer} wide title=${o.cr.name} sub=${html`${accName(M, o.a.account_id)} · ${entName(M, 'campaign', o.a.campaign_id)} · ${entName(M, 'adset', o.a.adset_id)}`} onClose=${onClose}
    footer=${html`<button className="btn" onClick=${() => openModal({ type: 'experiment', prefill: { account_id: o.a.account_id, campaign_id: o.a.campaign_id, variable: 'Creative', control: o.a.id } })}>Create experiment</button><button className="btn pri" onClick=${() => openModal({ type: 'decision', prefill: { account_id: o.a.account_id, level: 'ad', entity_id: o.a.id, metric: 'CPA' } })}>Record decision</button>`}>
    <div style=${{ display: 'grid', gridTemplateColumns: 'minmax(0,260px) minmax(0,1fr)', gap: 16 }} className="cr-detail">
      <div style=${{ display: 'flex', flexDirection: 'column', gap: 10 }}><${Preview} cr=${o.cr} large />
        <div className="sec"><h4>Ad copy</h4><div className="sm" style=${{ color: 'var(--fg-2)' }}>${o.cr.primary_text}</div></div>
        <dl className="kv"><dt>Format</dt><dd>${o.cr.format}</dd><dt>Headline</dt><dd>${o.cr.headline}</dd><dt>CTA</dt><dd>${o.cr.cta}</dd><dt>Created</dt><dd>${fmt.dateY(o.cr.created)} (${o.age} days)</dd><dt>Creative ID</dt><dd className="mono">${o.cr.id}</dd></dl>
      </div>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <div className="row"><${Pill} cls=${CST[o.status]}>${o.status}</${Pill}><span className="sm muted">Score</span><b className="num">${o.score.total}</b><span className="sm muted">/ 100</span></div>
        <div className="kpis k4"><${KPI} label="Spend" value=${fmt.idr(o.m.spend)} /><${KPI} label="ROAS" value=${fmt.x(o.m.roas)} target=${fmt.x(o.t.target_roas)} /><${KPI} label="CPA" value=${fmt.idr(o.m.cpa)} /><${KPI} label="Purchases" value=${fmt.int(o.m.purchases)} /></div>
        <div className="sec"><h4>Score breakdown</h4><${Bars} f=${(v) => fmt.dec(v, 0)} items=${[{ l: 'Hook (CTR vs median) /25', v: o.score.hook, max: 25 }, { l: 'Click quality (out. CTR) /15', v: o.score.hold }, { l: 'Conversion (CVR) /30', v: o.score.conv }, { l: 'Efficiency (ROAS/target) /30', v: o.score.eff }]} max=${30} /></div>
        <div className="sec"><h4>Daily ROAS and CTR</h4><${LineChart} height=${150} labels=${W.cur.dates.map(fmt.date)} f=${fmt.x} area=${false} series=${[{ name: 'ROAS', values: ds.map(d => d.roas), color: 'var(--s1)' }]} refLine=${o.t.target_roas} refLabel="Target" />
          <${LineChart} height=${110} labels=${W.cur.dates.map(fmt.date)} f=${(v) => fmt.pct(v, 1)} area=${false} series=${[{ name: 'CTR', values: ds.map(d => d.ctr), color: 'var(--s3)' }]} /></div>
      </div>
    </div>
    <div className="grid g3">
      <div className="sec"><h4>Funnel</h4><table className="t"><tbody>${fun.map(([l, v], i) => html`<tr key=${l}><td>${l}</td><td className="n">${fmt.int(v)}</td><td className="n muted">${i ? fmt.pct1(v / (fun[i - 1][1] || 1)) : ''}</td></tr>`)}</tbody></table></div>
      <div className="sec"><h4>Placement share of spend</h4><${Bars} f=${fmt.pct1} max=${1} items=${Object.entries(pl).map(([k, v]) => ({ l: k, v }))} /><div className="hint sm muted" style=${{ marginTop: 6 }}>From export breakdown.</div></div>
      <div className="sec"><h4>Associated ads & experiments</h4><ul className="list">${sameCr.map(a => html`<li key=${a.id}><span className="mono">${a.id}</span> · ${entName(M, 'adset', a.adset_id)}</li>`)}${linked.length ? linked.map(e => html`<li key=${e.id}>Experiment: ${e.name} (${e.status})</li>`) : html`<li className="muted">No linked experiments</li>`}</ul></div>
    </div>
    <div className="sec"><h4>Notes</h4><textarea id="cr-note" className="inp" rows="3" value=${note} onChange=${e => setNote(e.target.value)} placeholder="What did you learn from this creative?"></textarea><div className="row end" style=${{ marginTop: 6 }}><button className="btn sm" onClick=${save} disabled=${note === (o.cr.notes || '')}>Save note</button></div></div>
  </${Drawer}>`;
}
function Creative() {
  const { M, db, W, acct, setDrawer, toast } = useApp();
  const [view, setView] = useState('gallery'); const [st, setSt] = useState('all'); const [fm, setFm] = useState('all'); const [sel, setSel] = useState(new Set());
  const stats = useMemo(() => creativeStats(M, db, W, acct), [M, db, W, acct]);
  const list = stats.filter(o => (st === 'all' || o.status === st) && (fm === 'all' || o.cr.format === fm)).sort((a, b) => b.m.spend - a.m.spend);
  const toggle = (id) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else { if (n.size >= 4) { toast('Compare up to 4 creatives'); return; } n.add(id); } setSel(n); };
  const cols = [
    { key: 'name', label: 'Creative', lock: true, search: true, get: o => o.cr.name, titled: true, render: o => html`<button className="link" onClick=${() => setDrawer({ type: 'creative', id: o.a.id })}>${o.cr.name}</button>` },
    { key: 'fmt', label: 'Format', get: o => o.cr.format, search: true },
    ...(acct === 'all' ? [{ key: 'acc', label: 'Account', get: o => accName(M, o.a.account_id) }] : []),
    { key: 'spend', label: 'Spend', num: true, get: o => o.m.spend, f: fmt.idr }, { key: 'ctr', label: 'CTR', num: true, get: o => o.m.ctr, f: fmt.pct }, { key: 'octr', label: 'Out. CTR', num: true, get: o => o.m.octr, f: fmt.pct },
    { key: 'cpa', label: 'CPA', num: true, get: o => o.m.cpa, f: fmt.idr }, { key: 'roas', label: 'ROAS', num: true, get: o => o.m.roas, render: o => roasCell(o) }, { key: 'purch', label: 'Purch.', num: true, get: o => o.m.purchases, f: fmt.int },
    { key: 'age', label: 'Age', num: true, get: o => o.age, f: v => v + 'd' }, { key: 'score', label: 'Score', num: true, get: o => o.score.total },
    { key: 'status', label: 'Status', get: o => o.status, search: true, render: o => html`<${Pill} cls=${CST[o.status]}>${o.status}</${Pill}>` },
  ];
  const picked = stats.filter(o => sel.has(o.a.id));
  return html`<div className="page">
    <${PageHead} title="Creative Intelligence" q="Which creatives earn their spend, and which are fading?" actions=${html`<${Seg} label="View" value=${view} onChange=${setView} options=${[{ v: 'table', l: 'Table' }, { v: 'gallery', l: 'Gallery' }, { v: 'compare', l: `Compare (${sel.size})` }]} />`} />
    <div className="row">
      <select className="sel" aria-label="Status" id="cr-st" value=${st} onChange=${e => setSt(e.target.value)}><option value="all">Status: All</option>${Object.keys(CST).map(k => html`<option key=${k}>${k}</option>`)}</select>
      <select className="sel" aria-label="Format" id="cr-fm" value=${fm} onChange=${e => setFm(e.target.value)}><option value="all">Format: All</option><option>Video</option><option>Image</option><option>Carousel</option></select>
      <span className="sm muted">${list.length} creatives · ${Object.keys(CST).map(k => `${stats.filter(o => o.status === k).length} ${k.toLowerCase()}`).join(' · ')}</span>
      ${sel.size ? html`<span style=${{ marginLeft: 'auto' }} className="row"><span className="sm muted">${sel.size} selected for comparison</span><button className="btn sm" onClick=${() => setSel(new Set())}>Clear</button><button className="btn sm pri" disabled=${sel.size < 2} onClick=${() => setView('compare')}>Compare</button></span>` : null}
    </div>
    ${view === 'gallery' ? html`<section className="panel">${list.length ? html`<div className="gal">${list.map(o => html`<div key=${o.a.id} className=${cx('card', sel.has(o.a.id) && 'picked')} role="button" tabIndex="0" onClick=${(e) => { if (e.target.closest('label')) return; setDrawer({ type: 'creative', id: o.a.id }); }} onKeyDown=${e => e.key === 'Enter' && setDrawer({ type: 'creative', id: o.a.id })}>
        <${Preview} cr=${o.cr} />
        <div className="meta"><div className="row" style=${{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><span className="nm" title=${o.cr.name}>${o.cr.name}</span></div>
          <div className="row" style=${{ justifyContent: 'space-between' }}><${Pill} cls=${CST[o.status]}>${o.status}</${Pill}><span className="sm muted">${o.cr.format} · ${o.age}d · score ${o.score.total}</span></div>
          <div className="mx"><div><span>Spend</span><b>${fmt.idr(o.m.spend)}</b></div><div><span>ROAS</span><b className=${o.m.roas >= o.t.target_roas ? 'd-up' : o.m.roas < o.t.breakeven_roas ? 'd-down' : ''}>${fmt.x(o.m.roas)}</b></div><div><span>CPA</span><b>${fmt.idr(o.m.cpa)}</b></div><div><span>CTR</span><b>${fmt.pct(o.m.ctr)}</b></div><div><span>Out. CTR</span><b>${fmt.pct(o.m.octr)}</b></div><div><span>Purch.</span><b>${fmt.int(o.m.purchases)}</b></div></div>
          <label className="chk sm" onClick=${e => e.stopPropagation()}><input type="checkbox" checked=${sel.has(o.a.id)} onChange=${() => toggle(o.a.id)} />Compare</label>
        </div></div>`)}</div>` : html`<div className="empty">No creatives match these filters.</div>`}</section>`
    : view === 'table' ? html`<section className="panel"><${DataTable} id="cr" cols=${cols} rows=${list} rowKey=${o => o.a.id} selectable selected=${sel} onSelect=${(s) => { if (s.size > 4) { toast('Compare up to 4 creatives'); return; } setSel(s); }} onRow=${o => setDrawer({ type: 'creative', id: o.a.id })} initialSort=${{ k: 'spend', d: -1 }} csvName="creatives" /></section>`
    : html`<${CreativeCompare} picked=${picked} />`}
  </div>`;
}
function CreativeCompare({ picked }) {
  const { W, db } = useApp();
  if (picked.length < 2) return html`<section className="panel"><div className="empty">Select 2–4 creatives in the Gallery or Table view, then open Compare.</div></section>`;
  const colors = ['var(--s1)', 'var(--s3)', 'var(--s4)', 'var(--s2)'];
  const rowsDef = [['spend', 'Spend', fmt.idr, 0], ['impressions', 'Impressions', fmt.int, 0], ['ctr', 'CTR', fmt.pct, 1], ['octr', 'Outbound CTR', fmt.pct, 1], ['landing_page_views', 'LPV', fmt.int, 1], ['add_to_cart', 'ATC', fmt.int, 1], ['purchases', 'Purchases', fmt.int, 1], ['cpa', 'CPA', fmt.idr, -1], ['roas', 'ROAS', fmt.x, 1], ['cvr', 'CVR (LPV→Purch.)', fmt.pct, 1]];
  const spends = picked.map(o => o.m.spend); const ratio = Math.max(...spends) / Math.max(1, Math.min(...spends));
  const small = picked.filter(o => o.m.purchases < db.rules.min_purchases);
  const accts = new Set(picked.map(o => o.a.account_id)), sets = new Set(picked.map(o => o.a.adset_id));
  const ds = picked.map(o => dailySeries(o.rows, W.cur.dates));
  return html`<div style=${{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div className="note info"><b>Observed performance, not causal proof.</b> These creatives ran ${sets.size > 1 ? 'in different ad sets' : 'in the same ad set'}${accts.size > 1 ? ' across different accounts' : ''}, so audience, budget and delivery differ. ${ratio > 3 ? `Spend differs by ${ratio.toFixed(1)}×, so the smaller sample is less reliable. ` : ''}${small.length ? `${small.map(o => o.cr.name).join(', ')} ${small.length > 1 ? 'have' : 'has'} fewer than ${db.rules.min_purchases} purchases. ` : ''}Use a controlled experiment to confirm a winner.</div>
    <section className="panel"><div className="tw"><table className="t"><thead><tr><th>Metric</th>${picked.map((o, i) => html`<th key=${o.a.id} className="n"><span style=${{ display: 'inline-block', width: 8, height: 8, background: colors[i], marginRight: 6, borderRadius: 2 }}></span>${o.cr.name.slice(0, 26)}</th>`)}<th>Relative</th></tr></thead>
      <tbody>${rowsDef.map(([k, l, f, dir]) => { const vals = picked.map(o => o.m[k]); const best = dir === 0 ? -1 : vals.indexOf(dir > 0 ? Math.max(...vals.filter(ok)) : Math.min(...vals.filter(ok))); const mx = Math.max(...vals.filter(ok), 0) || 1;
        return html`<tr key=${k}><td>${l}</td>${vals.map((v, i) => html`<td key=${i} className="n" style=${i === best ? { fontWeight: 600, color: 'var(--good)' } : null}>${f(v)}</td>`)}<td style=${{ minWidth: 160 }}><div style=${{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>${vals.map((v, i) => html`<div key=${i} style=${{ height: 4, width: (ok(v) ? v / mx * 100 : 0) + '%', background: colors[i], borderRadius: 1 }}></div>`)}</div></td></tr>`; })}</tbody></table></div></section>
    <${Panel} title="ROAS trend" sub="Daily, current period"><${LineChart} labels=${W.cur.dates.map(fmt.date)} f=${fmt.x} area=${false} series=${picked.map((o, i) => ({ name: o.cr.name.slice(0, 22), values: ds[i].map(d => d.roas), color: colors[i] }))} />
      <div className="legend" style=${{ marginTop: 6 }}>${picked.map((o, i) => html`<span key=${i}><i style=${{ background: colors[i] }}></i>${o.cr.name}</span>`)}</div></${Panel}>
  </div>`;
}

/* ---------- 4. Experiments ---------- */
const EXP_ST = { Planned: 'p-mute', Active: 'p-acc', 'Awaiting evaluation': 'p-warn', Completed: 'p-good' };
function expMetrics(M, e) {
  const end = e.end < M.end ? e.end : M.end; if (e.start > M.end) return null;
  const one = (id) => { const key = M.ad[id] ? 'ad_id' : M.adsets[id] ? 'adset_id' : M.cmp[id] ? 'campaign_id' : null; if (!key) return null; return { id, name: entName(M, key.replace('_id', ''), id), m: agg(pick(M, { key, id, start: e.start, end })) }; };
  const c = one(e.control); const v = (e.variants || []).map(one);
  return c && v.every(Boolean) ? { c, v, end } : null;
}
function ExperimentDrawer({ id, onClose }) {
  const { M, db, setDb, toast } = useApp(); const e = db.experiments.find(x => x.id === id);
  const [d, setD] = useState(e ? { status: e.status, result: e.result, notes: e.notes, conclusion: e.conclusion, next_action: e.next_action } : {});
  if (!e) return null; const em = expMetrics(M, e);
  const save = () => { setDb(x => ({ ...x, experiments: x.experiments.map(y => y.id === id ? { ...y, ...d } : y) })); toast('Experiment updated'); };
  const k = { CPA: 'cpa', ROAS: 'roas', 'Outbound CTR': 'octr', AOV: 'aov', 'ATC rate': 'atcRate', CVR: 'cvr', Purchases: 'purchases', 'Checkout completion': 'purRate', CPM: 'cpm' };
  const metricsShown = [e.primary_kpi, ...(e.guardrails || [])].filter(x => k[x]);
  const f = (key) => key === 'roas' ? fmt.x : ['cpa', 'aov', 'cpm'].includes(key) ? fmt.idr : key === 'purchases' ? fmt.int : fmt.pct;
  return html`<${Drawer} wide title=${e.name} sub=${html`${accName(M, e.account_id)} · ${entName(M, 'campaign', e.campaign_id)} · ${fmt.dateY(e.start)} – ${fmt.dateY(e.end)}`} onClose=${onClose} footer=${html`<button className="btn pri" onClick=${save}>Save evaluation</button><button className="btn ghost" onClick=${onClose}>Close</button>`}>
    <div className="row"><${Pill} cls=${EXP_ST[e.status]}>${e.status}</${Pill}><span className="sm muted">Variable: ${e.variable} · Primary KPI: ${e.primary_kpi}</span></div>
    <dl className="kv"><dt>Research question</dt><dd>${e.question}</dd><dt>Hypothesis</dt><dd>${e.hypothesis}</dd><dt>Control</dt><dd>${em ? em.c.name : e.control}</dd><dt>Variants</dt><dd>${em ? em.v.map(v => v.name).join(', ') : (e.variants || []).join(', ')}</dd><dt>Guardrails</dt><dd>${(e.guardrails || []).join(', ') || '—'}</dd></dl>
    <${Panel} title="Performance comparison" sub=${em ? `${fmt.date(e.start)} – ${fmt.date(em.end)}` : null} bodyless>
      ${em && metricsShown.length ? html`<div className="tw"><table className="t"><thead><tr><th>Metric</th><th className="n">Control</th>${em.v.map((v, i) => html`<th key=${i} className="n">Variant ${i + 1}</th><th key=${'d' + i} className="n">Δ</th>`)}</tr></thead><tbody>
        ${['spend', 'purchases', ...metricsShown.map(x => k[x])].filter((x, i, a) => a.indexOf(x) === i).map(key => html`<tr key=${key}><td>${Object.keys(k).find(z => k[z] === key) || METRICS[key]?.label || key}</td><td className="n">${f(key === 'spend' ? 'cpa' : key)(em.c.m[key])}</td>${em.v.map((v, i) => html`<td key=${i} className="n">${f(key === 'spend' ? 'cpa' : key)(v.m[key])}</td><td key=${'d' + i} className="n"><${Delta} cur=${v.m[key]} prev=${em.c.m[key]} dir=${['cpa', 'cpm', 'spend'].includes(key) ? (key === 'spend' ? 0 : -1) : 1} /></td>`)}</tr>`)}
      </tbody></table></div><div className="bd"><div className="note">Purchases: control ${fmt.int(em.c.m.purchases)}, variants ${em.v.map(v => fmt.int(v.m.purchases)).join(', ')}. ${Math.min(em.c.m.purchases, ...em.v.map(v => v.m.purchases)) < db.rules.min_purchases ? `At least one arm has fewer than ${db.rules.min_purchases} purchases, so treat the difference as directional.` : 'Both arms meet the minimum purchase threshold.'} Arms were not randomised by Meta unless you used an A/B test, so differences may reflect delivery as well as the variable.</div></div>`
        : html`<div className="empty">${e.start > M.end ? 'Experiment has not started yet.' : 'This variable is measured outside Meta data (for example a landing page change). Compare campaign totals before and after in the Decision Journal.'}</div>`}
    </${Panel}>
    <div className="grid g2">
      <${Field} label="Status" id="ex-st"><select id="ex-st" className="sel" value=${d.status} onChange=${x => setD({ ...d, status: x.target.value })}>${Object.keys(EXP_ST).map(s => html`<option key=${s}>${s}</option>`)}</select></${Field}>
      <${Field} label="Result" id="ex-res"><select id="ex-res" className="sel" value=${d.result || ''} onChange=${x => setD({ ...d, result: x.target.value })}><option value="">Not decided</option><option>Variant won</option><option>Control won</option><option>No clear difference</option><option>Inconclusive (low sample)</option></select></${Field}>
    </div>
    <${Field} label="Observation notes" id="ex-n"><textarea id="ex-n" className="inp" rows="2" value=${d.notes} onChange=${x => setD({ ...d, notes: x.target.value })}></textarea></${Field}>
    <${Field} label="Conclusion" id="ex-c"><textarea id="ex-c" className="inp" rows="2" value=${d.conclusion} onChange=${x => setD({ ...d, conclusion: x.target.value })} placeholder="What does the evidence support?"></textarea></${Field}>
    <${Field} label="Next action" id="ex-na"><input id="ex-na" className="inp" value=${d.next_action} onChange=${x => setD({ ...d, next_action: x.target.value })} /></${Field}>
  </${Drawer}>`;
}
function ExperimentWizard({ prefill = {}, onClose }) {
  const { M, db, setDb, toast, acct, nav } = useApp();
  const [s, setS] = useState(0);
  const [e, setE] = useState({ name: '', question: '', hypothesis: '', account_id: prefill.account_id || (acct !== 'all' ? acct : db.accounts[0].id), campaign_id: prefill.campaign_id || '', variable: prefill.variable || 'Creative', control: prefill.control || '', variants: [], primary_kpi: 'CPA', guardrails: ['ROAS'], start: D.add(M.end, 2), end: D.add(M.end, 16), min_purchases: db.rules.min_purchases });
  const steps = ['Hypothesis', 'Account & campaign', 'Variable & variants', 'KPIs & evaluation', 'Review'];
  const cmps = db.campaigns.filter(c => c.account_id === e.account_id);
  const entOpts = e.variable === 'Audience' ? db.adsets.filter(a => a.campaign_id === e.campaign_id) : db.ads.filter(a => a.campaign_id === e.campaign_id);
  const errs = [
    !e.name.trim() ? 'Give the experiment a name.' : !e.hypothesis.trim() ? 'Write a hypothesis you can prove wrong.' : null,
    !e.campaign_id ? 'Choose a campaign.' : null,
    !e.control ? 'Choose the control.' : !e.variants.length ? 'Add at least one variant.' : e.variants.includes(e.control) ? 'A variant cannot also be the control.' : null,
    !e.primary_kpi ? 'Pick a primary KPI.' : e.end <= e.start ? 'End date must be after the start date.' : null, null][s];
  const create = () => { const x = { ...e, id: uid('exp'), status: e.start <= M.end ? 'Active' : 'Planned', result: '', notes: '', conclusion: '', next_action: '' }; setDb(d => ({ ...d, experiments: [x, ...d.experiments] })); toast('Experiment created'); onClose(); nav('experiments'); };
  const isEnt = e.variable === 'Creative' || e.variable === 'Audience';
  return html`<${Modal} title="Create experiment" sub=${'Step ' + (s + 1) + ' of 5 · ' + steps[s]} onClose=${onClose}
    footer=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><span style=${{ marginLeft: 'auto' }}></span>${s > 0 ? html`<button className="btn" onClick=${() => setS(s - 1)}>Back</button>` : null}${s < 4 ? html`<button className="btn pri" disabled=${!!errs} onClick=${() => setS(s + 1)}>Continue</button>` : html`<button className="btn pri" onClick=${create}>Create experiment</button>`}`}>
    <div className="steps">${steps.map((l, i) => html`<div key=${i} className=${i === s ? 'on' : i < s ? 'done' : ''}>${i + 1}. ${l}</div>`)}</div>
    ${s === 0 ? html`<${Field} label="Experiment name" id="w-n"><input id="w-n" className="inp" value=${e.name} onChange=${x => setE({ ...e, name: x.target.value })} placeholder="e.g. UGC hook vs studio hook" /></${Field}>
      <${Field} label="Research question" id="w-q"><input id="w-q" className="inp" value=${e.question} onChange=${x => setE({ ...e, question: x.target.value })} placeholder="What do you want to learn?" /></${Field}>
      <${Field} label="Hypothesis" id="w-h" hint="If we change X, metric Y will move by Z because…"><textarea id="w-h" className="inp" rows="3" value=${e.hypothesis} onChange=${x => setE({ ...e, hypothesis: x.target.value })}></textarea></${Field}>` : null}
    ${s === 1 ? html`<div className="grid g2"><${Field} label="Ad account" id="w-a"><select id="w-a" className="sel" value=${e.account_id} onChange=${x => setE({ ...e, account_id: x.target.value, campaign_id: '', control: '', variants: [] })}>${db.accounts.map(a => html`<option key=${a.id} value=${a.id}>${a.name}</option>`)}</select></${Field}>
      <${Field} label="Campaign" id="w-c"><select id="w-c" className="sel" value=${e.campaign_id} onChange=${x => setE({ ...e, campaign_id: x.target.value, control: '', variants: [] })}><option value="">Choose…</option>${cmps.map(c => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}</select></${Field}></div>` : null}
    ${s === 2 ? html`<${Field} label="Test variable" id="w-v"><select id="w-v" className="sel" value=${e.variable} onChange=${x => setE({ ...e, variable: x.target.value, control: '', variants: [] })}>${['Creative', 'Audience', 'Offer', 'Landing page', 'Budget', 'Placement'].map(v => html`<option key=${v}>${v}</option>`)}</select></${Field}>
      ${isEnt ? html`<${Field} label=${'Control ' + (e.variable === 'Audience' ? 'ad set' : 'ad')} id="w-ct"><select id="w-ct" className="sel" value=${e.control} onChange=${x => setE({ ...e, control: x.target.value })}><option value="">Choose…</option>${entOpts.map(a => html`<option key=${a.id} value=${a.id}>${a.name}</option>`)}</select></${Field}>
        <div className="field"><span className="lab">Variants</span>${entOpts.filter(a => a.id !== e.control).map(a => html`<label key=${a.id} className="chk"><input type="checkbox" checked=${e.variants.includes(a.id)} onChange=${() => setE({ ...e, variants: e.variants.includes(a.id) ? e.variants.filter(v => v !== a.id) : [...e.variants, a.id] })} />${a.name}</label>`)}${!entOpts.length ? html`<span className="hint">No ${e.variable === 'Audience' ? 'ad sets' : 'ads'} in this campaign.</span>` : null}</div>`
        : html`<${Field} label="Control (describe)" id="w-ct2"><input id="w-ct2" className="inp" value=${e.control} onChange=${x => setE({ ...e, control: x.target.value })} placeholder="e.g. LP v3" /></${Field}><${Field} label="Variant (describe)" id="w-vr"><input id="w-vr" className="inp" value=${e.variants[0] || ''} onChange=${x => setE({ ...e, variants: x.target.value ? [x.target.value] : [] })} placeholder="e.g. LP v3 + trust badges" /></${Field}>`}` : null}
    ${s === 3 ? html`<div className="grid g2"><${Field} label="Primary KPI" id="w-k"><select id="w-k" className="sel" value=${e.primary_kpi} onChange=${x => setE({ ...e, primary_kpi: x.target.value })}>${['CPA', 'ROAS', 'Outbound CTR', 'CVR', 'ATC rate', 'AOV', 'Checkout completion'].map(v => html`<option key=${v}>${v}</option>`)}</select></${Field}>
      <${Field} label="Minimum purchases per arm" id="w-mp" hint="Evaluate only after both arms reach this."><${Num} id="w-mp" value=${e.min_purchases} onChange=${v => setE({ ...e, min_purchases: v })} /></${Field}>
      <${Field} label="Start" id="w-s"><input id="w-s" type="date" className="inp" value=${e.start} onChange=${x => setE({ ...e, start: x.target.value })} /></${Field}>
      <${Field} label="End" id="w-e"><input id="w-e" type="date" className="inp" value=${e.end} onChange=${x => setE({ ...e, end: x.target.value })} /></${Field}></div>
      <div className="field"><span className="lab">Guardrail metrics</span><div className="row">${['ROAS', 'CPA', 'CPM', 'Outbound CTR', 'CVR'].filter(g => g !== e.primary_kpi).map(g => html`<label key=${g} className="chk"><input type="checkbox" checked=${e.guardrails.includes(g)} onChange=${() => setE({ ...e, guardrails: e.guardrails.includes(g) ? e.guardrails.filter(x => x !== g) : [...e.guardrails, g] })} />${g}</label>`)}</div></div>` : null}
    ${s === 4 ? html`<dl className="kv"><dt>Name</dt><dd>${e.name}</dd><dt>Question</dt><dd>${e.question || '—'}</dd><dt>Hypothesis</dt><dd>${e.hypothesis}</dd><dt>Account</dt><dd>${accName(M, e.account_id)}</dd><dt>Campaign</dt><dd>${entName(M, 'campaign', e.campaign_id)}</dd><dt>Variable</dt><dd>${e.variable}</dd><dt>Control</dt><dd>${isEnt ? entName(M, e.variable === 'Audience' ? 'adset' : 'ad', e.control) : e.control}</dd><dt>Variants</dt><dd>${e.variants.map(v => isEnt ? entName(M, e.variable === 'Audience' ? 'adset' : 'ad', v) : v).join(', ')}</dd><dt>Primary KPI</dt><dd>${e.primary_kpi}</dd><dt>Guardrails</dt><dd>${e.guardrails.join(', ') || '—'}</dd><dt>Window</dt><dd>${fmt.dateY(e.start)} – ${fmt.dateY(e.end)} (${D.diff(e.start, e.end) + 1} days)</dd><dt>Min. purchases</dt><dd>${e.min_purchases} per arm</dd></dl><div className="note">Creating this records the plan in your workspace. It does not create an A/B test in Meta.</div>` : null}
    ${errs ? html`<div className="err sm" role="alert" style=${{ color: 'var(--bad)' }}>${errs}</div>` : null}
  </${Modal}>`;
}
function Experiments() {
  const { M, db, acct, setDrawer, openModal } = useApp();
  const list = db.experiments.filter(e => acct === 'all' || e.account_id === acct);
  const [f, setF] = useState('all'); const c = (s) => list.filter(e => e.status === s).length;
  const tile = (k, l) => html`<div className=${cx('kpi click', f === k && 'sel')} role="button" tabIndex="0" onClick=${() => setF(f === k ? 'all' : k)} onKeyDown=${e => e.key === 'Enter' && setF(f === k ? 'all' : k)}><div className="l">${l}</div><div className="v">${c(k)}</div></div>`;
  const cols = [
    { key: 'name', label: 'Experiment', lock: true, search: true, titled: true, render: e => html`<button className="link" onClick=${() => setDrawer({ type: 'experiment', id: e.id })}>${e.name}</button>` },
    { key: 'acc', label: 'Account', get: e => accName(M, e.account_id) }, { key: 'hypothesis', label: 'Hypothesis', search: true, titled: true },
    { key: 'variable', label: 'Variable', search: true }, { key: 'start', label: 'Start', f: fmt.dateY }, { key: 'status', label: 'Status', render: e => html`<${Pill} cls=${EXP_ST[e.status]}>${e.status}</${Pill}>` },
    { key: 'primary_kpi', label: 'Primary KPI' }, { key: 'result', label: 'Result', render: e => e.result || html`<span className="muted">—</span>` },
  ];
  return html`<div className="page"><${PageHead} title="Experiment Tracker" q="What are we testing, and what did we learn?" actions=${html`<button className="btn pri" onClick=${() => openModal({ type: 'experiment' })}>New experiment</button>`} />
    <div className="kpis k4">${tile('Active', 'Active')}${tile('Planned', 'Planned')}${tile('Awaiting evaluation', 'Awaiting evaluation')}${tile('Completed', 'Completed')}</div>
    <section className="panel"><${DataTable} id="exp" cols=${cols} rows=${list.filter(e => f === 'all' || e.status === f)} onRow=${e => setDrawer({ type: 'experiment', id: e.id })} csvName="experiments" empty="No experiments yet. Create one to start a test log." /></section></div>`;
}

/* ---------- 5. Budget & Forecast ---------- */
function Budget() {
  const { M, db, acct, setAcct } = useApp();
  const a = acct === 'all' ? db.accounts[0].id : acct;
  const t = db.targets[a];
  const l14 = agg(pick(M, { acct: a, start: D.add(M.end, -13), end: M.end }));
  const base = useMemo(() => ({ daily: Math.round(l14.spend / 14 / 1e4) * 1e4, remaining: Math.round(l14.spend / 14 * 30 / 1e5) * 1e5, cpa: Math.round(l14.cpa / 1e3) * 1e3, roas: t.target_roas, aov: Math.round(l14.aov / 1e3) * 1e3, days: 30, adj: 0 }), [a, M]);
  const [v, setV] = useState(base); useEffect(() => setV(base), [base]);
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const sc = { Conservative: { cpa: 1.15, aov: 0.95, c: 'var(--s4)' }, Base: { cpa: 1, aov: 1, c: 'var(--s1)' }, Optimistic: { cpa: 0.9, aov: 1.03, c: 'var(--s3)' } };
  const el = 0.35; // CPA rises ~0.35% per 1% budget increase (diminishing returns assumption)
  const calc = (k) => { const s = sc[k]; const daily = v.daily * (1 + v.adj / 100); const spend = Math.min(daily * v.days, v.remaining); const cpa = v.cpa * s.cpa * (1 + Math.max(0, v.adj) / 100 * el); const purch = spend / cpa; const rev = purch * v.aov * s.aov; return { daily, spend, cpa, purch, rev, roas: rev / spend, pacing: daily * v.days / v.remaining }; };
  const R = Object.fromEntries(Object.keys(sc).map(k => [k, calc(k)]));
  const days = Array.from({ length: Math.max(1, v.days) }, (_, i) => 'Day ' + (i + 1));
  const cum = (k, f) => days.map((_, i) => { const r = R[k]; return Math.min(r.daily * (i + 1), v.remaining) * f(r); });
  const b = R.Base; const valid = [v.daily, v.remaining, v.cpa, v.aov, v.days].every(x => ok(x) && x > 0);
  return html`<div className="page"><${PageHead} title="Budget & Forecast" q="If I change budget, where will the month land?" actions=${html`<button className="btn" onClick=${() => setV(base)}>Reset to account data</button>`} />
    <div className="note warn"><b>Scenario estimates, not guaranteed outcomes.</b> CPA is assumed to rise ${el * 100}% for every 1% of extra budget. Real delivery depends on auction, creative and seasonality.</div>
    <div className="split" style=${{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)' }}>
      <${Panel} title="Assumptions" sub=${'Prefilled from last 14 days of ' + accName(M, a)}>
        <div className="grid">
          <${Field} label="Ad account" id="b-a"><select id="b-a" className="sel" value=${a} onChange=${e => setAcct(e.target.value)}>${db.accounts.map(x => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}</select></${Field}>
          <div className="grid g2"><${Field} label="Current daily budget (Rp)" id="b-d"><${Num} id="b-d" value=${v.daily} step=${50000} onChange=${set('daily')} /></${Field}><${Field} label="Remaining monthly budget (Rp)" id="b-r"><${Num} id="b-r" value=${v.remaining} step=${1000000} onChange=${set('remaining')} /></${Field}>
          <${Field} label="Expected CPA (Rp)" id="b-c" hint=${'Last 14 days: ' + fmt.idrF(l14.cpa)}><${Num} id="b-c" value=${v.cpa} step=${1000} onChange=${set('cpa')} /></${Field}><${Field} label="Target ROAS" id="b-t"><${Num} id="b-t" value=${v.roas} step=${0.1} onChange=${set('roas')} /></${Field}>
          <${Field} label="Expected AOV (Rp)" id="b-o"><${Num} id="b-o" value=${v.aov} step=${5000} onChange=${set('aov')} /></${Field}><${Field} label="Remaining days" id="b-dy"><${Num} id="b-dy" value=${v.days} min=${1} max=${31} onChange=${set('days')} /></${Field}></div>
          <${Field} label=${`Budget adjustment: ${v.adj > 0 ? '+' : ''}${v.adj}%`} id="b-adj"><input id="b-adj" type="range" min="-50" max="100" step="5" value=${v.adj} onChange=${e => set('adj')(+e.target.value)} /><div className="row sm muted" style=${{ justifyContent: 'space-between' }}><span>−50%</span><span>0</span><span>+100%</span></div></${Field}>
        </div>
      </${Panel}>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        ${valid ? html`<div className="kpis k6">
          <${KPI} label="Projected spend" value=${fmt.idr(b.spend)} /><${KPI} label="Expected purchases" value=${fmt.int(b.purch)} /><${KPI} label="Expected revenue" value=${fmt.idr(b.rev)} />
          <${KPI} label="Projected ROAS" value=${fmt.x(b.roas)} target=${fmt.x(v.roas)} bar=${b.roas / v.roas} /><${KPI} label="Budget pacing" value=${fmt.pct1(b.pacing)} target=${b.pacing > 1 ? 'runs out day ' + Math.ceil(v.remaining / b.daily) : 'within budget'} targetLabel="" bar=${b.pacing > 1 ? 0.5 : 1} /><${KPI} label="New daily budget" value=${fmt.idr(b.daily)} />
        </div>
        <${Panel} title="Cumulative revenue by scenario" sub="Spend line in grey"><${LineChart} labels=${days} f=${fmt.idr} area=${false} series=${[...Object.keys(sc).map(k => ({ name: k, values: cum(k, r => r.roas), color: sc[k].c })), { name: 'Spend', values: cum('Base', () => 1), color: 'var(--s2)', dashed: true }]} />
          <div className="legend" style=${{ marginTop: 6 }}>${Object.keys(sc).map(k => html`<span key=${k}><i style=${{ background: sc[k].c }}></i>${k}</span>`)}<span><i className="dash"></i>Spend</span></div></${Panel}>
        <${Panel} title="End-of-month outcome" bodyless><div className="tw"><table className="t"><thead><tr><th>Scenario</th><th className="n">CPA</th><th className="n">Spend</th><th className="n">Purchases</th><th className="n">Revenue</th><th className="n">ROAS</th><th>vs target</th></tr></thead>
          <tbody>${Object.keys(sc).map(k => { const r = R[k]; return html`<tr key=${k}><td className="name">${k}</td><td className="n">${fmt.idr(r.cpa)}</td><td className="n">${fmt.idr(r.spend)}</td><td className="n">${fmt.int(r.purch)}</td><td className="n">${fmt.idr(r.rev)}</td><td className="n">${fmt.x(r.roas)}</td><td>${r.roas >= v.roas ? html`<${Pill} cls="p-good">Meets target</${Pill}>` : r.roas >= t.breakeven_roas ? html`<${Pill} cls="p-warn">Above break-even</${Pill}>` : html`<${Pill} cls="p-bad">Below break-even</${Pill}>`}</td></tr>`; })}</tbody></table></div></${Panel}>`
        : html`<div className="note bad">Enter positive values for budget, CPA, AOV and days to see the forecast.</div>`}
      </div></div></div>`;
}

/* ---------- 6. Funnel Diagnostics ---------- */
const STAGES = [['impressions', 'Impressions'], ['outbound_clicks', 'Outbound clicks'], ['landing_page_views', 'Landing page views'], ['add_to_cart', 'Add to cart'], ['initiate_checkout', 'Initiate checkout'], ['purchases', 'Purchases']];
const RATE = [null, 'octr', 'lpvRate', 'atcRate', 'icRate', 'purRate'];
function Funnel() {
  const { M, db, W, acct, compare, openModal } = useApp();
  const [cmp, setCmp] = useState('all'); const [st, setSt] = useState(null);
  const rows = pick(M, { acct, start: W.cur.start, end: W.cur.end }).filter(r => cmp === 'all' || r.campaign_id === cmp);
  const prows = pick(M, { acct, start: W.prev.start, end: W.prev.end }).filter(r => cmp === 'all' || r.campaign_id === cmp);
  const m = agg(rows), p = agg(prows);
  // internal benchmark: median across campaigns in the whole workspace for this period
  const bench = useMemo(() => { const all = entityRows(M, db, 'campaign', W, 'all').filter(c => c.m.impressions > 20000); const o = {}; [...RATE.filter(Boolean), 'cpm'].forEach(k => o[k] = median(all.map(c => c.m[k]))); return o; }, [M, db, W]);
  const minDen = [0, 5000, 300, 300, 40, 25];
  const issues = STAGES.map(([k], i) => {
    if (i === 0) { const flag = m.cpm > bench.cpm * 1.15; return { i, name: 'High CPM', flag, metric: 'CPM', val: fmt.idr(m.cpm), ref: fmt.idr(bench.cpm), prev: fmt.idr(p.cpm), enough: m.impressions >= 5000, why: 'Narrow audience, high competition in the auction, or low ad quality/engagement ranking.', check: 'Compare CPM by placement and audience size; check quality ranking in Ads Manager.', exp: 'Test broad vs current audience, or add Reels placements.' }; }
    const rk = RATE[i]; const v = m[rk], b = bench[rk]; const den = m[STAGES[i - 1][0]]; const flag = ok(v) && ok(b) && v < b * 0.8;
    const T = [null,
      { name: 'Low outbound CTR', why: 'Hook does not stop the scroll, or the offer is not clear in the first frame.', check: 'Sort creatives by outbound CTR; check thumb-stop rate on videos.', exp: 'Hook test: 3 opening variants on the best-selling creative.' },
      { name: 'Low LPV rate', why: 'Slow landing page, broken pixel on page load, or accidental clicks from some placements.', check: 'Test page speed on mobile 4G; confirm PageView fires; check Audience Network share.', exp: 'Lighter landing page variant or exclude Audience Network.' },
      { name: 'Low ATC rate', why: 'Mismatch between ad promise and page, price shock, or weak product page.', check: 'Read the page as a new visitor; compare price shown in ad vs page.', exp: 'Landing page headline matching the ad hook; bundle offer test.' },
      { name: 'Low checkout initiation', why: 'Cart friction: forced account creation, unclear shipping cost.', check: 'Walk through cart on mobile; check shipping cost visibility.', exp: 'Show shipping estimate on product page.' },
      { name: 'Checkout drop-off', why: 'Payment options, unexpected fees, trust concerns at checkout.', check: 'Check payment method mix and failed payments; confirm Purchase event fires once.', exp: 'Add COD / e-wallet and trust badges at checkout.' }][i];
    return { i, ...T, flag, metric: STAGES[i - 1][1] + ' → ' + STAGES[i][1], val: fmt.pct(v), ref: fmt.pct(b), prev: fmt.pct(p[rk]), enough: den >= minDen[i], den };
  });
  const worst = issues.filter(x => x.flag && x.enough)[0];
  const sel = st == null ? (worst ? worst.i : 1) : st; const I = issues[sel];
  const maxV = m.impressions || 1;
  const accRows = acct === 'all' ? entityRows(M, db, 'account', W, 'all') : null;
  const cmps = db.campaigns.filter(c => acct === 'all' || c.account_id === acct);
  return html`<div className="page"><${PageHead} title="Funnel Diagnostics" q="Where do people drop out, and what should I check first?" actions=${html`<select className="sel" id="fn-c" aria-label="Campaign" value=${cmp} onChange=${e => { setCmp(e.target.value); setSt(null); }}><option value="all">All campaigns</option>${cmps.map(c => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}</select>`} />
    <div className="split">
      <${Panel} title="Conversion funnel" sub="Click a stage to diagnose it">
        <div className="fun">${STAGES.map(([k, l], i) => { const v = m[k]; const iss = issues[i]; const w = i === 0 ? 100 : Math.max(0.6, Math.sqrt(v / maxV) * 100);
          return html`<${Fragment} key=${k}>${i > 0 ? html`<div className="fconv"><span>Conversion ${fmt.pct(v / (m[STAGES[i - 1][0]] || 1))}</span><span>Drop-off ${fmt.pct1(1 - v / (m[STAGES[i - 1][0]] || 1))}</span><span>Cost ${fmt.idr(m.spend / (v || 1))} per ${l.toLowerCase().replace(/s$/, '')}</span>${compare ? html`<span>Prev conv. ${fmt.pct(p[k] / (p[STAGES[i - 1][0]] || 1))}</span>` : null}</div>` : null}
          <button className=${cx('fs', sel === i && 'on')} onClick=${() => setSt(i)} aria-pressed=${sel === i}><span>${l}</span><span className="fb"><i className=${iss.flag && iss.enough ? 'flag' : iss.flag ? 'wflag' : ''} style=${{ width: w + '%' }}></i></span><span className="fv">${fmt.int(v)}</span></button></${Fragment}>`; })}</div>
        <div className="hint sm muted" style=${{ marginTop: 8 }}>Bar width uses a square-root scale so late stages stay visible. Red marks a stage below 80% of the workspace median with enough volume to judge.</div>
      </${Panel}>
      <${Panel} title="Diagnostic" sub=${STAGES[sel][1]}>
        <div style=${{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row"><b>${I.name}</b>${!I.enough ? html`<${Pill} cls="p-mute">Not enough data</${Pill}>` : I.flag ? html`<${Pill} cls="p-bad">Issue likely</${Pill}>` : html`<${Pill} cls="p-good">Within range</${Pill}>`}</div>
          <dl className="kv"><dt>${I.metric}</dt><dd><b>${I.val}</b></dd><dt>Workspace median</dt><dd>${I.ref}</dd>${compare ? html`<dt>Previous period</dt><dd>${I.prev}</dd>` : null}</dl>
          ${!I.enough ? html`<div className="note">Only ${fmt.int(I.den ?? m.impressions)} ${I.i ? STAGES[I.i - 1][1].toLowerCase() : 'impressions'} in this selection. Rates at this volume move a lot from day to day, so no conclusion is drawn.</div>`
          : I.flag ? html`<div className="sec"><h4>Possible explanation</h4><div className="sm">${I.why}</div></div><div className="sec"><h4>Recommended check</h4><div className="sm">${I.check}</div></div><div className="sec"><h4>Experiment idea</h4><div className="sm">${I.exp}</div></div>
            <div className="row"><button className="btn sm" onClick=${() => openModal({ type: 'experiment', prefill: { account_id: acct !== 'all' ? acct : (cmp !== 'all' ? M.cmp[cmp].account_id : undefined), campaign_id: cmp !== 'all' ? cmp : '' } })}>Create experiment from this</button></div>`
          : html`<div className="sm muted">This stage converts in line with the rest of the workspace. ${worst ? `The weakest stage with enough volume is ${STAGES[worst.i][1]}.` : 'No stage stands out.'}</div>`}
          <div className="note sm">Benchmarks are internal: the median across campaigns in this workspace, not industry figures.</div>
        </div>
      </${Panel}>
    </div>
    ${accRows ? html`<${Panel} title="Account comparison" sub="Same period; accounts use different attribution windows where flagged" bodyless><div className="tw"><table className="t"><thead><tr><th>Account</th><th className="n">CPM</th><th className="n">Out. CTR</th><th className="n">LPV rate</th><th className="n">ATC rate</th><th className="n">Checkout rate</th><th className="n">IC → Purchase</th><th>Attribution</th></tr></thead>
      <tbody>${accRows.map(r => html`<tr key=${r.id}><td className="name">${r.name}</td><td className="n">${fmt.idr(r.m.cpm)}</td><td className="n">${fmt.pct(r.m.octr)}</td><td className="n">${fmt.pct1(r.m.lpvRate)}</td><td className="n">${fmt.pct1(r.m.atcRate)}</td><td className="n">${fmt.pct1(r.m.icRate)}</td><td className="n">${fmt.pct1(r.m.purRate)}</td><td>${r.attribution !== db.workspace.default_attribution ? html`<${Pill} cls="p-warn" title="Not directly comparable">${r.attribution}</${Pill}>` : html`<span className="muted">${r.attribution}</span>`}</td></tr>`)}</tbody></table></div></${Panel}>` : null}
  </div>`;
}

/* ---------- 7. Decision Journal ---------- */
const DST = { Improved: ['p-good', 'good'], Declined: ['p-bad', 'bad'], Inconclusive: ['p-mute', ''], 'Pending Evaluation': ['p-warn', 'warn'] };
function DecisionForm({ prefill = {}, onClose }) {
  const { M, db, setDb, toast, acct } = useApp();
  const [d, setD] = useState({ account_id: prefill.account_id || (acct !== 'all' ? acct : db.accounts[0].id), level: prefill.level || 'campaign', entity_id: prefill.entity_id || '', action: 'Increase budget', previous: '', new: '', reason: '', hypothesis: '', metric: prefill.metric || 'ROAS', eval_date: D.add(M.end, (db.rules.eval_window_days || 7) + 1), notes: '' });
  const [tried, setTried] = useState(false);
  const opts = { campaign: db.campaigns, adset: db.adsets, ad: db.ads }[d.level].filter(x => x.account_id === d.account_id);
  const err = !d.entity_id ? 'Choose what the decision applies to.' : !d.reason.trim() ? 'Record why you are making this change.' : !d.hypothesis.trim() ? 'State what you expect to happen.' : null;
  const save = () => { setTried(true); if (err) return; const now = new Date(); const ts = now.toISOString().slice(0, 16); setDb(x => ({ ...x, decisions: [{ ...d, id: uid('dec'), ts, status: 'Pending Evaluation' }, ...x.decisions] })); toast('Decision recorded in journal'); onClose(); };
  const s = (k) => (e) => setD({ ...d, [k]: e.target.value });
  return html`<${Modal} title="Record decision" sub="Logged in your workspace only. Nothing changes in Meta Ads." onClose=${onClose} footer=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><span style=${{ marginLeft: 'auto' }}></span><button className="btn pri" onClick=${save}>Save decision</button>`}>
    <div className="grid g3"><${Field} label="Account" id="df-a"><select id="df-a" className="sel" value=${d.account_id} onChange=${e => setD({ ...d, account_id: e.target.value, entity_id: '' })}>${db.accounts.map(a => html`<option key=${a.id} value=${a.id}>${a.name}</option>`)}</select></${Field}>
      <${Field} label="Level" id="df-l"><select id="df-l" className="sel" value=${d.level} onChange=${e => setD({ ...d, level: e.target.value, entity_id: '' })}><option value="campaign">Campaign</option><option value="adset">Ad set</option><option value="ad">Ad</option></select></${Field}>
      <${Field} label="Action" id="df-ac"><select id="df-ac" className="sel" value=${d.action} onChange=${s('action')}>${['Increase budget', 'Decrease budget', 'Pause ad', 'Pause ad set', 'Introduce new creative', 'Change targeting', 'Change bid strategy', 'Start experiment', 'Other'].map(x => html`<option key=${x}>${x}</option>`)}</select></${Field}></div>
    <${Field} label=${d.level === 'campaign' ? 'Campaign' : d.level === 'adset' ? 'Ad set' : 'Ad'} id="df-e" err=${tried && !d.entity_id ? 'Required' : null}><select id="df-e" className="sel" value=${d.entity_id} onChange=${s('entity_id')}><option value="">Choose…</option>${opts.map(o => html`<option key=${o.id} value=${o.id}>${o.name}${d.level !== 'campaign' ? ' — ' + entName(M, 'campaign', o.campaign_id) : ''}</option>`)}</select></${Field}>
    <div className="grid g2"><${Field} label="Previous setting" id="df-p"><input id="df-p" className="inp" value=${d.previous} onChange=${s('previous')} placeholder="e.g. Rp1.000.000/day" /></${Field}><${Field} label="New setting" id="df-n"><input id="df-n" className="inp" value=${d.new} onChange=${s('new')} placeholder="e.g. Rp1.200.000/day" /></${Field}></div>
    <${Field} label="Reason" id="df-r" err=${tried && !d.reason.trim() ? 'Required' : null}><input id="df-r" className="inp" value=${d.reason} onChange=${s('reason')} placeholder="What evidence led to this?" /></${Field}>
    <${Field} label="Hypothesis / expected outcome" id="df-h" err=${tried && !d.hypothesis.trim() ? 'Required' : null}><input id="df-h" className="inp" value=${d.hypothesis} onChange=${s('hypothesis')} placeholder="e.g. ROAS stays above 2.5 after +20% budget" /></${Field}>
    <div className="grid g2"><${Field} label="Target metric" id="df-m"><select id="df-m" className="sel" value=${d.metric} onChange=${s('metric')}>${['ROAS', 'CPA', 'Purchases', 'Outbound CTR', 'CPM', 'Spend'].map(x => html`<option key=${x}>${x}</option>`)}</select></${Field}><${Field} label="Evaluation date" id="df-d"><input id="df-d" type="date" className="inp" value=${d.eval_date} onChange=${s('eval_date')} /></${Field}></div>
    <${Field} label="Notes" id="df-no"><textarea id="df-no" className="inp" rows="2" value=${d.notes} onChange=${s('notes')}></textarea></${Field}>
  </${Modal}>`;
}
const MKEY = { ROAS: 'roas', CPA: 'cpa', Purchases: 'purchases', 'Outbound CTR': 'octr', CPM: 'cpm', Spend: 'spend' };
function decisionEval(M, db, d) {
  const day = d.ts.slice(0, 10); const w = db.rules.eval_window_days || 7; const key = d.level + '_id';
  const before = agg(pick(M, { key, id: d.entity_id, start: D.add(day, -w), end: D.add(day, -1) }));
  const aEnd = d.eval_date < M.end ? d.eval_date : M.end; const after = agg(pick(M, { key, id: d.entity_id, start: D.add(day, 1), end: aEnd }));
  return { before, after, afterDays: Math.max(0, D.diff(day, aEnd)), w };
}
function DecisionDrawer({ id, onClose }) {
  const { M, db, setDb, toast } = useApp(); const d = db.decisions.find(x => x.id === id);
  if (!d) return null; const ev = decisionEval(M, db, d);
  const setStatus = (status) => { setDb(x => ({ ...x, decisions: x.decisions.map(y => y.id === id ? { ...y, status } : y) })); toast('Outcome marked ' + status); };
  const keys = [['spend', fmt.idr, 0], ['purchases', fmt.int, 1], ['roas', fmt.x, 1], ['cpa', fmt.idr, -1], ['octr', fmt.pct, 1], ['cpm', fmt.idr, -1]];
  const perDay = (m, n) => n ? { spend: m.spend / n, purchases: m.purchases / n } : {};
  return html`<${Drawer} title=${d.action + ': ' + entName(M, d.level, d.entity_id)} sub=${html`${fmt.dt(d.ts)} · ${accName(M, d.account_id)} · ${d.level}`} onClose=${onClose}
    footer=${html`<span className="sm muted" style=${{ alignSelf: 'center' }}>Mark outcome:</span>${Object.keys(DST).map(s => html`<button key=${s} className=${cx('btn sm', d.status === s && 'pri')} onClick=${() => setStatus(s)}>${s}</button>`)}`}>
    <div className="row"><${Pill} cls=${DST[d.status][0]}>${d.status}</${Pill}><span className="sm muted">Evaluate on ${fmt.dateY(d.eval_date)} · target metric ${d.metric}</span></div>
    <dl className="kv"><dt>Change</dt><dd>${d.previous || '—'} → ${d.new || '—'}</dd><dt>Reason</dt><dd>${d.reason}</dd><dt>Expected outcome</dt><dd>${d.hypothesis}</dd>${d.notes ? html`<dt>Notes</dt><dd>${d.notes}</dd>` : null}</dl>
    <${Panel} title="Before / after" sub=${`${ev.w} days before vs ${ev.afterDays} day${ev.afterDays === 1 ? '' : 's'} after`} bodyless>
      ${ev.afterDays < 3 ? html`<div className="bd"><div className="note">Only ${ev.afterDays} day${ev.afterDays === 1 ? '' : 's'} of data after this decision. Wait until at least 3 days (ideally the full evaluation window) before judging.</div></div>` : null}
      <div className="tw"><table className="t"><thead><tr><th>Metric</th><th className="n">Before</th><th className="n">After</th><th className="n">Change</th></tr></thead><tbody>
        ${keys.map(([k, f, dir]) => { const per = k === 'spend' || k === 'purchases'; const b = per ? perDay(ev.before, ev.w)[k] : ev.before[k], a = per ? perDay(ev.after, ev.afterDays)[k] : ev.after[k];
          return html`<tr key=${k} style=${MKEY[d.metric] === k ? { fontWeight: 600 } : null}><td>${METRICS[k].label}${per ? ' / day' : ''}${MKEY[d.metric] === k ? ' (target)' : ''}</td><td className="n">${f(b)}</td><td className="n">${ev.afterDays ? f(a) : '—'}</td><td className="n">${ev.afterDays ? html`<${Delta} cur=${a} prev=${b} dir=${dir} pts=${k === 'octr'} />` : '—'}</td></tr>`; })}
      </tbody></table></div>
    </${Panel}>
    <div className="note info"><b>Correlation, not causation.</b> Before/after changes also reflect seasonality, auction pressure and other edits made in the same period. Use an experiment when you need causal evidence.</div>
  </${Drawer}>`;
}
function Journal() {
  const { M, db, acct, setDrawer, openModal } = useApp();
  const [f, setF] = useState('all');
  const list = db.decisions.filter(d => (acct === 'all' || d.account_id === acct) && (f === 'all' || d.status === f)).sort((a, b) => b.ts.localeCompare(a.ts));
  const due = db.decisions.filter(d => d.status === 'Pending Evaluation' && d.eval_date <= M.end).length;
  return html`<div className="page"><${PageHead} title="Decision Journal" q="What did we change, why, and did it work?" actions=${html`<button className="btn pri" onClick=${() => openModal({ type: 'decision' })}>Record decision</button>`} />
    ${due ? html`<div className="note warn"><b>${due} decision${due > 1 ? 's are' : ' is'} due for evaluation.</b> Open them to compare before and after.</div>` : null}
    <section className="panel"><div className="tabs">${['all', ...Object.keys(DST)].map(k => html`<button key=${k} className=${f === k ? 'on' : ''} onClick=${() => setF(k)}>${k === 'all' ? 'All' : k}<span className="c">${db.decisions.filter(d => (acct === 'all' || d.account_id === acct) && (k === 'all' || d.status === k)).length}</span></button>`)}</div>
      <div className="tl">${list.length ? list.map(d => html`<button key=${d.id} className="tle" onClick=${() => setDrawer({ type: 'decision', id: d.id })}>
        <div className="when">${fmt.date(d.ts)}<br/><span className="sm">${d.ts.slice(11, 16)}</span></div><div className="rail"><i className=${DST[d.status][1] || 'info'}></i></div>
        <div className="tlc"><div className="row"><span className="tt">${d.action}</span><${Pill} cls=${DST[d.status][0]}>${d.status}</${Pill}></div>
          <div className="ln">${accName(M, d.account_id)} · ${entName(M, d.level, d.entity_id)}${d.previous || d.new ? ` · ${d.previous || '—'} → ${d.new || '—'}` : ''}</div>
          <div className="ln"><span className="muted">Reason:</span> ${d.reason}</div><div className="ln"><span className="muted">Expected:</span> ${d.hypothesis} · <span className="muted">evaluate ${fmt.date(d.eval_date)}</span></div></div></button>`)
      : html`<div className="empty">No decisions in this view. Record one when you change budget, pause an ad or launch a test.</div>`}</div></section></div>`;
}

/* ---------- 8. Profitability & Reports ---------- */
function Profit() {
  const { M, db, W, acct } = useApp();
  const a = acct === 'all' ? null : acct; const t = a ? db.targets[a] : db.targets[db.accounts[0].id];
  const m = agg(pick(M, { acct, start: W.cur.start, end: W.cur.end }));
  const init = useMemo(() => ({ aov: Math.round((ok(m.aov) ? m.aov : t.aov) / 1000) * 1000, cogs: Math.round(t.aov * (1 - t.contribution_margin) * 0.6 / 1000) * 1000, ship: 15000, fee: 2.5, other: 5000, spend: Math.round(m.spend / 1e5) * 1e5, margin: 15, roas: +(m.roas || 2).toFixed(2) }), [acct, W]);
  const [v, setV] = useState(init); useEffect(() => setV(init), [init]);
  const s = (k) => (x) => setV({ ...v, [k]: x });
  const cm = v.aov - v.cogs - v.ship - v.aov * v.fee / 100 - v.other; const cmPct = cm / v.aov;
  const be = v.aov / cm; const maxCpa = cm; const tgt = v.aov / (cm - v.aov * v.margin / 100);
  const profitAt = (roas) => { const rev = v.spend * roas; const orders = rev / v.aov; return orders * cm - v.spend; };
  const grid = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5];
  const curve = Array.from({ length: 41 }, (_, i) => 0.5 + i * 0.1);
  const valid = cm > 0 && v.aov > 0;
  return html`<div className="split" style=${{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)' }}>
    <${Panel} title="Unit economics" sub=${a ? accName(M, a) : 'Brand Alpha targets as base'}><div className="grid g2">
      <${Field} label="AOV (Rp)" id="pf-aov"><${Num} id="pf-aov" value=${v.aov} step=${5000} onChange=${s('aov')} /></${Field}><${Field} label="COGS per order (Rp)" id="pf-c"><${Num} id="pf-c" value=${v.cogs} step=${5000} onChange=${s('cogs')} /></${Field}>
      <${Field} label="Shipping (Rp)" id="pf-s"><${Num} id="pf-s" value=${v.ship} step=${1000} onChange=${s('ship')} /></${Field}><${Field} label="Payment fees (%)" id="pf-f"><${Num} id="pf-f" value=${v.fee} step=${0.1} onChange=${s('fee')} /></${Field}>
      <${Field} label="Other variable cost (Rp)" id="pf-o"><${Num} id="pf-o" value=${v.other} step=${1000} onChange=${s('other')} /></${Field}><${Field} label="Target margin after ads (%)" id="pf-m"><${Num} id="pf-m" value=${v.margin} step=${1} onChange=${s('margin')} /></${Field}>
      <${Field} label="Ad spend in period (Rp)" id="pf-sp"><${Num} id="pf-sp" value=${v.spend} step=${1000000} onChange=${s('spend')} /></${Field}><${Field} label="Simulated ROAS" id="pf-r" hint=${'Period actual: ' + fmt.x(m.roas)}><${Num} id="pf-r" value=${v.roas} step=${0.1} onChange=${s('roas')} /></${Field}>
    </div></${Panel}>
    <div style=${{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      ${valid ? html`<div className="kpis k6"><${KPI} label="Contribution margin" value=${fmt.pct1(cmPct)} target=${fmt.idr(cm) + '/order'} targetLabel="" /><${KPI} label="Break-even ROAS" value=${fmt.x(be)} /><${KPI} label="Max allowable CPA" value=${fmt.idr(maxCpa)} /><${KPI} label="Target ROAS" value=${tgt > 0 && cm - v.aov * v.margin / 100 > 0 ? fmt.x(tgt) : 'n/a'} target=${v.margin + '% margin'} targetLabel="for" /><${KPI} label="Contribution profit" value=${html`<span className=${profitAt(v.roas) >= 0 ? 'd-up' : 'd-down'}>${fmt.idr(profitAt(v.roas))}</span>`} target=${'at ' + fmt.x(v.roas)} targetLabel="" /><${KPI} label="Profit / Rp1 ad spend" value=${'Rp' + fmt.dec(profitAt(v.roas) / v.spend, 2)} /></div>
      <${Panel} title="Break-even simulator" sub="Contribution profit vs ROAS at the entered spend"><${LineChart} labels=${curve.map(x => x.toFixed(1) + 'x')} f=${(x) => fmt.idr(x)} area=${false} series=${[{ name: 'Profit', values: curve.map(r => Math.max(0, profitAt(r))), color: 'var(--good)' }, { name: 'Loss', values: curve.map(r => Math.max(0, -profitAt(r))), color: 'var(--bad)', dashed: true }]} />
        <div className="legend" style=${{ marginTop: 6 }}><span><i style=${{ background: 'var(--good)' }}></i>Profit</span><span><i className="dash" style=${{ background: 'var(--bad)' }}></i>Loss (shown as positive)</span><span>Break-even at ${fmt.x(be)}</span></div></${Panel}>
      <${Panel} title="Sensitivity" bodyless><div className="tw"><table className="t"><thead><tr><th>ROAS</th>${grid.map(r => html`<th key=${r} className="n">${r.toFixed(1)}x</th>`)}</tr></thead><tbody>
        <tr><td>Revenue</td>${grid.map(r => html`<td key=${r} className="n">${fmt.idr(v.spend * r)}</td>`)}</tr>
        <tr><td>CPA</td>${grid.map(r => html`<td key=${r} className="n">${fmt.idr(v.aov / r)}</td>`)}</tr>
        <tr><td>Profit</td>${grid.map(r => { const p = profitAt(r); return html`<td key=${r} className=${cx('n', p >= 0 ? 'd-up' : 'd-down')}>${fmt.idr(p)}</td>`; })}</tr></tbody></table></div></${Panel}>`
      : html`<div className="note bad">Costs exceed AOV, so every order loses money before ads. Lower COGS, shipping or fees, or raise AOV.</div>`}
    </div></div>`;
}
function Reports() {
  const { M, db, W, acct, toast } = useApp();
  const [r, setR] = useState({ account: acct, type: 'Weekly Marketing Review', metrics: ['spend', 'purchase_value', 'purchases', 'roas', 'cpa', 'octr'], sections: ['Summary', 'Campaigns', 'Creatives', 'Alerts', 'Decisions'] });
  const days = r.type.startsWith('Daily') ? 1 : r.type.startsWith('Weekly') ? 7 : 30;
  const WW = windows(M, days); const cur = pick(M, { acct: r.account, start: WW.cur.start, end: WW.cur.end }), prv = pick(M, { acct: r.account, start: WW.prev.start, end: WW.prev.end });
  const m = agg(cur), p = agg(prv);
  const camps = entityRows(M, db, 'campaign', WW, r.account).sort((a, b) => b.m.spend - a.m.spend).slice(0, 8);
  const crs = creativeStats(M, db, WW, r.account).sort((a, b) => b.m.purchase_value - a.m.purchase_value).slice(0, 5);
  const al = computeAlerts(M, db, WW, r.account).slice(0, 6);
  const decs = db.decisions.filter(d => (r.account === 'all' || d.account_id === r.account) && d.ts.slice(0, 10) >= D.add(WW.cur.start, -7));
  const tog = (k, v) => setR({ ...r, [k]: r[k].includes(v) ? r[k].filter(x => x !== v) : [...r[k], v] });
  const asText = () => [`${r.type} — ${accName(M, r.account)} — ${fmt.dateY(WW.cur.start)} to ${fmt.dateY(WW.cur.end)} (DEMO DATA)`, '', ...r.metrics.map(k => `${METRICS[k].label}: ${METRICS[k].f(m[k])} (prev ${METRICS[k].f(p[k])})`), '', 'Top campaigns:', ...camps.map(c => `- ${c.name}: spend ${fmt.idr(c.m.spend)}, ROAS ${fmt.x(c.m.roas)}`), '', 'Alerts:', ...al.map(a => '- ' + a.title)].join('\n');
  return html`<div className="split" style=${{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2.4fr)' }}>
    <${Panel} title="Report builder"><div className="grid">
      <${Field} label="Account" id="rp-a"><select id="rp-a" className="sel" value=${r.account} onChange=${e => setR({ ...r, account: e.target.value })}><option value="all">All accounts</option>${db.accounts.map(a => html`<option key=${a.id} value=${a.id}>${a.name}</option>`)}</select></${Field}>
      <${Field} label="Report type" id="rp-t" hint=${'Period: ' + fmt.date(WW.cur.start) + ' – ' + fmt.dateY(WW.cur.end)}><select id="rp-t" className="sel" value=${r.type} onChange=${e => setR({ ...r, type: e.target.value })}><option>Daily Performance Review</option><option>Weekly Marketing Review</option><option>Monthly Performance Review</option></select></${Field}>
      <div className="field"><span className="lab">Metrics</span>${['spend', 'purchase_value', 'purchases', 'roas', 'cpa', 'cpm', 'octr', 'ctr'].map(k => html`<label key=${k} className="chk"><input type="checkbox" checked=${r.metrics.includes(k)} onChange=${() => tog('metrics', k)} />${METRICS[k].label}</label>`)}</div>
      <div className="field"><span className="lab">Sections</span>${['Summary', 'Campaigns', 'Creatives', 'Alerts', 'Decisions'].map(k => html`<label key=${k} className="chk"><input type="checkbox" checked=${r.sections.includes(k)} onChange=${() => tog('sections', k)} />${k}</label>`)}</div>
      <div className="row"><button className="btn" onClick=${async () => toast(await copyText(asText()) ? 'Report copied as text' : 'Copy failed; select the preview text instead')}>Copy as text</button><button className="btn" onClick=${() => saveFile('report.csv', toCSV([{ label: 'Campaign', key: 'name' }, { label: 'Spend', raw: c => Math.round(c.m.spend) }, { label: 'Purchases', raw: c => c.m.purchases }, { label: 'ROAS', raw: c => +c.m.roas.toFixed(2) }], camps), 'text/csv', toast)}>Export CSV</button>
        <button className="btn" disabled=${FRAMED} title=${FRAMED ? 'Printing works in the installed app, not in this preview' : 'Print or save as PDF'} onClick=${() => window.print()}>Print / PDF</button></div>
      ${FRAMED ? html`<div className="hint sm muted">Print / PDF is available when you open the installed app.</div>` : null}
    </div></${Panel}>
    <div className="report" id="report-preview">
      <div><div className="demo-tag" style=${{ display: 'inline-block', marginBottom: 8 }}>Demo data</div><h2>${r.type}</h2><div className="muted sm">${accName(M, r.account)} · ${fmt.dateY(WW.cur.start)} – ${fmt.dateY(WW.cur.end)} · compared with ${fmt.date(WW.prev.start)} – ${fmt.date(WW.prev.end)}</div></div>
      ${r.sections.includes('Summary') ? html`<div><h3>Summary</h3><div className="kpis" style=${{ gridTemplateColumns: `repeat(${Math.min(4, r.metrics.length || 1)},minmax(0,1fr))` }}>${r.metrics.map(k => html`<${KPI} key=${k} label=${METRICS[k].label} value=${METRICS[k].f(m[k])} cur=${m[k]} prev=${p[k]} dir=${METRICS[k].dir} pts=${k.includes('ctr')} />`)}</div>
        <p className="sm" style=${{ margin: '8px 0 0' }}>Spend ${fmt.sp(m.spend / p.spend - 1)} vs previous period, ROAS ${fmt.x(m.roas)} (${fmt.sp(m.roas / p.roas - 1)}). ${m.roas >= weightedTarget(db, cur) ? 'Above' : 'Below'} the spend-weighted target of ${fmt.x(weightedTarget(db, cur))}.</p></div>` : null}
      ${r.sections.includes('Campaigns') ? html`<div><h3>Campaigns</h3><div className="tw" style=${{ border: 0 }}><table className="t"><thead><tr><th>Campaign</th>${r.metrics.map(k => html`<th key=${k} className="n">${METRICS[k].label}</th>`)}</tr></thead><tbody>${camps.map(c => html`<tr key=${c.id}><td className="name">${c.name}</td>${r.metrics.map(k => html`<td key=${k} className="n">${METRICS[k].f(c.m[k])}</td>`)}</tr>`)}</tbody></table></div></div>` : null}
      ${r.sections.includes('Creatives') ? html`<div><h3>Top creatives by purchase value</h3><ul className="list">${crs.map(o => html`<li key=${o.a.id}>${o.cr.name} — ${fmt.idr(o.m.purchase_value)} value, ROAS ${fmt.x(o.m.roas)}, ${o.status.toLowerCase()}</li>`)}</ul></div>` : null}
      ${r.sections.includes('Alerts') ? html`<div><h3>Alerts</h3>${al.length ? html`<ul className="list">${al.map((a, i) => html`<li key=${i}>${a.title}</li>`)}</ul>` : html`<div className="muted sm">None.</div>`}</div>` : null}
      ${r.sections.includes('Decisions') ? html`<div><h3>Decisions in period</h3>${decs.length ? html`<ul className="list">${decs.map(d => html`<li key=${d.id}>${fmt.date(d.ts)} — ${d.action}: ${entName(M, d.level, d.entity_id)} (${d.status})</li>`)}</ul>` : html`<div className="muted sm">No decisions recorded.</div>`}</div>` : null}
    </div></div>`;
}
function ProfitReports() { const [t, setT] = useState('profit'); return html`<div className="page"><${PageHead} title="Profitability & Reports" q=${t === 'profit' ? 'What ROAS do I need to make money?' : 'What do I send the team this week?'} actions=${html`<${Seg} label="Tab" value=${t} onChange=${setT} options=${[{ v: 'profit', l: 'Profitability' }, { v: 'reports', l: 'Report builder' }]} />`} />${t === 'profit' ? html`<${Profit} />` : html`<${Reports} />`}</div>`; }

/* ---------- 9. Import ---------- */
function makeSampleImport(M, db) {
  const acc = db.accounts[0].id; const ads = db.ads.filter(a => a.account_id === acc).slice(0, 8);
  const end = M.end, newDay = D.add(end, 1); const rows = [];
  for (const a of ads) for (const d of [D.add(end, -2), D.add(end, -1), end]) { const r = M.keys.get(d + '|' + a.id); if (r) rows.push({ ...r }); }
  rows[0].purchases += 2; rows[0].purchase_value += 2 * 300000; rows[3].purchases += 1; rows[3].purchase_value += 280000; rows[5].spend += 12000;
  const old = M.keys.get(D.add(end, -12) + '|' + ads[1].id); if (old) rows.push({ ...old, purchases: old.purchases + 3, purchase_value: old.purchase_value + 900000 });
  for (const a of ads) { const b = M.keys.get(end + '|' + a.id) || {}; rows.push({ date: newDay, ad_id: a.id, spend: Math.round((b.spend || 300000) * 1.04 / 100) * 100, impressions: b.impressions || 8000, clicks: b.clicks || 120, outbound_clicks: b.outbound_clicks || 80, landing_page_views: b.landing_page_views || 60, add_to_cart: b.add_to_cart || 8, initiate_checkout: b.initiate_checkout || 5, purchases: b.purchases || 2, purchase_value: b.purchase_value || 600000 }); }
  rows.push({ date: newDay, ad_id: 'ad_999', spend: 100000, impressions: 3000, clicks: 40, outbound_clicks: 25, landing_page_views: 20, add_to_cart: 2, initiate_checkout: 1, purchases: 1, purchase_value: 300000 });
  rows.push({ date: newDay, ad_id: ads[2].id, spend: -5000, impressions: 100, clicks: 2, outbound_clicks: 1, landing_page_views: 1, add_to_cart: 0, initiate_checkout: 0, purchases: 0, purchase_value: 0 });
  const dupe = { ...rows[rows.length - 3], purchases: rows[rows.length - 3].purchases + 1 }; rows.push(dupe);
  return { name: `alpha_${D.add(end, -2)}_${newDay}.json`, size: 0, json: { schema_version: '1.0', source: 'claude-meta-export', account_id: acc, period: { start: D.add(end, -12), end: newDay }, attribution: '7d_click_1d_view', exported_at: new Date().toISOString(), rows } };
}
function analyseImport(M, db, json) {
  const errors = [], warnings = [];
  if (!json || typeof json !== 'object') return { fatal: ['File is not a JSON object.'] };
  if (!json.schema_version) errors.push("Missing 'schema_version'.");
  if (!Array.isArray(json.rows)) return { fatal: ["Missing 'rows' array. Each export must contain rows: [{ date, ad_id, spend, … }]."] };
  if (json.account_id && !M.acc[json.account_id]) errors.push(`Unknown account '${json.account_id}'. Add it under Settings → Ad Accounts first.`);
  const acc = json.account_id && M.acc[json.account_id];
  if (acc && json.attribution && json.attribution !== acc.attribution) warnings.push(`Attribution ${json.attribution} differs from the account setting (${acc.attribution}).`);
  const inFile = new Map(), out = { new: [], updated: [], unchanged: [], invalid: [], conflicts: [], revisions: [] };
  json.rows.forEach((r, i) => {
    const probs = [];
    if (!D.valid(r.date)) probs.push('invalid date'); if (!r.ad_id) probs.push('missing ad_id'); else if (!M.ad[r.ad_id]) probs.push(`unknown ad_id ${r.ad_id}`);
    else if (json.account_id && M.ad[r.ad_id].account_id !== json.account_id) probs.push('ad belongs to another account');
    for (const f of FIELDS) { if (r[f] == null) { if (f === 'outbound_clicks') continue; probs.push('missing ' + f); } else if (typeof r[f] !== 'number' || r[f] < 0) probs.push(`${f} must be ≥ 0`); }
    if (r.purchases > r.initiate_checkout && r.initiate_checkout != null) warnings.push(`Row ${i + 1}: purchases exceed checkouts (allowed, but check attribution).`);
    if (probs.length) { out.invalid.push({ i: i + 1, r, probs }); return; }
    const k = r.date + '|' + r.ad_id;
    if (inFile.has(k)) { const prev = inFile.get(k); if (FIELDS.some(f => prev[f] !== r[f])) out.conflicts.push({ k, a: prev, b: r }); }
    inFile.set(k, r);
  });
  for (const [k, r] of inFile) {
    const ex = M.keys.get(k);
    if (!ex) out.new.push(r);
    else { const diff = FIELDS.filter(f => (ex[f] ?? null) !== (r[f] ?? null)).map(f => ({ f, a: ex[f], b: r[f] })); if (diff.length) { out.updated.push({ r, ex, diff }); if (D.diff(r.date, M.end) > 7) out.revisions.push(k); } else out.unchanged.push(r); }
  }
  const dates = json.rows.map(r => r.date).filter(D.valid).sort();
  return { errors, warnings: [...new Set(warnings)].slice(0, 8), out, period: json.period || { start: dates[0], end: dates[dates.length - 1] }, account: json.account_id || 'unknown', rowsTotal: json.rows.length };
}
function ImportPage() {
  const { M, db, setDb, toast, nav } = useApp();
  const [stage, setStage] = useState('upload'); const [file, setFile] = useState(null); const [res, setRes] = useState(null); const [over, setOver] = useState(false); const [done, setDone] = useState(null);
  const inp = useRef(null);
  const handle = (name, size, text) => { setFile({ name, size }); setStage('validating'); setTimeout(() => { let json; try { json = JSON.parse(text); } catch (e) { setRes({ fatal: ['The file is not valid JSON: ' + e.message] }); setStage('preview'); return; } setRes({ ...analyseImport(M, db, json), json }); setStage('preview'); }, 500); };
  const onFiles = (fl) => { const f = fl && fl[0]; if (!f) return; if (!/\.json$/i.test(f.name)) { toast('Choose a .json file exported by Claude'); return; } const rd = new FileReader(); rd.onload = () => handle(f.name, f.size, rd.result); rd.onerror = () => toast('Could not read the file'); rd.readAsText(f); };
  const sample = () => { const s = makeSampleImport(M, db); const text = JSON.stringify(s.json); handle(s.name, text.length, text); };
  const confirm = () => {
    const o = res.out; const latest = new Map(); for (const r of [...o.new, ...o.updated.map(u => u.r)]) latest.set(r.date + '|' + r.ad_id, r);
    setDb(d => { const keep = d.daily.filter(r => !latest.has(r.date + '|' + r.ad_id)); const batch = { id: uid('imp'), imported_at: new Date().toISOString().slice(0, 16), file: file.name, account_id: res.account, period: [res.period.start, res.period.end], new: o.new.length, updated: o.updated.length, unchanged: o.unchanged.length, invalid: o.invalid.length, status: o.invalid.length || res.warnings.length || o.conflicts.length ? 'Completed with warnings' : 'Completed', warnings: [...res.warnings, ...(o.conflicts.length ? [`${o.conflicts.length} conflicting duplicate rows: last value kept`] : []), ...(o.invalid.length ? [`${o.invalid.length} invalid rows skipped`] : [])] };
      return { ...d, daily: [...keep, ...latest.values()], imports: [batch, ...d.imports] }; });
    setDone({ n: o.new.length, u: o.updated.length, s: o.invalid.length }); setStage('done'); toast('Import applied to your local workspace');
  };
  const reset = () => { setStage('upload'); setFile(null); setRes(null); setDone(null); };
  const o = res && res.out; const blocked = res && (res.fatal || res.errors.length);
  const changeRows = o ? o.updated.flatMap(u => u.diff.map(d => ({ id: u.r.date + u.r.ad_id + d.f, date: u.r.date, ad: u.r.ad_id, name: entName(M, 'ad', u.r.ad_id), f: d.f, a: d.a, b: d.b, rev: D.diff(u.r.date, M.end) > 7 }))) : [];
  return html`<div className="page"><${PageHead} title="Import Data" q="Add a JSON export from Claude to your workspace database." />
    <div className="steps">${['Upload', 'Validate', 'Preview changes', 'Confirm'].map((l, i) => { const idx = { upload: 0, validating: 1, preview: 2, done: 3 }[stage]; return html`<div key=${l} className=${i === idx ? 'on' : i < idx ? 'done' : ''}>${i + 1}. ${l}</div>`; })}</div>
    ${stage === 'upload' ? html`<div className=${cx('drop', over && 'over')} onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${e => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}>
        <b>Drop a JSON export here</b><span className="muted sm">One file per account and period, schema 1.0</span>
        <div className="row" style=${{ justifyContent: 'center' }}><button className="btn pri" onClick=${() => inp.current.click()}>Select file</button><button className="btn" onClick=${sample}>Try a sample export</button></div>
        <input ref=${inp} type="file" accept=".json,application/json" hidden onChange=${e => { onFiles(e.target.files); e.target.value = ''; }} id="imp-file" />
      </div>
      <${Panel} title="Expected format" sub="What Claude should export"><pre className="mono" style=${{ margin: 0, fontSize: 11.5, overflow: 'auto', color: 'var(--fg-2)' }}>${'{\n  "schema_version": "1.0",\n  "source": "claude-meta-export",\n  "account_id": "act_alpha",\n  "period": { "start": "2026-10-25", "end": "2026-10-31" },\n  "attribution": "7d_click_1d_view",\n  "rows": [\n    { "date": "2026-10-31", "ad_id": "ad_001", "spend": 512300, "impressions": 13120,\n      "clicks": 201, "outbound_clicks": 131, "landing_page_views": 98,\n      "add_to_cart": 14, "initiate_checkout": 8, "purchases": 4, "purchase_value": 1188000 }\n  ]\n}'}</pre><div className="hint sm muted" style=${{ marginTop: 8 }}>Rows are matched on date + ad_id. Existing rows are updated, never duplicated.</div></${Panel}>` : null}
    ${stage === 'validating' ? html`<${Panel} title="Validating" sub=${file.name}><div className="grid" style=${{ gap: 8 }}><div className="skel" style=${{ width: '60%' }}></div><div className="skel" style=${{ width: '80%' }}></div><div className="skel" style=${{ width: '45%' }}></div></div></${Panel}>` : null}
    ${stage === 'preview' && res ? html`
      <${Panel} title="File" sub=${file.name}><dl className="kv"><dt>Size</dt><dd>${fmt.int(file.size / 1024)} KB</dd>${!res.fatal ? html`<dt>Account</dt><dd>${accName(M, res.account)} <span className="mono muted">${res.account}</span></dd><dt>Reporting period</dt><dd>${fmt.dateY(res.period.start)} – ${fmt.dateY(res.period.end)}</dd><dt>Rows in file</dt><dd>${fmt.int(res.rowsTotal)}</dd><dt>Schema</dt><dd>${res.errors.length ? html`<${Pill} cls="p-bad">Failed</${Pill}>` : html`<${Pill} cls="p-good">Valid · v${res.json.schema_version}</${Pill}>`}</dd>` : null}</dl></${Panel}>
      ${res.fatal || res.errors.length ? html`<div className="note bad"><b>This file cannot be imported.</b><ul className="list" style=${{ marginTop: 4 }}>${(res.fatal || res.errors).map((e, i) => html`<li key=${i}>${e}</li>`)}</ul></div>` : html`
      <div className="kpis k6"><${KPI} label="New records" value=${fmt.int(o.new.length)} /><${KPI} label="Updated" value=${fmt.int(o.updated.length)} /><${KPI} label="Unchanged" value=${fmt.int(o.unchanged.length)} /><${KPI} label="Invalid" value=${html`<span className=${o.invalid.length ? 'd-down' : ''}>${o.invalid.length}</span>`} /><${KPI} label="Conflicts" value=${html`<span className=${o.conflicts.length ? 'd-down' : ''}>${o.conflicts.length}</span>`} /><${KPI} label="Historical revisions" value=${o.revisions.length} target="older than 7 days" targetLabel="" /></div>
      ${res.warnings.length ? html`<div className="note warn"><b>Warnings</b><ul className="list" style=${{ marginTop: 4 }}>${res.warnings.map((w, i) => html`<li key=${i}>${w}</li>`)}</ul></div>` : null}
      <${Panel} title="Changed records" sub=${changeRows.length + ' field changes'} bodyless><${DataTable} id="imp-chg" pageSize=${10} cols=${[{ key: 'date', label: 'Date', f: fmt.dateY, search: true }, { key: 'name', label: 'Ad', search: true, titled: true }, { key: 'f', label: 'Field', render: r => METRICS[r.f] ? METRICS[r.f].label : r.f, search: true }, { key: 'a', label: 'Previous', num: true, f: fmt.int }, { key: 'b', label: 'Incoming', num: true, f: fmt.int }, { key: 'chg', label: 'Change', num: true, get: r => r.b - r.a, render: r => html`<span className=${r.b > r.a ? 'chg-up' : 'chg-dn'}>${r.b > r.a ? '+' : ''}${fmt.int(r.b - r.a)}</span>` }, { key: 'rev', label: 'Type', render: r => r.rev ? html`<${Pill} cls="p-warn">Historical revision</${Pill}>` : html`<${Pill} cls="p-mute">Recent</${Pill}>` }]} rows=${changeRows} empty="No existing records change." /></${Panel}>
      ${o.invalid.length ? html`<${Panel} title="Invalid records" sub="Skipped on import" bodyless><div className="tw"><table className="t"><thead><tr><th className="n">Row</th><th>Date</th><th>Ad</th><th>Problem</th></tr></thead><tbody>${o.invalid.map(x => html`<tr key=${x.i}><td className="n">${x.i}</td><td>${x.r.date || '—'}</td><td className="mono">${x.r.ad_id || '—'}</td><td style=${{ color: 'var(--bad)' }}>${x.probs.join('; ')}</td></tr>`)}</tbody></table></div></${Panel}>` : null}
      ${o.conflicts.length ? html`<${Panel} title="Conflicts" sub="Same date and ad appear twice in the file with different values; the later row wins" bodyless><div className="tw"><table className="t"><thead><tr><th>Key</th><th className="n">First purchases</th><th className="n">Later purchases</th></tr></thead><tbody>${o.conflicts.map(c => html`<tr key=${c.k}><td className="mono">${c.k}</td><td className="n">${c.a.purchases}</td><td className="n">${c.b.purchases}</td></tr>`)}</tbody></table></div></${Panel}>` : null}`}
      <div className="row end"><button className="btn" onClick=${reset}>Cancel</button><button className="btn pri" disabled=${blocked || !(o && (o.new.length || o.updated.length))} onClick=${confirm}>Confirm import${o && !blocked ? ` (${o.new.length + o.updated.length} records)` : ''}</button></div>` : null}
    ${stage === 'done' && done ? html`<${Panel} title="Import complete"><div style=${{ display: 'flex', flexDirection: 'column', gap: 10 }}><div>${done.n} new and ${done.u} updated records were written to your local workspace database. ${done.s ? `${done.s} invalid rows were skipped.` : ''}</div><div className="note">The prototype keeps changes in this browser. Export the database from Settings → Preferences to save a new data.json.</div><div className="row"><button className="btn pri" onClick=${() => nav('overview')}>View overview</button><button className="btn" onClick=${() => nav('history')}>Import history</button><button className="btn ghost" onClick=${reset}>Import another file</button></div></div></${Panel}>` : null}
  </div>`;
}

/* ---------- 10. Import History & Data Quality ---------- */
const IST = { Completed: 'p-good', 'Completed with warnings': 'p-warn', Rejected: 'p-bad' };
function History() {
  const { M, db, acct, setDrawer } = useApp();
  const list = db.imports.filter(i => acct === 'all' || i.account_id === acct || i.account_id === 'all');
  const cols = [{ key: 'imported_at', label: 'Imported', f: fmt.dt, sortv: r => r.imported_at }, { key: 'file', label: 'File', search: true, render: r => html`<button className="link mono" onClick=${() => setDrawer({ type: 'import', id: r.id })}>${r.file}</button>` }, { key: 'acc', label: 'Account', get: r => accName(M, r.account_id), search: true }, { key: 'period', label: 'Period', get: r => fmt.date(r.period[0]) + ' – ' + fmt.date(r.period[1]), sortv: r => r.period[0] },
    { key: 'new', label: 'New', num: true, f: fmt.int }, { key: 'updated', label: 'Updated', num: true, f: fmt.int }, { key: 'unchanged', label: 'Unchanged', num: true, f: fmt.int }, { key: 'invalid', label: 'Invalid', num: true, f: fmt.int }, { key: 'status', label: 'Status', search: true, render: r => html`<${Pill} cls=${IST[r.status]}>${r.status}</${Pill}>` }];
  return html`<div className="page"><${PageHead} title="Import History" q="Which files built this database?" /><section className="panel"><${DataTable} id="hist" cols=${cols} rows=${list} onRow=${r => setDrawer({ type: 'import', id: r.id })} initialSort=${{ k: 'imported_at', d: -1 }} csvName="import-history" filters=${[{ key: 'st', label: 'Status', options: Object.keys(IST), test: (r, v) => r.status === v }]} /></section></div>`;
}
function ImportDrawer({ id, onClose }) {
  const { M, db } = useApp(); const b = db.imports.find(x => x.id === id); if (!b) return null;
  return html`<${Drawer} title=${b.file} sub=${'Batch ' + b.id} onClose=${onClose}><div className="row"><${Pill} cls=${IST[b.status]}>${b.status}</${Pill}></div>
    <dl className="kv"><dt>Imported</dt><dd>${fmt.dt(b.imported_at)}</dd><dt>Account</dt><dd>${accName(M, b.account_id)}</dd><dt>Period</dt><dd>${fmt.dateY(b.period[0])} – ${fmt.dateY(b.period[1])}</dd><dt>New</dt><dd>${b.new}</dd><dt>Updated</dt><dd>${b.updated}</dd><dt>Unchanged</dt><dd>${b.unchanged}</dd><dt>Invalid</dt><dd>${b.invalid}</dd></dl>
    <div className="sec"><h4>Warnings</h4>${b.warnings.length ? html`<ul className="list">${b.warnings.map((w, i) => html`<li key=${i}>${w}</li>`)}</ul>` : html`<div className="muted sm">None</div>`}</div>
    <div className="note">Rolling back a batch is not available in the prototype. In production, each batch stores the previous values it overwrote so it can be reverted.</div></${Drawer}>`;
}
function qualityChecks(M, db) {
  const out = [];
  const missing = M.rows.filter(r => FIELDS.some(f => r[f] == null));
  out.push({ sev: missing.length ? 'warn' : 'ok', title: 'Missing metric fields', count: missing.length, detail: missing.length ? 'Rows with null values; totals treat them as zero, which understates CTR and LPV rate.' : 'Every row has all metric fields.', items: missing.slice(0, 20).map(r => `${r.date} · ${r.ad_id} · missing ${FIELDS.filter(f => r[f] == null).join(', ')}`) });
  out.push({ sev: M.dups.length ? 'bad' : 'ok', title: 'Duplicate identifiers', count: M.dups.length, detail: M.dups.length ? 'Same date + ad_id stored twice in data.json. The app keeps the later row; fix the source file.' : 'No duplicate keys.', items: M.dups.map(d => `${d.key} · purchases ${d.first.purchases} vs ${d.second.purchases}`) });
  const conflicts = M.dups.filter(d => FIELDS.some(f => d.first[f] !== d.second[f]));
  out.push({ sev: conflicts.length ? 'bad' : 'ok', title: 'Conflicting records', count: conflicts.length, detail: conflicts.length ? 'Duplicates whose values disagree. Re-export the affected day.' : 'No conflicting values.', items: conflicts.map(d => d.key) });
  const attr = db.accounts.filter(a => a.attribution !== db.workspace.default_attribution);
  out.push({ sev: attr.length ? 'warn' : 'ok', title: 'Inconsistent attribution settings', count: attr.length, detail: attr.length ? `Workspace default is ${db.workspace.default_attribution}. Cross-account ROAS comparisons are not like-for-like.` : 'All accounts use the default.', items: attr.map(a => `${a.name}: ${a.attribution}`) });
  const gaps = []; for (const a of db.accounts) { const have = new Set(M.rows.filter(r => r.account_id === a.id).map(r => r.date)); const first = [...have].sort()[0]; if (!first) continue; D.range(first, M.end).forEach(d => { if (!have.has(d)) gaps.push(`${a.name}: no rows on ${fmt.dateY(d)}`); }); }
  out.push({ sev: gaps.length ? 'warn' : 'ok', title: 'Incomplete date coverage', count: gaps.length, detail: gaps.length ? 'Days with no rows for an account. Daily charts dip to zero on these days.' : 'Every account has rows for every day.', items: gaps });
  const today = new Date().toISOString().slice(0, 10); const fresh = db.accounts.map(a => { const last = M.rows.filter(r => r.account_id === a.id).reduce((m, r) => r.date > m ? r.date : m, ''); return { a, last, lag: last ? D.diff(last, today) : 99 }; });
  const stale = fresh.filter(f => f.lag > 2);
  out.push({ sev: stale.length ? 'warn' : 'info', title: 'Data freshness', count: stale.length, detail: stale.length ? 'Accounts more than 2 days behind today.' : 'All accounts updated within 2 days.', items: fresh.map(f => `${f.a.name}: latest ${fmt.dateY(f.last)} (${f.lag} day${f.lag === 1 ? '' : 's'} ago)`) });
  const iw = db.imports.flatMap(i => i.warnings.map(w => `${i.file}: ${w}`));
  out.push({ sev: iw.length ? 'info' : 'ok', title: 'Import warnings', count: iw.length, detail: 'Warnings recorded during previous imports.', items: iw });
  return out;
}
function Quality() {
  const { M, db } = useApp(); const checks = useMemo(() => qualityChecks(M, db), [M, db]); const [open, setOpen] = useState(null);
  const n = (s) => checks.filter(c => c.sev === s).length; const SV = { bad: ['p-bad', 'Critical'], warn: ['p-warn', 'Warning'], info: ['p-info', 'Info'], ok: ['p-good', 'Passed'] };
  return html`<div className="page"><${PageHead} title="Data Quality" q="Can I trust the numbers in this workspace?" />
    <div className="kpis k4"><${KPI} label="Critical" value=${html`<span className=${n('bad') ? 'd-down' : ''}>${n('bad')}</span>`} /><${KPI} label="Warnings" value=${n('warn')} /><${KPI} label="Info" value=${n('info')} /><${KPI} label="Passed" value=${n('ok')} /></div>
    <section className="panel">${checks.map((c, i) => html`<div key=${i} style=${{ borderTop: i ? '1px solid var(--line)' : 0 }}>
      <button className="alert" style=${{ gridTemplateColumns: '4px 1fr auto' }} aria-expanded=${open === i} onClick=${() => setOpen(open === i ? null : i)}><span className=${'sv ' + (c.sev === 'ok' ? '' : c.sev)}></span><div><div className="tt">${c.title} ${c.count ? html`<span className="muted num">· ${c.count}</span>` : null}</div><div className="dd2">${c.detail}</div></div><${Pill} cls=${SV[c.sev][0]}>${SV[c.sev][1]}</${Pill}></button>
      ${open === i && c.items.length ? html`<ul className="list mono" style=${{ padding: '4px 16px 12px 40px', fontSize: 11.5, color: 'var(--fg-2)' }}>${c.items.slice(0, 30).map((t, j) => html`<li key=${j}>${t}</li>`)}${c.items.length > 30 ? html`<li>…and ${c.items.length - 30} more</li>` : null}</ul>` : null}</div>`)}</section></div>`;
}

/* ---------- 11. Settings ---------- */
function SetAccounts() {
  const { db, setDb, toast } = useApp(); const [rows, setRows] = useState(db.accounts); useEffect(() => setRows(db.accounts), [db.accounts]);
  const up = (i, k, v) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r)); const dirty = JSON.stringify(rows) !== JSON.stringify(db.accounts);
  return html`<div className="page"><${PageHead} title="Ad Accounts" q="Accounts tracked in this workspace" actions=${html`<button className="btn" disabled=${!dirty} onClick=${() => setRows(db.accounts)}>Discard</button><button className="btn pri" disabled=${!dirty} onClick=${() => { setDb(d => ({ ...d, accounts: rows })); toast('Accounts saved'); }}>Save changes</button>`} />
    <section className="panel"><div className="tw"><table className="t"><thead><tr><th>Account name</th><th>ID</th><th>Currency</th><th>Timezone</th><th>Attribution</th><th>Status</th><th>Product</th></tr></thead><tbody>
      ${rows.map((r, i) => html`<tr key=${r.id}><td><input className="inp" id=${'ac-n-' + i} aria-label="Account name" value=${r.name} onChange=${e => up(i, 'name', e.target.value)} /></td><td className="mono muted">${r.id}</td>
        <td><select className="sel" id=${'ac-c-' + i} aria-label="Currency" value=${r.currency} onChange=${e => up(i, 'currency', e.target.value)}><option>IDR</option><option>USD</option><option>HKD</option><option>SGD</option></select></td>
        <td><select className="sel" id=${'ac-t-' + i} aria-label="Timezone" value=${r.timezone} onChange=${e => up(i, 'timezone', e.target.value)}><option>Asia/Jakarta</option><option>Asia/Makassar</option><option>Asia/Hong_Kong</option><option>Asia/Singapore</option></select></td>
        <td><select className="sel" id=${'ac-at-' + i} aria-label="Attribution" value=${r.attribution} onChange=${e => up(i, 'attribution', e.target.value)}><option>7d_click_1d_view</option><option>7d_click</option><option>1d_click</option></select></td>
        <td><select className="sel" id=${'ac-s-' + i} aria-label="Status" value=${r.status} onChange=${e => up(i, 'status', e.target.value)}><option>Active</option><option>Paused</option><option>Archived</option></select></td>
        <td><input className="inp" id=${'ac-p-' + i} aria-label="Product" value=${r.product} onChange=${e => up(i, 'product', e.target.value)} /></td></tr>`)}</tbody></table></div></section>
    <div className="note">New accounts arrive with their first import. Account IDs come from the export and cannot be edited.</div></div>`;
}
function SetTargets() {
  const { db, setDb, toast, acct } = useApp(); const [a, setA] = useState(acct !== 'all' ? acct : db.accounts[0].id); const [t, setT] = useState(db.targets[a]); useEffect(() => setT(db.targets[a]), [a, db.targets]);
  const s = (k) => (v) => setT({ ...t, [k]: v }); const dirty = JSON.stringify(t) !== JSON.stringify(db.targets[a]);
  const derivedBE = t.contribution_margin > 0 ? 1 / t.contribution_margin : NaN;
  return html`<div className="page"><${PageHead} title="Performance Targets" q="Targets used by KPIs, alerts and recommendations" actions=${html`<select className="sel" id="tg-a" aria-label="Account" value=${a} onChange=${e => setA(e.target.value)}>${db.accounts.map(x => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}</select>`} />
    <${Panel} title=${db.accounts.find(x => x.id === a).name}><div className="grid g3" style=${{ maxWidth: 820 }}>
      <${Field} label="Target ROAS" id="tg-r"><${Num} id="tg-r" value=${t.target_roas} step=${0.1} onChange=${s('target_roas')} /></${Field}>
      <${Field} label="Break-even ROAS" id="tg-b" hint=${'From margin: ' + fmt.x(derivedBE)}><${Num} id="tg-b" value=${t.breakeven_roas} step=${0.1} onChange=${s('breakeven_roas')} /></${Field}>
      <${Field} label="Target CPA (Rp)" id="tg-c"><${Num} id="tg-c" value=${t.target_cpa} step=${5000} onChange=${s('target_cpa')} /></${Field}>
      <${Field} label="AOV (Rp)" id="tg-o"><${Num} id="tg-o" value=${t.aov} step=${5000} onChange=${s('aov')} /></${Field}>
      <${Field} label="Contribution margin (before ads)" id="tg-m" hint="0.50 = 50%"><${Num} id="tg-m" value=${t.contribution_margin} step=${0.01} onChange=${s('contribution_margin')} /></${Field}>
    </div>${t.target_roas < t.breakeven_roas ? html`<div className="note bad" style=${{ marginTop: 12 }}>Target ROAS is below break-even. Campaigns could hit target and still lose money.</div>` : null}
    <div className="row" style=${{ marginTop: 12 }}><button className="btn" disabled=${!dirty} onClick=${() => setT(db.targets[a])}>Discard</button><button className="btn" onClick=${() => setT({ ...t, breakeven_roas: +derivedBE.toFixed(2) })}>Set break-even from margin</button><button className="btn pri" disabled=${!dirty} onClick=${() => { setDb(d => ({ ...d, targets: { ...d.targets, [a]: t } })); toast('Targets saved'); }}>Save targets</button></div></${Panel}></div>`;
}
const RULE_DOC = [
  ['min_purchases', 'Minimum purchases', 'Fewer purchases than this in the period means Insufficient Evidence.', 1],
  ['min_spend', 'Minimum spend (Rp)', 'Campaigns below this spend are not judged.', 100000],
  ['min_days_live', 'Minimum days live', 'New campaigns are not judged before this many days.', 1],
  ['scale_roas_mult', 'Scale threshold (× target ROAS)', 'Scale Candidate when ROAS is at least this multiple of target.', 0.05],
  ['cut_roas_mult', 'Cut threshold (× break-even ROAS)', 'Cut Candidate when ROAS falls below this multiple of break-even.', 0.05],
  ['cpa_cut_mult', 'CPA cut threshold (× target CPA)', 'Also cut when CPA exceeds this multiple of target and ROAS is below break-even.', 0.1],
  ['trend_drop_pct', 'Trend drop to investigate (%)', 'Investigate when last-7-day ROAS drops by more than this versus the previous 7 days.', 5],
  ['eval_window_days', 'Evaluation window (days)', 'Days compared before and after a decision in the journal.', 1],
  ['review_interval_days', 'Review interval (days)', 'How soon a recommendation should be reviewed again.', 1],
];
function SetRules() {
  const { db, setDb, toast } = useApp(); const [r, setR] = useState(db.rules); useEffect(() => setR(db.rules), [db.rules]);
  const dirty = JSON.stringify(r) !== JSON.stringify(db.rules); const isDef = JSON.stringify(r) === JSON.stringify(DEFAULT_RULES);
  return html`<div className="page"><${PageHead} title="Decision Rules" q="Thresholds behind every recommendation" actions=${html`<button className="btn" disabled=${isDef} onClick=${() => setR(DEFAULT_RULES)}>Reset to defaults</button><button className="btn pri" disabled=${!dirty} onClick=${() => { setDb(d => ({ ...d, rules: r })); toast('Rules saved; recommendations updated'); }}>Save rules</button>`} />
    <section className="panel"><div className="tw"><table className="t"><thead><tr><th>Rule</th><th className="n">Value</th><th className="n">Default</th><th>What it does</th></tr></thead><tbody>
      ${RULE_DOC.map(([k, l, doc, step]) => html`<tr key=${k}><td className="name">${l}</td><td className="n" style=${{ width: 150 }}><input className="inp num" style=${{ width: 130 }} id=${'rl-' + k} aria-label=${l} type="number" step=${step} value=${r[k]} onChange=${e => setR({ ...r, [k]: +e.target.value })} /></td><td className="n muted">${DEFAULT_RULES[k]}</td><td style=${{ whiteSpace: 'normal', maxWidth: 480, padding: '6px 10px' }} className="sm">${doc}</td></tr>`)}</tbody></table></div></section>
    <div className="note">Evidence levels: weak below ${r.min_purchases} purchases, moderate from ${r.min_purchases}, strong from ${r.min_purchases * 3}.</div></div>`;
}
function SetPrefs() {
  const { db, setDb, prefs, setPrefs, toast, resetDb, localCopy } = useApp(); const [confirmReset, setConfirmReset] = useState(false); const inp = useRef(null);
  const loadFile = (f) => { if (!f) return; const rd = new FileReader(); rd.onload = () => { try { const j = JSON.parse(rd.result); if (!Array.isArray(j.daily) || !Array.isArray(j.accounts)) throw new Error("missing 'accounts' or 'daily'"); setDb(() => j); toast('Database replaced from ' + f.name); } catch (e) { toast('Not a workspace database: ' + e.message); } }; rd.readAsText(f); };
  return html`<div className="page"><${PageHead} title="Preferences" />
    <${Panel} title="Display"><div className="grid g3" style=${{ maxWidth: 820 }}>
      <${Field} label="Theme" id="pr-th"><${Seg} label="Theme" value=${prefs.theme} onChange=${v => setPrefs({ ...prefs, theme: v })} options=${[{ v: 'system', l: 'System' }, { v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }]} /></${Field}>
      <${Field} label="Table density" id="pr-de"><${Seg} label="Density" value=${prefs.density} onChange=${v => setPrefs({ ...prefs, density: v })} options=${[{ v: 'compact', l: 'Compact' }, { v: 'comfortable', l: 'Comfortable' }]} /></${Field}>
      <${Field} label="Default date range" id="pr-r"><${Seg} label="Range" value=${prefs.range} onChange=${v => setPrefs({ ...prefs, range: v })} options=${[{ v: 7, l: '7d' }, { v: 14, l: '14d' }, { v: 30, l: '30d' }]} /></${Field}>
    </div></${Panel}>
    <${Panel} title="Database" sub=${localCopy ? 'Using your local working copy' : 'Using data.json as shipped'}><div style=${{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="sm">The app reads <span className="mono">data.json</span> on start. Edits, imports, experiments and decisions are kept in this browser until you export them.</div>
      <dl className="kv"><dt>Schema</dt><dd>${db.schema_version}</dd><dt>Daily rows</dt><dd>${fmt.int(db.daily.length)}</dd><dt>Campaigns / ads</dt><dd>${db.campaigns.length} / ${db.ads.length}</dd><dt>Experiments</dt><dd>${db.experiments.length}</dd><dt>Decisions</dt><dd>${db.decisions.length}</dd></dl>
      <div className="row"><button className="btn pri" onClick=${() => saveFile('data.json', JSON.stringify(db), 'application/json', toast)}>Export database (data.json)</button><button className="btn" onClick=${() => inp.current.click()}>Open another data.json</button>
        ${confirmReset ? html`<span className="row"><span className="sm">Discard all local changes?</span><button className="btn danger" onClick=${() => { resetDb(); setConfirmReset(false); }}>Yes, reset</button><button className="btn ghost" onClick=${() => setConfirmReset(false)}>Cancel</button></span>` : html`<button className="btn danger" disabled=${!localCopy} onClick=${() => setConfirmReset(true)}>Reset to shipped data.json</button>`}</div>
      <input ref=${inp} type="file" accept=".json" hidden id="pr-file" onChange=${e => { loadFile(e.target.files[0]); e.target.value = ''; }} />
    </div></${Panel}></div>`;
}
