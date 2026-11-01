/* app.js — application shell: loads data.json, keeps a local working copy, routes between modules. */
'use strict';
const NAV = [
  ['Workspace', [['overview', 'Overview', 'OV'], ['decision', 'Campaign Decision', 'CD'], ['creative', 'Creative Intelligence', 'CI'], ['experiments', 'Experiment Tracker', 'EX'], ['budget', 'Budget & Forecast', 'BF'], ['funnel', 'Funnel Diagnostics', 'FD'], ['journal', 'Decision Journal', 'DJ'], ['profit', 'Profitability & Reports', 'PR']]],
  ['Data Management', [['import', 'Import Data', 'IM'], ['history', 'Import History', 'IH'], ['quality', 'Data Quality', 'DQ']]],
  ['Settings', [['accounts', 'Ad Accounts', 'AA'], ['targets', 'Performance Targets', 'PT'], ['rules', 'Decision Rules', 'DR'], ['preferences', 'Preferences', 'PF']]],
];
const PAGES = { overview: Overview, decision: Decision, creative: Creative, experiments: Experiments, budget: Budget, funnel: Funnel, journal: Journal, profit: ProfitReports, import: ImportPage, history: History, quality: Quality, accounts: SetAccounts, targets: SetTargets, rules: SetRules, preferences: SetPrefs };
const DB_KEY = 'pmw.db.v1';
const pageFromHash = () => { const h = (location.hash || '').slice(1); return PAGES[h] ? h : 'overview'; };

function App({ shipped }) {
  const [db, setDbRaw] = useState(() => { const local = LS.get(DB_KEY, null); return local && local.schema_version ? local : shipped; });
  const [localCopy, setLocalCopy] = useState(() => !!LS.get(DB_KEY, null));
  const [prefs, setPrefsRaw] = useState(() => ({ theme: 'system', density: 'compact', range: 30, ...LS.get('pmw.prefs', {}) }));
  const [page, setPage] = useState(pageFromHash); const [params, setParams] = useState({});
  const [acct, setAcctRaw] = useState(() => LS.get('pmw.acct', 'all'));
  const [range, setRange] = useState(prefs.range); const [compare, setCompare] = useState(true);
  const [collapsed, setCollapsed] = useState(() => LS.get('pmw.sb', false)); const [mob, setMob] = useState(false);
  const [drawer, setDrawer] = useState(null); const [modal, setModal] = useState(null); const [toastMsg, setToastMsg] = useState(null);
  const toastT = useRef(null);
  const toast = useCallback((m) => { setToastMsg(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToastMsg(null), 3200); }, []);
  const setDb = useCallback((fn) => setDbRaw(d => { const n = typeof fn === 'function' ? fn(d) : fn; if (!LS.set(DB_KEY, n)) toast('Browser storage is full or blocked; changes last until you close this tab.'); setLocalCopy(true); return n; }), [toast]);
  const resetDb = () => { LS.del(DB_KEY); setDbRaw(shipped); setLocalCopy(false); toast('Reset to shipped data.json'); };
  const setPrefs = (p) => { setPrefsRaw(p); LS.set('pmw.prefs', p); };
  const setAcct = (a) => { setAcctRaw(a); LS.set('pmw.acct', a); };
  useEffect(() => { const r = document.documentElement; if (prefs.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', prefs.theme); r.setAttribute('data-density', prefs.density); }, [prefs]);
  useEffect(() => { const f = () => { setPage(pageFromHash()); setParams({}); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => { if (db.accounts && acct !== 'all' && !db.accounts.some(a => a.id === acct)) setAcct('all'); }, [db]);
  const M = useMemo(() => buildModel(db), [db]);
  const W = useMemo(() => windows(M, range), [M, range]);
  const nav = useCallback((p, opts = {}) => { if (opts.acct) setAcct(opts.acct); if (p) { setPage(p); setParams(opts); try { if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p); } catch (e) {} } setDrawer(null); setMob(false); const w = document.querySelector('.work'); if (w && p) w.scrollTop = 0; }, []);
  const openModal = (m) => setModal(m);
  const isDark = prefs.theme === 'dark' || (prefs.theme === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const today = new Date().toISOString().slice(0, 10); const lag = D.diff(M.end, today);
  const dueDecisions = db.decisions.filter(d => d.status === 'Pending Evaluation' && d.eval_date <= M.end).length;
  const badges = { decision: db.campaigns.filter(c => acct === 'all' || c.account_id === acct).length, journal: dueDecisions || null, quality: M.dups.length || null };
  const ctx = { db, setDb, M, W, acct, setAcct, range, compare, nav, setDrawer, openModal, toast, prefs, setPrefs, resetDb, localCopy };
  const Page = PAGES[page];
  const D_ = drawer && { campaign: CampaignDrawer, creative: CreativeDrawer, experiment: ExperimentDrawer, decision: DecisionDrawer, import: ImportDrawer }[drawer.type];
  return html`<${Ctx.Provider} value=${ctx}>
    <div className=${cx('shell', collapsed && 'collapsed', mob && 'mob-open')}>
      <nav className="sb" aria-label="Main navigation">
        <div className="sb-head"><span className="logo" aria-hidden="true">PW</span><span className="sb-name">${db.workspace.name}</span></div>
        ${NAV.map(([sec, items]) => html`<div className="sb-sec" key=${sec}><h6>${sec}</h6>${items.map(([k, l, ab]) => html`<button key=${k} className=${cx('nav', page === k && 'on')} aria-current=${page === k ? 'page' : null} title=${collapsed ? l : null} onClick=${() => nav(k)}><span className="ab" aria-hidden="true">${ab}</span><span className="lbl">${l}</span>${badges[k] ? html`<span className="badge">${badges[k]}</span>` : null}</button>`)}</div>`)}
        <div className="sb-foot"><button className="nav col-btn" onClick=${() => { setCollapsed(!collapsed); LS.set('pmw.sb', !collapsed); }} aria-label=${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><span className="ab">${collapsed ? '»' : '«'}</span><span className="lbl">Collapse</span></button></div>
      </nav>
      ${mob ? html`<div className="scrim" style=${{ zIndex: 54 }} onClick=${() => setMob(false)}></div>` : null}
      <div className="main">
        <header className="hdr">
          <button className="btn ghost menu-btn" aria-label="Open navigation" onClick=${() => setMob(true)}>Menu</button>
          <span className="demo-tag hide-s" title=${db.notice}>Demo data</span>
          <select className="sel" id="h-acct" aria-label="Ad account" value=${acct} onChange=${e => setAcct(e.target.value)} style=${{ maxWidth: 170 }}><option value="all">All accounts</option>${db.accounts.map(a => html`<option key=${a.id} value=${a.id}>${a.name}</option>`)}</select>
          <${Seg} label="Date range" value=${range} onChange=${setRange} options=${[{ v: 7, l: '7d' }, { v: 14, l: '14d' }, { v: 30, l: '30d' }]} />
          <label className="chk hide-m"><input type="checkbox" id="h-cmp" checked=${compare} onChange=${e => setCompare(e.target.checked)} />Compare previous</label>
          <span className="grow"></span>
          <span className="fresh hide-m" title=${'Latest data row: ' + M.end}><span className=${cx('dot', lag > 3 ? 'bad' : lag > 1 ? 'warn' : '')}></span>Data to ${fmt.dateY(M.end)}${lag > 0 ? ` · ${lag}d behind` : ''}</span>
          <button className="btn ghost" aria-label=${isDark ? 'Switch to light theme' : 'Switch to dark theme'} onClick=${() => setPrefs({ ...prefs, theme: isDark ? 'light' : 'dark' })}>${isDark ? 'Light' : 'Dark'}</button>
          <${Dropdown} ariaLabel="Profile menu" btnClass="btn ghost" label=${html`<span className="logo" style=${{ width: 22, height: 22, background: 'var(--accent)', color: 'var(--accent-fg)' }}>DU</span>`}>
            <div style=${{ padding: '6px 8px' }}><div style=${{ fontWeight: 500 }}>${db.workspace.owner}</div><div className="muted sm">${db.workspace.name}</div></div><hr/>
            <button className="it" data-close onClick=${() => nav('preferences')}>Preferences</button>
            <button className="it" data-close onClick=${() => saveFile('data.json', JSON.stringify(db), 'application/json', toast)}>Export database</button>
            <button className="it" data-close onClick=${() => nav('import')}>Import data</button><hr/>
            <button className="it" disabled style=${{ opacity: .5, cursor: 'not-allowed' }} title="Sign-in arrives with the Supabase build">Sign out (not in prototype)</button>
          </${Dropdown}>
        </header>
        <main className="work" id="main"><${Page} params=${params} key=${page} /></main>
      </div>
    </div>
    ${D_ ? html`<${D_} id=${drawer.id} key=${drawer.type + drawer.id} onClose=${() => setDrawer(null)} />` : null}
    ${modal && modal.type === 'experiment' ? html`<${ExperimentWizard} prefill=${modal.prefill} onClose=${() => setModal(null)} />` : null}
    ${modal && modal.type === 'decision' ? html`<${DecisionForm} prefill=${modal.prefill} onClose=${() => setModal(null)} />` : null}
    ${modal && modal.type === 'watch' ? html`<${WatchModal} id=${modal.campaign_id} onClose=${() => setModal(null)} />` : null}
    ${toastMsg ? html`<div className="toast" role="status">${toastMsg}</div>` : null}
  </${Ctx.Provider}>`;
}
function WatchModal({ id, onClose }) {
  const { db, setDb, M, toast } = useApp(); const ex = (db.watchlist || []).find(w => w.campaign_id === id);
  const [w, setW] = useState(ex || { campaign_id: id, note: '', review: D.add(M.end, db.rules.review_interval_days), metric: 'ROAS' });
  const save = () => { setDb(d => ({ ...d, watchlist: [...(d.watchlist || []).filter(x => x.campaign_id !== id), { ...w, added: ex ? ex.added : new Date().toISOString().slice(0, 10) }] })); toast('Watchlist updated'); onClose(); };
  const remove = () => { setDb(d => ({ ...d, watchlist: (d.watchlist || []).filter(x => x.campaign_id !== id) })); toast('Removed from watchlist'); onClose(); };
  return html`<${Modal} small title=${ex ? 'Watchlist entry' : 'Add to watchlist'} sub=${entName(M, 'campaign', id)} onClose=${onClose} footer=${html`${ex ? html`<button className="btn danger" onClick=${remove}>Remove</button>` : null}<span style=${{ marginLeft: 'auto' }}></span><button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn pri" onClick=${save}>Save</button>`}>
    <${Field} label="What are you watching for?" id="wl-n"><input id="wl-n" className="inp" value=${w.note} onChange=${e => setW({ ...w, note: e.target.value })} placeholder="e.g. ROAS after budget increase" /></${Field}>
    <div className="grid g2"><${Field} label="Metric" id="wl-m"><select id="wl-m" className="sel" value=${w.metric} onChange=${e => setW({ ...w, metric: e.target.value })}><option>ROAS</option><option>CPA</option><option>Outbound CTR</option><option>Purchases</option></select></${Field}><${Field} label="Review on" id="wl-r"><input id="wl-r" type="date" className="inp" value=${w.review} onChange=${e => setW({ ...w, review: e.target.value })} /></${Field}></div>
  </${Modal}>`;
}

function Boot() {
  const [state, setState] = useState({ s: 'loading' });
  const load = () => { setState({ s: 'loading' }); fetch('data.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(j => setState({ s: 'ready', db: j })).catch(e => { const local = LS.get(DB_KEY, null); local ? setState({ s: 'ready', db: local }) : setState({ s: 'error', e: String(e.message || e) }); }); };
  useEffect(load, []);
  if (state.s === 'loading') return html`<div className="boot"><div style=${{ width: 260, display: 'flex', flexDirection: 'column', gap: 8 }}><div className="skel" style=${{ width: '50%' }}></div><div className="skel"></div><div className="skel" style=${{ width: '70%' }}></div><div className="muted sm">Loading data.json…</div></div></div>`;
  if (state.s === 'error') return html`<div className="boot"><div style=${{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}><b>Could not load data.json</b><div className="muted sm">${state.e}. Keep data.json next to index.html, or open a database file now.</div><div className="row"><button className="btn pri" onClick=${load}>Try again</button><label className="btn">Open data.json<input type="file" accept=".json" hidden onChange=${e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { setState({ s: 'ready', db: JSON.parse(rd.result) }); } catch (err) { setState({ s: 'error', e: 'Invalid JSON' }); } }; rd.readAsText(f); }} /></label></div></div></div>`;
  return html`<${App} shipped=${state.db} />`;
}
ReactDOM.createRoot(document.getElementById('root')).render(html`<${Boot} />`);
if ('serviceWorker' in navigator && !FRAMED) { window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {})); }
