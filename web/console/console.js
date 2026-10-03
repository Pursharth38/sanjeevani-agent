/* Sanjeevani agent console. Follows the orchestrator's /events stream (hello, phase, evt, control)
   and renders every event type in team split 2.3. Keys: Space start · R reset · P pause · J JSON · H hide keys. */
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  const SOURCES = {
    gnani: ['Gnani', '--purple'], pinelabs: ['Pine Labs', '--green'], delhivery: ['Delhivery', '--orange'],
    hf: ['Hugging Face', '--yellow'], whatsapp: ['WhatsApp', '--teal'], agent: ['Agent', '--blue'], abha: ['ABHA', '--sky'],
    clinic: ['Clinic', '--pink']
  };
  const PHASES = { preroll: 'Records', trigger: 'Trigger', reason: 'Agent plan', execute: 'Acting', delivered: 'Delivered', summary: 'Summary', clinic: 'Clinic' };
  const PHASE_ORDER = ['preroll', 'trigger', 'reason', 'execute', 'delivered', 'summary'];
  const STEP_TEXT = {
    notify_caregiver: (a) => ['Tell Pursharth', `Reply HOLD within ${a.hold_window_min || 10} min to stop`],
    book_appointment: (a) => ['Book Dr. Mehta', `${a.pref || 'Earliest slot'} · Gnani call`],
    create_order: (a) => ['Order and pay', `₹${a.amount_inr ?? '—'} · Pine Labs`],
    route_delivery: (a) => ['Route delivery', `${a.pincode || ''} · Delhivery`],
    notify_parent: (a) => ['Tell Maa', `After delivery · ${a.lang === 'hi-IN' ? 'Hindi ' : ''}voice note`],
    escalate_to_backup: (a) => ['Escalate to Rohan', a.reason || 'Backup decides']
  };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const TYPE_CPS = 40;
  const RES_MS = 300;   // FHIR card reveals one resource line this often (orchestrator paces to match)

  const ui = {
    gen: 0, queue: [], busy: false, paused: false, phase: 'idle', feedPhase: null,
    lastJson: null, mode: 'replay', statusTimer: null, countdown: null
  };

  /* ---------------- Time ---------------- */
  // Story times are IST ISO strings ("2026-10-06T09:58:12+05:30"); weekdays come from the date.
  function story(t) {
    if (!t) return null;
    const [date, rest] = t.split('T');
    const [y, m, d] = date.split('-').map(Number);
    return { wd: DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], d, mon: MONTHS[m - 1], hms: rest.slice(0, 8), hm: rest.slice(0, 5) };
  }
  const recorded = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `recorded ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

  async function wait(ms, gen) {
    let left = ms;
    while (left > 0) {
      await new Promise((r) => setTimeout(r, 50));
      if (gen !== ui.gen) return false;
      if (!ui.paused) left -= 50;
    }
    return true;
  }

  /* ---------------- JSON ---------------- */
  function highlight(obj) {
    const s = esc(JSON.stringify(obj, null, 2));
    return s.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g, (m, str, colon, lit) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
      if (lit) return `<span class="b">${m}</span>`;
      return `<span class="n">${m}</span>`;
    });
  }

  function jsonBlock(obj, label) {
    const wrap = el('div', 'json-wrap');
    const btn = el('button', 'json-toggle', `▸ ${esc(label)}`);
    btn.type = 'button';
    const pre = el('pre', 'json', highlight(obj));
    btn.addEventListener('click', () => toggleJson(wrap));
    wrap.append(btn, pre);
    ui.lastJson = wrap;
    return wrap;
  }
  function toggleJson(wrap) {
    if (!wrap) return;
    const open = wrap.classList.toggle('open');
    const btn = $('.json-toggle', wrap);
    btn.textContent = btn.textContent.replace(/^[▸▾]/, open ? '▾' : '▸');
  }

  const media = (src) => (!src ? '' : /^https?:/.test(src) ? src : '/' + String(src).replace(/^\/+/, ''));

  /* ---------------- Plan panel ---------------- */
  function buildPlan(steps, decision) {
    const list = $('#plan');
    list.innerHTML = '';
    $('#planHint').textContent = decision === 'escalate' ? 'Decision: escalate to the backup' : 'Decision: act, then inform';
    for (const s of steps) {
      const [t, sub] = (STEP_TEXT[s.step] || ((a) => [a.step, '']))(s);
      const li = el('li', '', `<span class="mark"></span><span><div class="step-t">${esc(t)}</div><div class="step-s">${esc(sub)}</div></span>`);
      li.dataset.step = s.step;
      li.dataset.status = 'pending';
      list.appendChild(li);
    }
  }
  function setStep(step, status) {
    const items = [...document.querySelectorAll('#plan li')].filter((li) => li.dataset.step === step);
    const li = items.find((x) => !['done', 'blocked', 'stopped'].includes(x.dataset.status));
    if (!li) return;
    li.dataset.status = status;
    $('.mark', li).textContent = status === 'done' ? '✓' : status === 'blocked' || status === 'stopped' ? '✕' : '';
  }

  /* ---------------- Header, limits, phases ---------------- */
  function setRun(state) {
    $('#run').dataset.state = state;
    $('#runText').textContent = state;
  }
  function setClock(t) {
    const s = story(t);
    if (s) $('#clock').textContent = `${s.wd} ${s.d} ${s.mon} · ${s.hm}`;
  }
  function setPhase(phase, title) {
    ui.phase = phase;
    $('#phaseTitle').textContent = title || PHASES[phase] || 'Waiting to start';
    const at = PHASE_ORDER.indexOf(phase);
    document.querySelectorAll('#phases li').forEach((li) => {
      const i = PHASE_ORDER.indexOf(li.dataset.phase);
      li.classList.toggle('past', at >= 0 && i < at);
      li.classList.toggle('now', i === at);
    });
  }
  function scheduleState() {
    clearTimeout(ui.statusTimer);
    ui.statusTimer = setTimeout(refreshState, 250);
  }
  async function refreshState() {
    try {
      const s = await (await fetch('/state.json', { cache: 'no-store' })).json();
      const md = s.mandate;
      $('#mandateText').textContent = `₹${md.used.toLocaleString('en-IN')} / ₹${md.cap.toLocaleString('en-IN')}`;
      $('#mandateBar').style.width = `${Math.min(100, (md.used / md.cap) * 100)}%`;
      $('#factAway').textContent = s.caregiver.away ? `Away until ${s.caregiver.away_until}` : 'Home';
      $('#factBackup').textContent = `${s.backup.name} (${s.backup.relation})`;
      const maa = s.members.find((m) => m.id === 'maa');
      const amlo = maa && maa.medicines.find((m) => m.id === 'amlo');
      if (amlo) $('#factStock').textContent = `${amlo.days} days`;
    } catch (_) { /* orchestrator not reachable */ }
  }

  /* ---------------- Overlays ---------------- */
  const show = (id, on) => $(id).classList.toggle('on', on);
  async function timeCard(text, gen) {
    $('#timeCardText').textContent = text;
    show('#timeCard', true);
    await wait(1600, gen);
    show('#timeCard', false);
  }
  async function finished() {
    let st;
    try { st = await (await fetch('/status', { cache: 'no-store' })).json(); } catch (_) { return; }
    const o = st.outcome;
    setRun(o && o.ok ? 'done' : 'stopped');
    if (!o || !o.ok) return;
    const gen = ui.gen;
    while (ui.busy || ui.queue.length) { if (!(await wait(200, gen))) return; }
    if (!(await wait(1500, gen))) return;
    const did = { book_appointment: 'Dr. Mehta booked', create_order: 'medicine ordered and paid', route_delivery: 'delivered', notify_parent: 'Maa told' };
    const parts = o.completed.map((s) => did[s]).filter(Boolean);
    $('#endN').textContent = '0';
    $('#endSub').textContent = `While Pursharth was away: ${parts.join(', ')}. Nothing else needs him right now.`;
    show('#endCard', true);
  }

  /* ---------------- Feed ---------------- */
  // Follow the newest event unless someone scrolls up; scrolling back to the bottom resumes following.
  const feed = $('#feed');
  let follow = true;
  const atBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  const stick = () => { if (follow) feed.scrollTop = feed.scrollHeight; };
  feed.addEventListener('wheel', (e) => { if (e.deltaY < 0) follow = false; else if (atBottom()) follow = true; }, { passive: true });
  feed.addEventListener('scroll', () => { if (atBottom()) follow = true; }, { passive: true });
  function append(node) {
    feed.appendChild(node);
    stick();
  }

  function divider(evt) {
    if (!evt.phase || evt.phase === ui.feedPhase) return;
    ui.feedPhase = evt.phase;
    const s = story(evt.t);
    append(el('div', 'divider', `${esc(PHASES[evt.phase] || evt.phase)}${s ? ` <span class="dc">${esc(`${s.wd} ${s.d} ${s.mon}`)}</span>` : ''}`));
  }

  // "POST https://…/api/checkout/v1/orders → 200": every API call shows its exact endpoint.
  function endpointLine(evt) {
    if (!evt.endpoint) return '';
    const m = String(evt.endpoint).match(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(.*)$/);
    const http = evt.http ? ` <span class="ep-s${evt.http >= 400 ? ' bad' : ''}">→ ${esc(evt.http)}</span>` : '';
    return m
      ? `<div class="ep"><span class="ep-m">${esc(m[1])}</span> ${esc(m[2])}${http}</div>`
      : `<div class="ep">${esc(evt.endpoint)}${http}</div>`;
  }

  function row(evt, instant) {
    const src = SOURCES[evt.source] || [evt.source || '?', '--muted'];
    const s = story(evt.t);
    const r = el('div', 'evt' + (instant ? ' instant' : '') + (evt.missing ? ' missing' : '') + (evt.type === 'checklist_tick' ? ` tick ${evt.status || ''}` : ''));
    const body = el('div', 'body');
    const flags = [
      `<span class="label" data-l="${esc(evt.label)}">${esc(evt.label)}</span>`,
      evt.recorded_at ? `<span class="rec">${esc(recorded(evt.recorded_at))}</span>` : '',
      evt.fixture ? '<span class="flag">FIXTURE</span>' : ''
    ].join('');
    body.innerHTML = `<div class="head"><span class="title">${esc(evt.title)}</span>${flags}</div>${endpointLine(evt)}${evt.body ? `<div class="sub">${esc(evt.body)}</div>` : ''}`;
    r.innerHTML = `<span class="t">${s ? esc(`${s.wd} ${s.hms}`) : ''}</span><span><span class="chip" style="--c: var(${src[1]})">${esc(src[0])}</span></span>`;
    r.appendChild(body);
    return { r, body };
  }

  // Types at TYPE_CPS by elapsed (pause-aware) time, so timer granularity never slows it down.
  async function typeText(node, text, gen, instant) {
    if (instant) { node.textContent = text; return; }
    const caret = el('span', 'caret');
    node.textContent = '';
    node.after(caret);
    let elapsed = 0;
    let shown = 0;
    while (shown < text.length) {
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 40));
      if (gen !== ui.gen) return;
      if (!ui.paused) elapsed += performance.now() - t0;
      const next = Math.min(text.length, Math.floor((elapsed * TYPE_CPS) / 1000));
      if (next !== shown) { shown = next; node.textContent = text.slice(0, shown); stick(); }
    }
    caret.remove();
  }

  function countdown(container, evt, instant) {
    const from = Number(evt.display_from) || 600;
    const secs = Number(evt.seconds) || 10;
    const box = el('div', 'countdown', `<span class="big"></span><span class="note">${esc(evt.note || 'HOLD window · compressed for demo')}</span>`);
    container.appendChild(box);
    const big = $('.big', box);
    const fmt = (v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
    if (instant) { big.textContent = fmt(0); box.classList.add('over'); return; }
    const gen = ui.gen;
    let left = secs * 1000;
    big.textContent = fmt(from);
    const end = () => { clearInterval(timer); big.textContent = fmt(0); box.classList.add('over'); ui.countdown = null; };
    const timer = setInterval(() => {
      if (gen !== ui.gen) { clearInterval(timer); return; }
      if (!ui.paused) left -= 100;
      big.textContent = fmt(Math.max(0, Math.ceil((from * left) / (secs * 1000))));
      if (left <= 0) end();
    }, 100);
    ui.countdown = { step: evt.step, end };
  }

  async function renderEvent(evt, instant) {
    const gen = ui.gen;
    // The window is over once its step moves on; never show a running timer next to the outcome.
    if (ui.countdown && evt.type !== 'countdown' && (!evt.step || evt.step === ui.countdown.step)) ui.countdown.end();
    divider(evt);
    if (evt.t) setClock(evt.t);
    if (evt.type === 'checklist_tick' && evt.step) setStep(evt.step, evt.status || 'done');

    const { r, body } = row(evt, instant);
    const json = evt.json;

    switch (evt.type) {
      case 'stream': {
        const model = evt.model || (json && json.model);
        if (model) $('.title', body).textContent = `Reasoning · Hugging Face · ${model}`;
        const text = evt.stream || (Array.isArray(json && json.reasoning) ? json.reasoning.join('\n\n') : '');
        const box = el('div', 'stream');
        const span = el('span');
        box.appendChild(span);
        body.appendChild(box);
        append(r);
        await typeText(span, text, gen, instant);
        if (json) body.appendChild(jsonBlock(json, 'raw model output'));
        break;
      }
      case 'plan': {
        const steps = Array.isArray(json) ? json : (json && json.plan) || [];
        buildPlan(steps, evt.decision || (json && json.decision));
        if (json) body.appendChild(jsonBlock(json, 'plan JSON'));
        append(r);
        break;
      }
      case 'countdown':
        countdown(body, evt, instant);
        append(r);
        break;
      case 'transcript': {
        const box = el('div', 'lines');
        body.appendChild(box);
        append(r);
        for (const line of evt.lines || []) {
          const clinic = /clinic|reception/i.test(line.speaker || '');
          box.appendChild(el('div', 'line' + (clinic ? ' clinic' : ''), `<span class="who">${esc(line.speaker)}</span><span>${esc(line.text)}</span>`));
          stick();
          if (!instant && !(await wait(700, gen))) return;
        }
        if (evt.src) { const a = el('audio'); a.controls = true; a.src = media(evt.src); body.appendChild(a); }
        break;
      }
      case 'audio': {
        const a = el('audio');
        a.controls = true;
        a.preload = 'auto';
        a.src = media(evt.src);
        body.appendChild(a);
        append(r);
        break;
      }
      case 'ocr_card': {
        const model = evt.model || (json && (json.model || json.model_id));
        $('.title', body).textContent = `Sample run · Hugging Face${model ? ` · ${model}` : ''}`;
        if (!evt.body) body.appendChild(el('div', 'sub', 'Pipeline proof · one real prescription, read by the model'));
        const box = el('div', 'ocr', `${evt.src ? `<img src="${esc(media(evt.src))}" alt="Sample prescription">` : '<span></span>'}<pre class="json">${json ? highlight(json) : ''}</pre>`);
        body.appendChild(box);
        append(r);
        break;
      }
      case 'fhir': {
        // FHIR bundle card: one line per resource, revealed in turn, then the full Bundle JSON.
        const list = el('div', 'res');
        body.appendChild(list);
        append(r);
        for (const res of evt.resources || []) {
          list.appendChild(el('div', 'res-row', `<span class="res-t">${esc(res.type)}</span><span>${esc(res.text)}</span>`));
          stick();
          if (!instant && !(await wait(RES_MS, gen))) return;
        }
        if (json) body.appendChild(jsonBlock(json, 'FHIR Bundle JSON'));
        break;
      }
      case 'pay_page':
        append(r);
        if (!instant) payWindow(evt.src);
        break;
      default:
        if (evt.link) {
          const a = el('a', 'link', 'Open Pine Labs checkout ↗');
          a.href = evt.link;
          a.target = '_blank';
          a.rel = 'noopener';
          body.appendChild(a);
        }
        if (json) body.appendChild(jsonBlock(json, evt.type === 'request' ? 'request' : evt.type === 'response' ? 'response' : 'details'));
        append(r);
    }
    if (evt.pay_close && !instant) setTimeout(() => payWindow(null), 1600);
    scheduleState();
  }

  // The simulated payment window sits over the console while the payment step waits for it.
  function payWindow(src) {
    const box = $('#payWindow');
    if (src) { $('#payFrame').src = src; box.classList.add('on'); }
    else { box.classList.remove('on'); $('#payFrame').src = 'about:blank'; }
  }

  function enqueue(evt, instant) {
    ui.queue.push({ evt, instant });
    pump();
  }
  // Phase changes ride the same queue, so the header and checklist change when the feed gets there.
  function enqueuePhase(p) {
    ui.queue.push({ phase: p });
    pump();
  }
  async function applyPhase(p) {
    if (!ui.paused) setRun('running');
    setPhase(p.phase, p.step ? `Acting · ${(STEP_TEXT[p.step] ? STEP_TEXT[p.step]({})[0] : p.step)}` : p.title);
    if (p.step) setStep(p.step, 'active');
    scheduleState();
    if (p.timecard) await timeCard(p.timecard, ui.gen);
  }
  async function pump() {
    if (ui.busy) return;
    ui.busy = true;
    const gen = ui.gen;
    while (ui.queue.length && gen === ui.gen) {
      const item = ui.queue.shift();
      try {
        if (item.phase) await applyPhase(item.phase);
        else await renderEvent(item.evt, item.instant);
      } catch (e) { console.error('render failed', e, item); }
    }
    if (gen === ui.gen) ui.busy = false;  // after a reset, the newer loop owns `busy`
  }

  function clearAll() {
    ui.gen++;
    ui.queue = [];
    ui.busy = false;
    ui.feedPhase = null;
    ui.lastJson = null;
    ui.countdown = null;
    follow = true;
    feed.innerHTML = '';
    $('#plan').innerHTML = '';
    $('#planHint').textContent = "The agent's plan appears here once it has reasoned.";
    $('#clock').textContent = '—';
    setPhase('idle');
    show('#endCard', false);
    show('#timeCard', false);
    payWindow(null);
  }

  /* ---------------- Stream ---------------- */
  function connect() {
    const es = new EventSource('/events');
    es.addEventListener('hello', (m) => {
      const s = JSON.parse(m.data);
      clearAll();
      ui.mode = s.mode;
      ui.paused = s.paused;
      $('#mode').textContent = s.mode.toUpperCase();
      $('#phases li[data-phase="preroll"]').hidden = !s.preroll;
      for (const evt of s.history) enqueue(evt, true);
      if (s.phase !== 'idle') setPhase(s.phase);
      setRun(s.paused ? 'paused' : s.running ? 'running' : s.phase === 'idle' ? 'idle' : s.outcome && s.outcome.ok ? 'done' : 'stopped');
      show('#titleCard', s.phase === 'idle' && !s.history.length);
      refreshState();
    });
    es.addEventListener('phase', (m) => {
      show('#titleCard', false);
      enqueuePhase(JSON.parse(m.data));
    });
    es.addEventListener('evt', (m) => {
      show('#titleCard', false);
      enqueue(JSON.parse(m.data), false);
    });
    es.addEventListener('control', (m) => {
      const c = JSON.parse(m.data);
      if (c.action === 'reset') { clearAll(); setRun('idle'); show('#titleCard', true); refreshState(); }
      if (c.action === 'pause') { ui.paused = true; setRun('paused'); }
      if (c.action === 'resume') { ui.paused = false; setRun('running'); }
      if (c.action === 'finished') finished();
    });
    es.onerror = () => setRun(ui.phase === 'idle' ? 'idle' : 'stopped');
  }

  /* ---------------- Keys ---------------- */
  const post = (path) => fetch(path, { method: 'POST' }).catch(() => {});
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.key === ' ') { e.preventDefault(); post('/next'); }
    else if (k === 'r') post('/reset');
    else if (k === 'p') post('/pause');
    else if (k === 'j') toggleJson(ui.lastJson);
    else if (k === 'h') $('#keys').classList.toggle('hidden');
  });
  $('#endCard').addEventListener('click', () => show('#endCard', false));

  connect();
})();
