/* Sanjeevani caregiver dashboard (dashboard.md).
   Everything renders from one state object. It starts from the built-in snapshot, then
   follows data/state.json (polled every 3s when served over http). Shift + D opens demo controls. */
(function () {
  'use strict';

  const D = window.SanjeevaniDemo;
  const ic = window.ic;
  const $ = (s, el = document) => el.querySelector(s);

  let state = D.scenario(0);
  let session = null; // { email, name, given, picture } from /api/me when the login server is running
  const ui = {
    route: 'overview', member: 'all', actFilter: 'all', expanded: new Set(), review: new Set(),
    recMember: 'maa', recFilter: 'all', drawer: null, fhir: false, src: 'Built-in demo data'
  };

  /* =========================================================
     Helpers
     ========================================================= */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = (kind, word, cls = '') => `<span class="st st--${kind} ${cls}">${ic('st-' + kind, 'ic-sm')}${esc(word)}</span>`;
  const mem = (id) => state.members.find((m) => m.id === id);
  const plural = (n, one, many) => (n === 1 ? one : many);
  const ARROW = { up: '↑', down: '↓', flat: '→' };
  const TAGS = {
    sanjeevani: ['blue', 'Done by Sanjeevani'],
    you: ['green', 'Approved by you'],
    asked: ['gray', 'Asked you'],
    rohan: ['purple', 'Handled by Rohan'],
    failed: ['red', 'Failed — retried once']
  };
  const TYPE = {
    rx: { label: 'Prescription', icon: 'pill', fhir: 'MedicationRequest' },
    lab: { label: 'Lab report', icon: 'tube', fhir: 'DiagnosticReport' },
    discharge: { label: 'Discharge', icon: 'pad', fhir: 'Composition' },
    scan: { label: 'Scan', icon: 'image', fhir: 'DiagnosticReport' }
  };
  const SRC_ICON = { WhatsApp: 'chat', Email: 'mail', 'Doctor input': 'keyboard' };

  const tag = (k) => { const t = TAGS[k] || TAGS.asked; return `<span class="tag tag--${t[0]}">${esc(t[1])}</span>`; };

  function stockStatus(md) {
    if (md.stale) return { kind: 'neutral', word: 'Unconfirmed', long: `Unconfirmed — last known ${md.stale}` };
    if (md.days <= 3) return { kind: 'crit', word: 'Out soon' };
    if (md.days <= 7) return { kind: 'warn', word: 'Running low' };
    return { kind: 'good', word: 'On track' };
  }

  function memberStatus(m) {
    const rank = { good: 0, warn: 1, crit: 2 };
    let k = 'good';
    const bump = (x) => { if (rank[x] > rank[k]) k = x; };
    m.medicines.forEach((md) => {
      const s = stockStatus(md);
      if (s.kind === 'crit') bump(md.next.kind === 'placed' || md.next.kind === 'told' ? 'warn' : 'crit');
      else if (s.kind !== 'good') bump('warn');
    });
    m.trends.forEach((t) => { if (t.flag) bump('warn'); });
    if (state.decisions.some((d) => d.member === m.id)) bump('warn');
    return k;
  }

  function globalStatus() {
    const away = state.caregiver.away;
    const meds = state.members.flatMap((m) => m.medicines);
    const told = meds.filter((md) => md.next.kind === 'told').length;
    const crit = meds.filter((md) => stockStatus(md).kind === 'crit' && !['placed', 'told'].includes(md.next.kind)).length;
    const mine = (away ? 0 : state.decisions.length) + told;
    const withBackup = away ? state.decisions.length : 0;
    if (crit) return { kind: 'crit', text: 'Action needed', mine: mine + crit, withBackup };
    if (mine) return { kind: 'warn', text: `${mine} ${plural(mine, 'needs', 'need')} a look`, mine, withBackup };
    return { kind: 'good', text: 'All good', mine: 0, withBackup };
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  function toast(msg, icon = 'st-good') {
    const box = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `${ic(icon)}<span>${esc(msg)}</span>`;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3600);
  }

  /* =========================================================
     Top bar
     ========================================================= */
  function renderTop() {
    const g = globalStatus();
    const c = state.caregiver;
    const first = session ? session.given || session.name : c.name;
    const full = session ? session.name : c.name;
    const initials = session ? (full || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : c.initials;
    const pic = session && session.picture ? `<img src="${esc(session.picture)}" alt="" referrerpolicy="no-referrer">` : esc(initials);
    $('#topbar').innerHTML = `
      <div class="greet">
        <h1>${greeting()}, ${esc(first)}</h1>
        <p><span class="fam">${esc(c.family)}</span><span class="sync"><i></i>Updated ${esc(state.updated)}</span></p>
      </div>
      <div class="top-right">
        <button class="gpill gpill--${g.kind}" type="button" data-action="to-decisions" title="Go to Needs your decision">
          ${ic('st-' + g.kind, 'ic-sm')}${esc(g.text)}${g.withBackup ? `<small>· ${g.withBackup} with ${esc(state.backup.name)}</small>` : ''}
        </button>
        <span class="top-sep"></span>
        <label class="switch"><input type="checkbox" data-action="away" aria-label="I'm away" ${c.away ? 'checked' : ''}><span class="switch-track"></span><span class="away-l">I'm away</span></label>
        <div class="avatar">
          <button type="button" data-action="menu" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">${pic}</button>
          <div class="menu" id="menu" role="menu">
            <div class="menu-h"><b>${esc(full)}</b><small>${esc(session ? session.email : c.phone)}</small><small>Primary caregiver</small></div>
            <button type="button" role="menuitem" data-action="demo-open">${ic('zap')}Demo controls<kbd>Shift D</kbd></button>
            <a role="menuitem" href="index.html">${ic('home')}Back to website</a>
            <button type="button" role="menuitem" data-action="logout">${ic('logout')}Log out</button>
          </div>
        </div>
      </div>`;
    $('#sidePhone').textContent = c.phone;
  }

  /* =========================================================
     Overview
     ========================================================= */
  function renderOverview() {
    const m = ui.member === 'all' ? null : mem(ui.member);
    return `<div class="stack">
      ${state.caregiver.away ? banner() : ''}
      ${tabs()}
      ${kpis(m)}
      <div class="cols">
        <div class="col">${m ? summary(m) : ''}${medsCard(m)}${trendsCard(m)}${activityCard(m)}</div>
        <div class="col">${decisionsCard(m)}${deliveryCard(m)}${upcomingCard(m)}${abhaCard(m)}${careCard(m)}${mandateCard()}</div>
      </div>
      ${quietLine()}
    </div>`;
  }

  function banner() {
    const c = state.caregiver, b = state.backup;
    return `<div class="banner" role="status">${ic('plane')}
      <span><b>You're away until ${esc(c.away_until)}.</b> Routine refills continue within your limits. Anything new goes to <b>${esc(b.name)} (${esc(b.relation)})</b>. You'll get a summary when you land.</span>
      <button class="link" type="button" data-action="toast" data-msg="Trip dates live in Settings (not part of the demo)">Change</button></div>`;
  }

  function tabs() {
    const words = { good: 'On track', warn: 'Needs a look', crit: 'Action needed' };
    const t = state.members.map((m) => {
      const s = memberStatus(m);
      return `<button class="tab ${ui.member === m.id ? 'on' : ''}" type="button" data-action="member" data-id="${m.id}" aria-pressed="${ui.member === m.id}" title="${esc(m.tab)} · ${words[s]}">
        <span class="av">${esc(m.initials)}</span>${esc(m.tab)}<span class="tst ${s}" aria-label="${words[s]}">${ic('st-' + s, 'ic-sm')}</span></button>`;
    }).join('');
    return `<div class="tabs" role="toolbar" aria-label="Family member"><button class="tab all ${ui.member === 'all' ? 'on' : ''}" type="button" data-action="member" data-id="all" aria-pressed="${ui.member === 'all'}">All</button>${t}</div>`;
  }

  function kpis(m) {
    const k = m ? m.kpi : state.kpis;
    const rows = state.activity.filter((a) => a.week && (!m || a.member === m.id) && ['sanjeevani', 'you', 'rohan', 'failed'].includes(a.tag));
    const bySan = rows.filter((a) => a.tag === 'sanjeevani' || a.tag === 'failed').length;
    const byYou = rows.filter((a) => a.tag === 'you').length;
    const byRohan = rows.filter((a) => a.tag === 'rohan').length;
    const parts = [`${bySan} by Sanjeevani`];
    if (byYou) parts.push(`${byYou} by you`);
    if (byRohan) parts.push(`${byRohan} by Rohan`);

    const recs = state.records.filter((r) => !m || r.member === m.id);
    const synced = recs.filter((r) => r.abha === 'synced').length;
    const local = recs.filter((r) => r.abha === 'local').length;
    const linked = !m || m.abhaLinked;

    return `<div class="kpis">
      <div class="card kpi"><div class="kpi-l">Missed care actions</div><div class="kpi-n">${k.missed}</div><div class="kpi-c">this month ${st('good', 'On track')}</div></div>
      <div class="card kpi"><div class="kpi-l">Medicines covered</div><div class="kpi-n">${k.days == null ? '—' : `${k.days}<small>days</small>`}</div><div class="kpi-c">${k.days == null ? esc(k.nextReorder) : 'Next auto-reorder: ' + esc(k.nextReorder)}</div></div>
      <div class="card kpi"><div class="kpi-l">Actions handled</div><div class="kpi-n">${rows.length}</div><div class="kpi-c">this week · ${esc(parts.join(', '))}</div></div>
      <div class="card kpi"><div class="kpi-l">Records on ABHA</div><div class="kpi-n">${linked ? synced : '—'}</div><div class="kpi-c">${linked ? `${local} kept locally · last sync ${esc(state.abha.last_sync)}` : st('neutral', 'ABHA not linked yet')}</div></div>
    </div>`;
  }

  function summary(m) {
    const abha = m.abhaLinked
      ? `ABHA: <span class="mono">${esc(m.abha)}</span> ${st('good', 'Linked')}`
      : `ABHA: ${st('neutral', 'Not linked yet')} <button class="link" type="button" data-action="toast" data-msg="ABHA linking opens the ABDM consent flow (not part of the demo)">Link ABHA</button>`;
    const lt = m.lastTest ? `${esc(m.lastTest.text)} ${m.lastTest.kind === 'warn' ? st('warn', 'Rising') : ''}<small>${esc(m.lastTest.date)}</small>` : `<span class="muted">None on file</span>`;
    const ap = m.appt ? `${esc(m.appt.doctor)} · ${esc(m.appt.spec)}<small>${esc(m.appt.date)} · ${esc(m.appt.time)} ${st(m.appt.status, m.appt.word)}</small>` : `<span class="muted">None booked</span>`;
    const lr = m.lastRefill ? `${esc(m.lastRefill.where)}<small>${esc(m.lastRefill.when)}</small>` : `<span class="muted">No regular medicines</span>`;
    return `<section class="card" aria-label="${esc(m.name)} summary">
      <div class="ms">
        <span class="ms-av">${esc(m.initials)}</span>
        <div><div class="ms-name">${esc(m.name)} · ${m.age} · ${esc(m.city)}</div><div class="ms-abha">${abha}</div></div>
        <button class="btn btn--secondary" type="button" data-action="doc-summary" data-id="${m.id}">Doctor summary ${ic('download', 'ic-sm')}</button>
      </div>
      <dl class="kv">
        <div><dt>Current medicines</dt><dd>${m.medicines.length} active</dd></div>
        <div><dt>Last test</dt><dd>${lt}</dd></div>
        <div><dt>Next appointment</dt><dd>${ap}</dd></div>
        <div><dt>Last refill</dt><dd>${lr}</dd></div>
      </dl>
    </section>`;
  }

  /* ---------- Stock tracker ---------- */
  function medsCard(m) {
    const list = (m ? [m] : state.members).flatMap((p) => p.medicines.map((md) => ({ md, p })));
    const nextIcon = { auto: 'clock', placed: 'truck', told: 'bell', waiting: 'user', paused: 'clock' };
    const rows = list.map(({ md, p }) => {
      const s = stockStatus(md);
      const w = Math.max(3, Math.min(100, (md.days / 30) * 100));
      const conf = md.stale
        ? st('neutral', s.long)
        : `<span class="med-conf">${ic('check', 'ic-xs')}Last confirmed: ${esc(md.confirmed)}</span>`;
      return `<div class="med">
        <div><div class="med-n">${esc(md.name)} · ${esc(md.freq)}</div><div class="med-s">For ${esc(p.name)} · ${esc(md.pharmacy)}</div></div>
        <div class="med-bar">
          <div class="bar bar--${md.stale ? 'stale' : s.kind}" role="img" aria-label="${md.days} of 30 days left"><i style="width:${w}%"></i></div>
          <div class="med-next">${ic(nextIcon[md.next.kind] || 'clock', 'ic-xs')}${esc(md.next.text)}</div>
          ${conf}
        </div>
        <div class="med-days"><b>${md.days} ${plural(md.days, 'day', 'days')}</b>${st(s.kind, s.word)}</div>
      </div>`;
    }).join('');
    return `<section class="card" id="meds">
      <div class="card-h"><h2 class="card-t">Medicines</h2><span class="card-s">Sanjeevani reorders 7 days before stock runs out</span></div>
      <div class="card-b"><div class="meds">${rows || `<p class="empty empty--n">${ic('info')}No regular medicines for ${esc(m.name)}.</p>`}</div></div>
    </section>`;
  }

  /* ---------- Trend tracker ---------- */
  function spark(t) {
    const W = 120, H = 32, P = 5;
    const v = t.values;
    const lo = Math.min(...v, t.band[0]), hi = Math.max(...v, t.band[1]);
    const pad = (hi - lo) * 0.15 || 1;
    const y0 = lo - pad, y1 = hi + pad;
    const x = (i) => (v.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (v.length - 1));
    const y = (val) => +(H - ((val - y0) / (y1 - y0)) * H).toFixed(1);
    const d = v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(val)}`).join(' ');
    const label = (i) => `${t.dates[i]} · ${t.labels ? t.labels[i] : v[i]} ${t.unit}`;
    const hits = v.map((val, i) => `<circle class="hit" cx="${x(i).toFixed(1)}" cy="${y(val)}" r="7" data-tip="${esc(label(i))}"/>`).join('');
    const li = v.length - 1;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.metric)} trend: ${esc(v.join(', '))}">
      <rect class="band" x="0" y="${y(t.band[1])}" width="${W}" height="${(y(t.band[0]) - y(t.band[1])).toFixed(1)}" rx="3"><title>Usual range</title></rect>
      <path class="ln" d="${d}"/><circle class="last" cx="${x(li).toFixed(1)}" cy="${y(v[li])}" r="4"/>${hits}</svg>`;
  }

  function trendsCard(m) {
    const list = (m ? [m] : state.members).flatMap((p) => p.trends.map((t) => ({ t, p })));
    const rows = list.map(({ t, p }) => `<div class="tr">
        <div class="tr-m">${esc(t.metric)}<small>${m ? esc(t.unit) : `${esc(p.name)} · ${esc(t.unit)}`}</small></div>
        ${spark(t)}
        <div class="tr-v"><b>${esc(t.display)}</b><span class="arr" aria-label="${t.dir}">${ARROW[t.dir]}</span><small>${esc(t.last)}</small></div>
        <div class="tr-f">${t.flag ? `<span class="tag tag--flag">${ic('trend', 'ic-xs')}${esc(t.flag)}</span>` : st('good', t.status || 'Stable')}</div>
      </div>`).join('');
    return `<section class="card" id="trends">
      <div class="card-h"><h2 class="card-t">Health trends</h2><span class="card-s">Sanjeevani flags patterns to mention to the doctor. It never diagnoses.</span></div>
      <div class="card-b"><div class="trs">${rows || `<p class="empty empty--n">${ic('info')}Nothing tracked for ${esc(m.name)} yet.</p>`}</div></div>
    </section>`;
  }

  /* ---------- Activity log ---------- */
  const FILTERS = [['all', 'All'], ['medicine', 'Medicines'], ['appointment', 'Appointments'], ['record', 'Records'], ['needed', 'Needed you']];
  function activityCard(m) {
    const rows = state.activity
      .filter((a) => !m || a.member === m.id)
      .filter((a) => ui.actFilter === 'all' || (ui.actFilter === 'needed' ? ['you', 'asked', 'rohan'].includes(a.tag) : a.cat === ui.actFilter));
    const sub = (s) => {
      const i = s.indexOf('● ');
      return i < 0 ? esc(s) : esc(s.slice(0, i)) + st('good', s.slice(i + 2));
    };
    const body = rows.map((a) => {
      const open = ui.expanded.has(a.id);
      const d = a.detail || {};
      return `<div class="act ${open ? 'open' : ''}">
        <button class="act-row" type="button" data-action="toggle-act" data-id="${a.id}" aria-expanded="${open}">
          <span class="act-ic">${ic(a.icon)}</span>
          <span class="act-t">${esc(a.text)}</span>
          <span class="act-time">${esc(a.time)}</span>
          ${tag(a.tag)}
          <span class="act-chev">${ic('chev-down', 'ic-sm')}</span>
          <span class="act-s">${sub(a.sub || '')}</span>
        </button>
        <div class="act-d">
          <div class="act-grid">
            <div><h5>What triggered it</h5><p>${esc(d.trigger)}</p></div>
            <div><h5>Your window</h5><p>${esc(d.window)}</p></div>
            <div><h5>What it did</h5><ol>${(d.did || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
            <div><h5>Proof</h5><div class="proof">${(d.proof || []).map((x) => `<span class="chip-mono">${esc(x)}</span>`).join('')}</div></div>
          </div>
          <div class="act-links">
            ${d.undo ? `<button class="link" type="button" data-action="toast" data-msg="${esc(d.undo)} requested. Sanjeevani will confirm on WhatsApp." data-icon="undo">${ic('undo', 'ic-sm')}${esc(d.undo)}</button>` : ''}
            <button class="link link--muted" type="button" data-action="toast" data-msg="Thanks. A person from Sanjeevani will look at this." data-icon="flag">${ic('flag', 'ic-sm')}Report a problem</button>
          </div>
        </div>
      </div>`;
    }).join('');
    return `<section class="card" id="activity">
      <div class="card-h"><h2 class="card-t">What Sanjeevani did</h2><span class="right card-s">Newest first</span></div>
      <div class="filters" role="toolbar" aria-label="Filter activity">${FILTERS.map(([k, l]) => `<button class="fchip ${ui.actFilter === k ? 'on' : ''}" type="button" data-action="act-filter" data-f="${k}" aria-pressed="${ui.actFilter === k}">${l}</button>`).join('')}</div>
      <div class="acts">${body || `<div class="act" style="padding:16px 20px"><p class="empty empty--n">${ic('info')}Nothing here yet.</p></div>`}</div>
      <div class="card-f"><button class="link" type="button" data-action="toast" data-msg="The full log keeps 30 days (not part of the demo)">View full log ${ic('right', 'ic-sm')}</button></div>
    </section>`;
  }

  /* ---------- Needs your decision ---------- */
  function handwritingThumb() {
    return `<svg viewBox="0 0 280 70" aria-label="Crop of the handwritten medicine name">
      <rect width="280" height="70" fill="#FFFEF8"/>
      <g fill="none" stroke="#22336B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 44q5-20 10 0t10-2q4-16 8 0t8 1t8-3q4-14 8 0t8 0m12 0q5-16 10-1t9 0t9 1q3-10 6 0t7-2"/>
        <path d="M168 40q4-8 8 0t8 0m8-2h14m-14 6h10"/>
      </g>
      <rect x="14" y="18" width="134" height="38" rx="4" fill="none" stroke="#EFB100" stroke-width="2" stroke-dasharray="5 4"/>
    </svg>`;
  }
  function decisionsCard(m) {
    const away = state.caregiver.away;
    const items = state.decisions.filter((d) => !m || d.member === m.id);
    const forYou = away ? 0 : items.length;
    const body = items.map((d) => {
      const p = mem(d.member);
      const who = `<div class="dec-who"><span class="av">${esc(p.initials)}</span>For ${esc(p.name)}</div>`;
      const routed = `<div class="dec-routed">${ic('escalate', 'ic-sm')}Sent to ${esc(state.backup.name)} · you're away</div>`;
      if (d.kind === 'choice') {
        return `<div class="dec">${who}<div class="dec-t">${esc(d.title)}</div>
          <div class="dec-thumb">${handwritingThumb()}</div>
          <div class="dec-c">${esc(d.context)} · ${d.options.map(esc).join(' or ')}?</div>
          ${away ? routed : `<div class="dec-act">${d.options.map((o) => `<button class="btn btn--secondary btn--sm" type="button" data-action="decide" data-id="${d.id}" data-choice="${esc(o)}">${esc(o)}</button>`).join('')}</div>`}</div>`;
      }
      const rev = ui.review.has(d.id) ? `<div class="dec-thumb">${docSVG({ type: 'rx', from: 'Dr. Rao · General Medicine' })}</div><div class="dec-c">Telma 40 OD (in refills) · Metoprolol 25 OD (in refills) · <b>Rosuvastatin 10 OD (new)</b></div>` : '';
      return `<div class="dec">${who}<div class="dec-t">${esc(d.title)}</div><div class="dec-c">${esc(d.context)}</div>${rev}
        ${away ? routed : `<div class="dec-act"><button class="btn btn--primary btn--sm" type="button" data-action="decide" data-id="${d.id}">${esc(d.primary)}</button><button class="btn btn--secondary btn--sm" type="button" data-action="review" data-id="${d.id}">${ui.review.has(d.id) ? 'Hide' : esc(d.secondary)}</button></div>`}</div>`;
    }).join('');
    const right = items.length ? `<span class="right"><span class="tag ${forYou ? 'tag--amber' : 'tag--gray'}">${forYou} for you</span></span>` : '';
    return `<section class="card ${forYou ? 'card--attn' : ''}" id="decisions">
      <div class="card-h"><h2 class="card-t">Needs your decision</h2>${right}</div>
      <div class="card-b">${body || `<p class="empty">${ic('st-good')}Nothing needs you right now.</p>`}</div>
    </section>`;
  }

  /* ---------- Live delivery ---------- */
  function deliveryCard(m) {
    const d = state.delivery;
    if (!d || (m && d.member !== m.id)) return '';
    const p = mem(d.member);
    const route = d.route === 'local' ? 'Local partner · Tier-2' : 'Delhivery';
    const complete = d.done >= d.steps.length;
    const steps = d.steps.map((s, i) => {
      const done = i < d.done;
      return `<div class="sp ${done ? 'done' : ''}">
        <span class="sp-i">${ic(done ? 'st-good' : 'st-neutral', 'ic-sm')}</span>
        <span class="sp-l">${esc(s.label)}${s.chip ? ` <span class="tag tag--blue">${esc(route)}</span>` : ''}</span>
        <span class="sp-time">${esc(done && s.doneTime ? s.doneTime : s.time)}</span>
      </div>`;
    }).join('');
    return `<section class="card" id="delivery">
      <div class="card-h"><h2 class="card-t">Live delivery</h2><span class="right">${complete ? st('good', 'Delivered') : `<span class="tag tag--gray">${ic('truck', 'ic-xs')}In flight</span>`}</span></div>
      <div class="card-b"><div class="del-h">${esc(d.item)} · for ${esc(p.name)} · ${esc(d.city)}</div><div class="stepper">${steps}</div></div>
    </section>`;
  }

  /* ---------- Coming up ---------- */
  function upcomingCard(m) {
    const list = state.upcoming.filter((u) => !m || u.member === m.id);
    const rows = list.map((u) => {
      const [dow, num] = u.day.split(' ');
      return `<div class="up"><div class="up-d">${esc(dow)}<small>${esc(num)} Oct</small></div>
        <div class="up-t">${esc(u.text)}${m ? '' : ` <small>(${esc(mem(u.member).name)})</small>`}</div>
        <div class="up-r">${u.status ? st(u.status[0], u.status[1]) : ''}${ic(u.icon)}</div></div>`;
    }).join('');
    return `<section class="card" id="upcoming">
      <div class="card-h"><h2 class="card-t">Coming up</h2><span class="right card-s">Next 14 days</span></div>
      <div class="card-b"><div class="ups">${rows || `<p class="empty empty--n">${ic('cal')}Nothing in the next 14 days.</p>`}</div></div>
    </section>`;
  }

  /* ---------- ABHA records ---------- */
  function recChip(r) {
    if (r.abha === 'synced') return `<span class="tag tag--green">${ic('st-good', 'ic-xs')}Synced to ABHA</span>`;
    if (r.abha === 'local') return `<span class="tag tag--gray">${ic('st-neutral', 'ic-xs')}Kept locally</span>`;
    return `<span class="tag tag--amber">${ic('st-warn', 'ic-xs')}Needs confirmation</span>`;
  }
  function abhaCard(m) {
    const who = m || mem('maa');
    const head = `<div class="card-h"><h2 class="card-t">Health records · ABHA</h2><span class="right"><span class="tag tag--blue">${ic('shield', 'ic-xs')}ABDM-linked</span></span></div>`;
    if (!who.abhaLinked) {
      return `<section class="card">${head}<div class="card-b"><p class="empty empty--n">${ic('st-neutral')}${esc(who.name)}'s ABHA isn't linked yet. Records are kept in your Sanjeevani record.</p>
        <div style="margin-top:12px"><button class="btn btn--secondary btn--sm" type="button" data-action="toast" data-msg="ABHA linking opens the ABDM consent flow (not part of the demo)">Link ABHA</button></div></div></section>`;
    }
    const recs = state.records.filter((r) => r.member === who.id).sort((a, b) => b.ts - a.ts);
    const synced = recs.filter((r) => r.abha === 'synced').length;
    const local = recs.filter((r) => r.abha === 'local').length;
    const docs = recs.slice(0, 3).map((r) => `<button class="doc" type="button" data-action="open-record" data-id="${r.id}">
        <span class="doc-ic">${ic(TYPE[r.type].icon)}</span>
        <span class="doc-t">${esc(r.title)} · ${esc(r.from.split(' · ')[0])} · ${esc(r.date.replace(' 2026', ''))}</span>
        <span class="doc-s">${recChip(r)}</span></button>`).join('');
    return `<section class="card" id="abha">${head}
      <div class="card-b">
        <div class="ab-sum">
          <div><b>${synced}</b><span>on ABHA</span></div>
          <div><b>${local}</b><span>kept locally <span data-tip="From clinics not on ABDM — still in your record, can't sync yet">${ic('info', 'ic-xs')}</span></span></div>
          <div style="margin-left:auto;align-self:center">${st('good', 'Synced ' + state.abha.last_sync)}</div>
        </div>
        <div class="docs">${docs}</div>
      </div>
      <div class="card-f"><a class="link" href="#/records">Open all records ${ic('right', 'ic-sm')}</a><button class="link" type="button" data-action="doc-summary" data-id="${who.id}">Doctor summary ${ic('download', 'ic-sm')}</button></div>
    </section>`;
  }

  /* ---------- Care circle ---------- */
  function careCard(m) {
    const c = state.caregiver, b = state.backup;
    const parent = m && m.id !== 'anya' ? m : mem('maa');
    const you = c.away
      ? `<span class="st st--neutral">${ic('plane', 'ic-sm')}Away until ${esc(c.away_until.replace(/^\w+, /, ''))}</span>`
      : st('good', 'Active · gets every decision');
    const backup = b.reachable
      ? `${st('good', 'Reachable')} · ${c.away ? '<b style="color:var(--g800);font-weight:600">receives decisions now</b>' : "receives decisions while you're away"}`
      : st('neutral', 'Not reachable');
    return `<section class="card" id="care">
      <div class="card-h"><h2 class="card-t">Care circle</h2></div>
      <div class="card-b"><div class="cc">
        <div class="cc-r"><span class="cc-av">${esc(c.initials)}</span><span class="cc-n">You (${esc(c.name)})<span class="tag tag--blue">Primary</span></span><span class="cc-s">${you}</span></div>
        <div class="cc-r"><span class="cc-av p">${esc(b.name[0])}</span><span class="cc-n">${esc(b.name)} (${esc(b.relation)})<span class="tag tag--purple">Backup</span></span><span class="cc-s">${backup}</span></div>
        <div class="cc-r"><span class="cc-av o">${esc(parent.initials)}</span><span class="cc-n">${esc(parent.name)}<span class="tag tag--gray">Parent</span></span><span class="cc-s"><span class="st st--neutral">${ic('voice', 'ic-sm')}Voice notes only · ${esc(parent.lang)}</span></span></div>
      </div></div>
      <div class="card-f"><button class="link" type="button" data-action="toast" data-msg="Access settings are not part of the demo">Manage access ${ic('right', 'ic-sm')}</button></div>
    </section>`;
  }

  /* ---------- Payment mandate ---------- */
  function mandateCard() {
    const md = state.mandate;
    const pct = Math.min(100, (md.used / md.cap) * 100);
    const inr = (n) => '₹' + n.toLocaleString('en-IN');
    return `<section class="card" id="mandate">
      <div class="card-h"><h2 class="card-t">Payment mandate</h2></div>
      <div class="card-b">
        <div class="md-top"><b>${esc(md.provider)} standing mandate</b>${st('good', 'Active')}</div>
        <div class="md-cap">Medicines &amp; tests · up to ${inr(md.cap)} / month</div>
        <div class="md-used"><span>Used this month</span><span><b>${inr(md.used)}</b> of ${inr(md.cap)}</span></div>
        <div class="pbar" role="progressbar" aria-valuenow="${md.used}" aria-valuemin="0" aria-valuemax="${md.cap}"><i style="width:${pct}%"></i></div>
        <div class="md-last"><span>Last debit</span><b>${esc(md.lastDebit)}</b></div>
        <p class="md-note">Anything above your limit comes to you first.</p>
      </div>
    </section>`;
  }

  function quietLine() {
    const g = globalStatus();
    if (g.mine) {
      return `<p class="quiet">${ic('st-warn', 'ic-sm')}<b>${g.mine} ${plural(g.mine, 'thing needs', 'things need')} you</b> — <a href="#/overview" data-action="to-decisions">see Needs your decision ↑</a></p>`;
    }
    return `<p class="quiet">${ic('st-good', 'ic-sm')}<b>Nothing else needs you right now.</b> Next summary on Sunday morning.</p>`;
  }

  /* =========================================================
     Records (ABHA) page
     ========================================================= */
  const REC_TABS = [['all', 'All'], ['rx', 'Prescriptions'], ['lab', 'Lab reports'], ['discharge', 'Discharge'], ['scan', 'Scans']];

  function extractionCell(r) {
    if (r.extraction.kind === 'good') return st('good', r.extraction.pct + '%');
    if (r.extraction.kind === 'confirmed') return st('warn', 'Confirmed by you');
    return st('warn', 'Needs confirmation');
  }
  function abhaCell(r) {
    if (r.abha === 'synced') return st('good', 'Synced');
    if (r.abha === 'local') return st('neutral', 'Kept locally');
    return st('warn', 'Retrying');
  }

  function renderRecords() {
    const m = mem(ui.recMember) || mem('maa');
    const opts = state.members.map((p) => `<option value="${p.id}" ${p.id === m.id ? 'selected' : ''}>${esc(p.tab)}${p.abhaLinked ? '' : ' (not linked)'}</option>`).join('');
    const strip = `<section class="card hstrip">
        <label class="sel"><span class="sr-only">Person</span><select data-action="rec-member">${opts}</select>${ic('chev-down', 'ic-sm')}</label>
        <div class="hs-kv"><small>ABHA number</small><span class="mono">${m.abhaLinked ? esc(m.abha) : '—'}</span></div>
        <div class="hs-kv"><small>Status</small><span>${m.abhaLinked ? st('good', 'Linked') : st('neutral', 'Not linked')}</span></div>
        <button class="btn btn--primary" type="button" data-action="doc-summary" data-id="${m.id}">${ic('download')}Download doctor summary</button>
      </section>`;

    let main;
    if (!m.abhaLinked) {
      main = `<section class="card link-empty">${ic('shield')}<h3>${esc(m.name)}'s ABHA isn't linked yet</h3>
        <p>Records shared for ${esc(m.name)} stay in your Sanjeevani record. Link an ABHA to sync them and let hospitals read them.</p>
        <button class="btn btn--primary" type="button" data-action="toast" data-msg="ABHA linking opens the ABDM consent flow (not part of the demo)">Link ABHA</button></section>`;
    } else {
      const all = state.records.filter((r) => r.member === m.id).sort((a, b) => b.ts - a.ts);
      const count = (k) => (k === 'all' ? all.length : all.filter((r) => r.type === k).length);
      const recs = ui.recFilter === 'all' ? all : all.filter((r) => r.type === ui.recFilter);
      const rows = recs.map((r) => `<tr data-action="open-record" data-id="${r.id}" class="${ui.drawer === r.id ? 'sel' : ''}" tabindex="0">
          <td>${esc(r.date)}</td>
          <td><span class="ttype"><span class="i">${ic(TYPE[r.type].icon)}</span>${esc(TYPE[r.type].label)}${r.title !== TYPE[r.type].label ? ` <span class="muted">· ${esc(r.title)}</span>` : ''}</span></td>
          <td>${esc(r.from)}</td>
          <td><span class="tsrc">${ic(SRC_ICON[r.source] || 'file', 'ic-sm')}${esc(r.source)}</span></td>
          <td>${extractionCell(r)}</td>
          <td>${abhaCell(r)}</td>
        </tr>`).join('');
      main = `<div class="rec-layout">
        <section class="card">
          <div class="utabs" role="tablist">${REC_TABS.map(([k, l]) => `<button class="utab ${ui.recFilter === k ? 'on' : ''}" type="button" role="tab" aria-selected="${ui.recFilter === k}" data-action="rec-tab" data-f="${k}">${l}<small>${count(k)}</small></button>`).join('')}</div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Date</th><th>Type</th><th>From</th><th>Source</th><th>Extraction</th><th>ABHA status</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="6" class="muted">No records of this type.</td></tr>`}</tbody>
          </table></div>
        </section>
        <aside class="col">
          <section class="card side-note">${ic('info')}<p>Records from clinics not on ABDM stay in your Sanjeevani record and sync automatically if the clinic joins.</p></section>
          <section class="card side-note"><div class="ab-sum" style="padding:0">
            <div><b>${all.filter((r) => r.abha === 'synced').length}</b><span>on ABHA</span></div>
            <div><b>${all.filter((r) => r.abha === 'local').length}</b><span>kept locally</span></div>
            <div><b>${all.filter((r) => r.abha === 'retrying').length}</b><span>retrying</span></div>
          </div>${st('good', 'Last sync ' + state.abha.last_sync)}</section>
        </aside>
      </div>`;
    }

    return `<div class="stack">
      <nav class="crumb" aria-label="Breadcrumb"><a href="#/overview">Overview</a><span>/</span><b>Records (ABHA)</b></nav>
      <div class="page-h"><h2>Records (ABHA)</h2></div>
      ${strip}
      ${main}
    </div>`;
  }

  /* ---------- Document thumbnails ---------- */
  function docSVG(r) {
    const paper = (inner, bg = '#FFFFFF') => `<svg viewBox="0 0 220 290" xmlns="http://www.w3.org/2000/svg"><rect width="220" height="290" fill="${bg}"/>${inner}</svg>`;
    const head = (t, c = '#123F73') => `<text x="16" y="28" font-family="Inter, sans-serif" font-size="11" font-weight="700" fill="${c}">${esc(t)}</text><line x1="16" y1="38" x2="204" y2="38" stroke="#1A5DA6"/>`;
    const lines = (y, n, w = [170, 150, 160, 120, 140]) => Array.from({ length: n }, (_, i) => `<rect x="16" y="${y + i * 14}" width="${w[i % w.length]}" height="5" rx="2.5" fill="#E1E4EA"/>`).join('');
    if (r.type === 'rx') {
      return paper(`${head(r.from ? r.from.split(' · ')[0] : 'Dr.')}
        <text x="16" y="72" font-family="Georgia, serif" font-size="22" font-weight="700" fill="#22336B">℞</text>
        <g fill="none" stroke="#22336B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M40 78q4-13 8 0t8 0t7-3q3-12 6 1t6 0t7-2m9 3q4-11 8 0t8-1t8 1t7 0m10-2q3-12 6 0t6 1"/>
          <path d="M40 110q4-12 8 0t8 0t8 0t7-2q3-12 6 1t7 0m10 0q4-10 8 0t8 0t7 0m10-1q4-12 7 0"/>
          <path d="M40 142q4-12 8 0t8 0t7 0q3-12 6 0t6 0m10 0q4-10 8 0t8 0q3-11 6 0"/>
          <path d="M150 78h18M154 110h16M150 142h12"/>
          <path d="M120 238q10-16 18-2t12-8q6 14 18 0t16 4"/>
        </g>
        <text x="160" y="258" font-family="Inter, sans-serif" font-size="7" fill="#99A0AE">Signature</text>`, '#FFFEF8');
    }
    if (r.type === 'lab') {
      const rows = Array.from({ length: 6 }, (_, i) => `<rect x="16" y="${108 + i * 20}" width="80" height="5" rx="2.5" fill="#E1E4EA"/><rect x="120" y="${108 + i * 20}" width="36" height="5" rx="2.5" fill="${i === 0 ? '#1A5DA6' : '#CACFD8'}"/><rect x="170" y="${108 + i * 20}" width="34" height="5" rx="2.5" fill="#ECEFF3"/>`).join('');
      return paper(`${head(r.from || 'Lab')}
        <text x="16" y="62" font-family="Inter, sans-serif" font-size="13" font-weight="700" fill="#0E121B">${esc(r.title || 'Report')}</text>
        ${lines(72, 1, [110])}
        <rect x="16" y="88" width="188" height="1" fill="#E1E4EA"/>${rows}
        <rect x="16" y="246" width="188" height="1" fill="#E1E4EA"/>${lines(256, 2, [120, 90])}`);
    }
    if (r.type === 'discharge') {
      return paper(`${head(r.from || 'Hospital')}
        <text x="16" y="62" font-family="Inter, sans-serif" font-size="11" font-weight="700" fill="#0E121B" letter-spacing="1">DISCHARGE SUMMARY</text>
        ${lines(78, 4)}<text x="16" y="146" font-family="Inter, sans-serif" font-size="9" font-weight="600" fill="#525866">Course in hospital</text>${lines(156, 5)}
        <text x="16" y="240" font-family="Inter, sans-serif" font-size="9" font-weight="600" fill="#525866">Advice on discharge</text>${lines(250, 2)}`);
    }
    return paper(`<rect x="12" y="12" width="196" height="232" rx="6" fill="#0E121B"/>
      <ellipse cx="110" cy="128" rx="62" ry="78" fill="#2B303B"/><ellipse cx="96" cy="118" rx="26" ry="40" fill="#525866" opacity=".8"/><ellipse cx="128" cy="140" rx="22" ry="30" fill="#717784" opacity=".6"/>
      <text x="22" y="32" font-family="SF Mono, Menlo, monospace" font-size="8" fill="#99A0AE">${esc((r.title || 'SCAN').toUpperCase())}</text>
      <text x="16" y="266" font-family="Inter, sans-serif" font-size="10" font-weight="600" fill="#0E121B">${esc(r.from || '')}</text>${lines(274, 1, [120])}`, '#F5F7FA');
  }

  /* ---------- FHIR ---------- */
  function iso(ts) { const s = String(ts); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; }
  function fhirFor(r) {
    const subject = { reference: 'Patient/abha-91-5502-7316-4821', display: 'Sunita Sharma' };
    if (r.type === 'rx') {
      return { resourceType: 'Bundle', type: 'transaction', entry: (r.meds || []).map((x) => {
        const [name, ...dose] = x.split(' · ');
        return { resource: { resourceType: 'MedicationRequest', status: 'active', intent: 'order', subject, medicationCodeableConcept: { text: name }, dosageInstruction: [{ text: dose.join(' · ') }], authoredOn: iso(r.ts), requester: { display: r.from.split(' · ')[0] } } };
      }) };
    }
    if (r.type === 'discharge') {
      return { resourceType: 'Bundle', type: 'document', entry: [{ resource: { resourceType: 'Composition', status: 'final', type: { text: 'Discharge summary' }, subject, date: iso(r.ts), author: [{ display: r.from }], title: 'Discharge summary', section: [{ title: 'Course in hospital', text: { status: 'generated', div: r.result } }] } }] };
    }
    return { resourceType: 'Bundle', type: 'transaction', entry: [{ resource: { resourceType: 'DiagnosticReport', status: 'final', category: [{ text: r.type === 'scan' ? 'Imaging' : 'Laboratory' }], code: { text: r.title }, subject, effectiveDateTime: iso(r.ts), performer: [{ display: r.from }], conclusion: r.result } }] };
  }
  function highlight(json) {
    return esc(json)
      .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="k">$1</span>$2')
      .replace(/(:\s*)(&quot;.*?&quot;)/g, '$1<span class="s">$2</span>')
      .replace(/(:\s*)(-?\d+(\.\d+)?)/g, '$1<span class="n">$2</span>');
  }
  function fieldsFor(r) {
    const f = [];
    if (r.type === 'rx') {
      f.push(['Doctor', r.from], ['Date', r.date], ['Medicines', (r.meds || []).map(esc).join('<br>')]);
      if (r.extraction.kind === 'confirmed') f.push(['Confirmed', "You picked 'Amlodipine' over 'Amlokind'"]);
    } else if (r.type === 'discharge') {
      f.push(['Hospital', r.from], ['Date', r.date], ['Summary', r.result]);
    } else {
      f.push(['Test', r.title], ['Result', r.result], [r.type === 'scan' ? 'Centre' : 'Lab', r.from], ['Collected', r.date]);
    }
    f.push(['Patient', 'Sunita Sharma (Maa) · F · 68']);
    if (r.note) f.push(['Why local', r.note]);
    if (r.abha === 'retrying') f.push(['ABHA', 'Gateway timed out · retrying in 10 min']);
    return f;
  }

  function renderDrawer() {
    const wrap = $('#drawer');
    const r = ui.drawer && state.records.find((x) => x.id === ui.drawer);
    if (!r || ui.route !== 'records') { wrap.hidden = true; document.body.style.overflow = ''; return; }
    const t = TYPE[r.type];
    const json = JSON.stringify(fhirFor(r), null, 2);
    $('#drawerPanel').innerHTML = `
      <div class="dr-h"><div><h3 id="drawerTitle">${esc(r.title)}${r.title !== t.label ? ` · ${esc(t.label)}` : ''}</h3><p>${esc(r.from)} · ${esc(r.date)} · via ${esc(r.source)}</p></div>
        <button class="dr-x" type="button" data-action="close-drawer" aria-label="Close">${ic('x')}</button></div>
      <div class="dr-b">
        <div class="dr-l"><div class="thumb">${docSVG(r)}</div><small>${ic(SRC_ICON[r.source] || 'file', 'ic-sm')}Original · received on ${esc(r.source)}</small></div>
        <div class="dr-r">
          <div class="dr-sec"><h4>Extracted fields</h4><dl class="fields">${fieldsFor(r).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${k === 'Medicines' ? v : esc(v)}</dd></div>`).join('')}</dl></div>
          <div class="dr-sec"><h4>Extraction</h4>${extractionCell(r)}</div>
          <div class="dr-sec"><h4>ABHA</h4>
            <div class="fhir-row"><span class="chip-mono">${t.fhir}</span>${abhaCell(r)}<button class="btn btn--secondary btn--xs" type="button" data-action="fhir" aria-expanded="${ui.fhir}">${ic('code', 'ic-xs')}${ui.fhir ? 'Hide' : 'View'} FHIR JSON</button></div>
            ${ui.fhir ? `<pre class="json">${highlight(json)}</pre>` : ''}
          </div>
        </div>
      </div>
      <div class="dr-f"><button class="btn btn--secondary btn--sm" type="button" data-action="toast" data-msg="Thanks. A person from Sanjeevani will check this record." data-icon="flag">Report a problem</button><button class="btn btn--primary btn--sm" type="button" data-action="toast" data-msg="Original downloads are not part of the demo" data-icon="download">${ic('download', 'ic-sm')}Download original</button></div>`;
    const wasHidden = wrap.hidden;
    wrap.hidden = false;
    document.body.style.overflow = 'hidden';
    if (wasHidden) $('.dr-x').focus();
  }

  /* ---------- Doctor summary (printable one-pager → Save as PDF) ---------- */
  function doctorSummary(id) {
    const m = mem(id) || mem('maa');
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to download the doctor summary', 'info'); return; }
    const logo = new URL('assets/web/mark.png', location.href).href;
    const meds = m.medicines.map((md) => `<tr><td>${esc(md.name)}</td><td>${esc(md.freq)}</td><td>${esc(md.pharmacy)}</td></tr>`).join('') || '<tr><td colspan="3">No regular medicines</td></tr>';
    const results = m.trends.map((t) => {
      const n = t.values.length, last3 = [n - 3, n - 2, n - 1].filter((i) => i >= 0);
      return `<tr><td>${esc(t.metric)} (${esc(t.unit)})</td>${last3.map((i) => `<td>${esc(t.labels ? t.labels[i] : t.values[i])}<small>${esc(t.dates[i])}</small></td>`).join('')}${'<td></td>'.repeat(3 - last3.length)}</tr>`;
    }).join('') || '<tr><td colspan="4">No results on file</td></tr>';
    const visits = (m.visits || []).map((v) => `<li>${esc(v)}</li>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Doctor summary · ${esc(m.full)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>body{font-family:Inter,system-ui,sans-serif;color:#0E121B;margin:32px auto;max-width:760px;padding:0 24px;font-size:13px;line-height:19px}
      header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #1A5DA6;padding-bottom:14px}header img{width:36px;height:36px}
      header b{font-size:15px;letter-spacing:1.2px;color:#1A5DA6}header span{margin-left:auto;color:#717784;font-size:12px}
      h1{font-size:22px;margin:20px 0 4px}p.m{color:#525866;margin:0}h2{font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#717784;margin:24px 0 8px}
      table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px 10px;border-bottom:1px solid #ECEFF3;vertical-align:top}th{background:#F5F7FA;font-size:11px;text-transform:uppercase;color:#717784}
      td small{display:block;color:#717784;font-size:11px}ul{margin:0;padding-left:18px}footer{margin-top:32px;padding-top:12px;border-top:1px solid #E1E4EA;color:#717784;font-size:11px}
      @media print{body{margin:0}}</style></head><body>
      <header><img src="${logo}" alt=""><b>SANJEEVANI</b><span>Doctor summary · generated 3 Oct 2026</span></header>
      <h1>${esc(m.full)} (${esc(m.name)})</h1>
      <p class="m">${m.age} years · ${m.sex === 'F' ? 'Female' : 'Male'} · ${esc(m.city)} · ABHA ${m.abhaLinked ? esc(m.abha) : 'not linked'}</p>
      <h2>Current medicines</h2><table><tr><th>Medicine</th><th>Frequency</th><th>Pharmacy</th></tr>${meds}</table>
      <h2>Last 3 results per test</h2><table><tr><th>Test</th><th>Result</th><th>Result</th><th>Latest</th></tr>${results}</table>
      <h2>Allergies</h2><p>${esc(m.allergies)}</p>
      <h2>Recent visits</h2><ul>${visits || '<li>None recorded</li>'}</ul>
      <footer>Compiled by Sanjeevani from the family's records. This is a summary for the treating doctor, not a diagnosis.</footer>
      <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
    w.document.close();
  }

  /* =========================================================
     Demo controls (Shift + D)
     ========================================================= */
  function renderDemo() {
    $('#demoSteps').innerHTML = D.STEPS.map((s) => `<li><button type="button" class="${state.step === s.n ? 'on' : ''}" data-action="demo-step" data-n="${s.n}"><b>${s.n}</b><span>${esc(s.title)}</span><small>${esc(s.note)}</small></button></li>`).join('');
    $('#demoSrc').textContent = ui.src;
  }
  function toggleDemo(force) {
    const el = $('#demo');
    el.hidden = force === undefined ? !el.hidden : !force;
    if (!el.hidden) renderDemo();
  }
  function goStep(n) {
    n = Math.max(0, Math.min(8, n));
    applyState(D.scenario(n));
  }

  /* =========================================================
     Rendering, routing, state
     ========================================================= */
  function applyState(next) {
    const prevStep = state.step;
    state = next;
    if (state.toast && state.step !== prevStep) toast(state.toast, 'plane');
    render();
  }

  function render() {
    renderTop();
    $('#view').innerHTML = ui.route === 'records' ? renderRecords() : renderOverview();
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === ui.route));
    renderDrawer();
    if (!$('#demo').hidden) renderDemo();
  }

  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    const [route, id] = h.split('/');
    ui.route = route === 'records' ? 'records' : 'overview';
    ui.drawer = ui.route === 'records' && id ? id : null;
    if (ui.drawer) {
      const r = state.records.find((x) => x.id === ui.drawer);
      if (r) ui.recMember = r.member;
    }
    if (!ui.drawer) ui.fhir = false;
  }

  function scrollToId(id) {
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
    });
  }

  window.addEventListener('hashchange', () => {
    const prev = ui.route;
    parseRoute();
    render();
    if (prev !== ui.route && !ui.drawer) window.scrollTo(0, 0);
  });

  /* ---------- Polling data/state.json ---------- */
  let lastText = null;
  async function poll() {
    if (location.protocol === 'file:') { ui.src = 'Built-in demo data'; return; }
    try {
      const res = await fetch('data/state.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const text = await res.text();
      ui.src = 'Live · data/state.json';
      if (text !== lastText) {
        lastText = text;
        applyState(JSON.parse(text));
      }
    } catch (_) {
      ui.src = 'Built-in demo data';
    }
  }

  /* =========================================================
     Events
     ========================================================= */
  function decide(id, choice) {
    const d = state.decisions.find((x) => x.id === id);
    if (!d) return;
    const p = mem(d.member);
    state.decisions = state.decisions.filter((x) => x !== d);
    let row;
    if (d.kind === 'approve') {
      if (!p.medicines.some((md) => md.id === 'rosu')) {
        p.medicines.push({ id: 'rosu', name: 'Rosuvastatin 10mg', freq: 'once daily', days: 30, pharmacy: 'Apollo Pharmacy', next: { kind: 'placed', text: 'Reorder placed today · arriving Tue' }, confirmed: 'new — first strip' });
      }
      row = { id: 'a-' + Date.now(), member: d.member, icon: 'pill', cat: 'medicine', week: true, tag: 'you', time: 'Just now',
        text: `Added Rosuvastatin 10mg to ${p.name}'s refills`, sub: 'First strip ordered from Apollo Pharmacy',
        detail: { trigger: 'You tapped “Add to refills”', did: ['Added to standing refills', 'First strip ordered from Apollo Pharmacy'], window: 'You decided', proof: ['Order APL-LKO-55901'], undo: 'Remove from refills' } };
      toast(`Rosuvastatin added to ${p.name}'s refills`);
    } else {
      row = { id: 'a-' + Date.now(), member: d.member, icon: 'file', cat: 'record', week: true, tag: 'you', time: 'Just now',
        text: `Confirmed “${choice}” on ${p.name}'s prescription`, sub: 'Saved with the name you picked',
        detail: { trigger: 'Handwriting below 70% confidence', did: [`You picked ${choice}`, 'Prescription saved with the confirmed name'], window: 'You decided', proof: ['Kept locally until ABHA is linked'] } };
      toast(`Saved as ${choice}`);
    }
    state.activity.unshift(row);
    render();
  }

  document.addEventListener('click', (e) => {
    const menu = $('#menu');
    const el = e.target.closest('[data-action]');
    if (menu && menu.classList.contains('on') && !e.target.closest('.avatar')) {
      menu.classList.remove('on');
    }
    const scrollLink = e.target.closest('[data-scroll]');
    if (scrollLink) {
      e.preventDefault();
      if (ui.route !== 'overview') { location.hash = '#/overview'; }
      scrollToId(scrollLink.dataset.scroll);
      return;
    }
    if (!el) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    switch (a) {
      case 'member': ui.member = id; render(); break;
      case 'act-filter': ui.actFilter = el.dataset.f; render(); break;
      case 'toggle-act': ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id); render(); break;
      case 'to-decisions':
        e.preventDefault();
        if (ui.route !== 'overview') location.hash = '#/overview';
        scrollToId('decisions');
        break;
      case 'decide': decide(id, el.dataset.choice); break;
      case 'review': ui.review.has(id) ? ui.review.delete(id) : ui.review.add(id); render(); break;
      case 'doc-summary': doctorSummary(id); break;
      case 'open-record': location.hash = '#/records/' + id; break;
      case 'close-drawer': location.hash = '#/records'; break;
      case 'fhir': ui.fhir = !ui.fhir; renderDrawer(); break;
      case 'rec-tab': ui.recFilter = el.dataset.f; render(); break;
      case 'menu': {
        const on = $('#menu').classList.toggle('on');
        el.setAttribute('aria-expanded', String(on));
        break;
      }
      case 'demo-open': $('#menu').classList.remove('on'); toggleDemo(true); break;
      case 'close-demo': toggleDemo(false); break;
      case 'demo-step': goStep(+el.dataset.n); break;
      case 'demo-prev': goStep((state.step || 0) - 1); break;
      case 'demo-next': goStep((state.step || 0) + 1); break;
      case 'toast': toast(el.dataset.msg, el.dataset.icon || 'info'); break;
      case 'logout':
        fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' })
          .catch(() => {})
          .finally(() => window.location.replace('login.html'));
        break;
      default: break;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'away') {
      state.caregiver.away = el.checked;
      toast(el.checked ? `Away mode on. Anything new goes to ${state.backup.name}.` : "Welcome back. You're the primary again.", 'plane');
      render();
    }
    if (el.dataset.action === 'rec-member') {
      ui.recMember = el.value;
      ui.recFilter = 'all';
      if (ui.drawer) location.hash = '#/records'; else render();
    }
  });

  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test((e.target.tagName || '')) && e.target.type !== 'checkbox';
    if (e.shiftKey && (e.key === 'D' || e.key === 'd') && !typing) { e.preventDefault(); toggleDemo(); return; }
    if (e.key === 'Escape') {
      if (ui.drawer) { location.hash = '#/records'; return; }
      $('#menu') && $('#menu').classList.remove('on');
      if (!$('#demo').hidden) toggleDemo(false);
    }
    if (e.key === 'Enter' && e.target.matches('tr[data-action="open-record"]')) e.target.click();
    if (!$('#demo').hidden && !typing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.altKey) {
      goStep((state.step || 0) + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });

  // Tooltips (sparkline points, info icons)
  const tip = $('#tip');
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    tip.textContent = t.dataset.tip;
    tip.style.left = r.left + r.width / 2 + 'px';
    tip.style.top = r.top + 'px';
    tip.classList.add('on');
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) tip.classList.remove('on'); });
  window.addEventListener('scroll', () => tip.classList.remove('on'), { passive: true });

  /* ---------- Boot (after the session check) ---------- */
  async function authGuard() {
    if (location.protocol === 'file:') return true; // opened as a file: preview only, no login server
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) { window.location.replace('login.html'); return false; }
      if (r.ok) session = await r.json();
    } catch (_) { /* no login server (e.g. plain static server): preview mode */ }
    return true;
  }
  authGuard().then((ok) => {
    if (!ok) return;
    document.documentElement.classList.remove('auth-pending');
    parseRoute();
    render();
    poll();
    if (location.protocol !== 'file:') setInterval(poll, 3000);
  });
})();
