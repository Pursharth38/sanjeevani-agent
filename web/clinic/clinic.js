/* Clinic portal: sign in → patient's ABHA → prescription (photo + confirmed medicines, or typed) → saved. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const FREQS = ['once daily', 'twice daily', 'three times daily', 'four times daily', 'as needed'];
  const MAX_SIDE = 1800;          // photos are downsized in the browser before upload
  const JPEG_QUALITY = 0.85;
  const VIEWS = ['#viewLogin', '#viewPatient', '#viewRx', '#viewDone'];

  const ui = { clinic: null, patient: null, abha: '', mode: 'photo', photo: null };

  /* ---------------- helpers ---------------- */
  function show(id) {
    VIEWS.forEach((v) => { $(v).hidden = v !== id; });
    window.scrollTo(0, 0);
  }
  async function api(path, body) {
    const res = await fetch(path, body === undefined
      ? { credentials: 'same-origin', cache: 'no-store' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch (_) { /* empty body */ }
    if (res.status === 401 && path !== '/api/clinic/login') { signedOut(); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const busy = (btn, on, text) => { btn.disabled = on; if (text) btn.textContent = text; };
  const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  /* ---------------- session ---------------- */
  function signedIn(clinic) {
    ui.clinic = clinic;
    $('#who').hidden = false;
    $('#whoName').textContent = `${clinic.name} · ${clinic.doctor}`;
    toPatient();
  }
  function signedOut() {
    ui.clinic = null;
    ui.patient = null;
    $('#who').hidden = true;
    $('#password').value = '';
    show('#viewLogin');
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    $('#loginError').textContent = '';
    if (!$('#email').value.trim() || !$('#password').value) { $('#loginError').textContent = 'Enter your email and password.'; return; }
    busy(btn, true, 'Signing in…');
    try {
      const { clinic } = await api('/api/clinic/login', { email: $('#email').value, password: $('#password').value });
      signedIn(clinic);
    } catch (err) {
      $('#loginError').textContent = err.message;
    } finally {
      busy(btn, false, 'Sign in');
    }
  });
  $('#logout').addEventListener('click', async () => {
    try { await api('/api/clinic/logout', {}); } catch (_) { /* already signed out */ }
    signedOut();
  });

  /* ---------------- patient ---------------- */
  // Formats as the clinic types: 91-1234-5678-4821
  $('#abha').addEventListener('input', (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 14);
    e.target.value = [d.slice(0, 2), d.slice(2, 6), d.slice(6, 10), d.slice(10, 14)].filter(Boolean).join('-');
  });
  function toPatient() {
    show('#viewPatient');
    $('#patientCard').hidden = !ui.patient;
    loadHistory();
    if (!ui.patient) $('#abha').focus();
  }
  $('#abhaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#abhaBtn');
    $('#abhaError').textContent = '';
    $('#patientCard').hidden = true;
    ui.patient = null;
    busy(btn, true, 'Finding…');
    try {
      const { patient } = await api('/api/clinic/patient', { abha: $('#abha').value });
      ui.patient = patient;
      ui.abha = $('#abha').value;
      renderPatient(patient);
    } catch (err) {
      $('#abhaError').textContent = err.message;
    } finally {
      busy(btn, false, 'Find patient');
    }
  });
  function renderPatient(p) {
    $('#pInitial').textContent = initials(p.name);
    $('#pName').textContent = p.name;
    $('#pMeta').textContent = `${p.age} · ${p.sex} · ${p.city}`;
    $('#pFamily').textContent = `${p.family} · caregiver ${p.caregiver}`;
    $('#pAbha').textContent = `ABHA ${p.abha}`;
    $('#pMeds').innerHTML = '';
    p.current_medicines.forEach((m) => { const li = document.createElement('li'); li.textContent = m; $('#pMeds').appendChild(li); });
    $('#patientCard').hidden = false;
  }
  $('#otherPatient').addEventListener('click', () => {
    ui.patient = null;
    $('#abha').value = '';
    $('#patientCard').hidden = true;
    $('#abha').focus();
  });
  async function loadHistory() {
    try {
      const { records } = await api('/api/clinic/records');
      $('#historyCard').hidden = !records.length;
      $('#history').innerHTML = '';
      records.slice(0, 8).forEach((r) => {
        const li = document.createElement('li');
        const a = document.createElement('span');
        a.textContent = `${r.id} · ${r.patient} · ${r.medicines.map((m) => m.name).join(', ')}`;
        const b = document.createElement('span');
        b.textContent = `${r.mode === 'photo' ? 'Photo' : 'Typed'} · ${r.date}`;
        li.append(a, b);
        $('#history').appendChild(li);
      });
    } catch (_) { $('#historyCard').hidden = true; }
  }

  /* ---------------- prescription ---------------- */
  $('#toRx').addEventListener('click', () => {
    if (!ui.patient) return;
    $('#rxFor').textContent = ui.patient.name;
    $('#rxAbha').textContent = `ABHA ${ui.patient.abha}`;
    $('#rxDate').value = todayIst();
    $('#rxDate').max = todayIst();
    $('#notes').value = '';
    $('#rxError').textContent = '';
    $('#medRows').innerHTML = '';
    addMedRow();
    clearPhoto();
    setMode('photo');
    show('#viewRx');
  });
  $('#backToPatient').addEventListener('click', toPatient);

  function setMode(mode) {
    ui.mode = mode;
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.mode === mode;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', String(on));
    });
    $('#photoPane').hidden = mode !== 'photo';
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

  function addMedRow() {
    if ($('#medRows').children.length >= 10) return;
    const row = document.createElement('div');
    row.className = 'med-row';
    row.innerHTML = `<input class="name" maxlength="80" placeholder="e.g. Amlodipine 5mg" aria-label="Medicine and strength">
      <select aria-label="How often"><option value="">How often…</option>${FREQS.map((f) => `<option>${f}</option>`).join('')}</select>
      <input class="dur" maxlength="40" placeholder="e.g. 30 days" aria-label="For how long">
      <button type="button" class="rm" aria-label="Remove medicine">×</button>`;
    row.querySelector('.rm').addEventListener('click', () => { if ($('#medRows').children.length > 1) row.remove(); });
    $('#medRows').appendChild(row);
    row.querySelector('.name').focus();
  }
  $('#addMed').addEventListener('click', addMedRow);

  /* photo: downsized to JPEG in the browser */
  function clearPhoto() {
    ui.photo = null;
    $('#file').value = '';
    $('#preview').hidden = true;
    $('#preview').removeAttribute('src');
    $('#dropText').hidden = false;
  }
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { reject(new Error('Choose a JPEG, PNG or WebP photo')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as an image')); };
      img.src = url;
    });
  }
  async function takeFile(file) {
    if (!file) return;
    $('#rxError').textContent = '';
    try {
      ui.photo = await readImage(file);
      $('#preview').src = ui.photo;
      $('#preview').hidden = false;
      $('#dropText').hidden = true;
    } catch (err) {
      clearPhoto();
      $('#rxError').textContent = err.message;
    }
  }
  $('#file').addEventListener('change', (e) => takeFile(e.target.files[0]));
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => takeFile(e.dataTransfer.files[0]));

  function collectMedicines() {
    const meds = [];
    const rows = [...$('#medRows').children];
    for (let i = 0; i < rows.length; i++) {
      const name = rows[i].querySelector('.name').value.trim();
      const freq = rows[i].querySelector('select').value;
      const duration = rows[i].querySelector('.dur').value.trim();
      if (!name && !freq && !duration) continue;   // empty extra row
      if (name.length < 2) throw new Error(`Medicine ${i + 1}: enter the name and strength`);
      if (!freq) throw new Error(`Medicine ${i + 1}: choose how often`);
      meds.push({ name, freq, duration });
    }
    if (!meds.length) throw new Error('Add at least one medicine');
    return meds;
  }

  $('#saveRx').addEventListener('click', async () => {
    const btn = $('#saveRx');
    $('#rxError').textContent = '';
    let medicines;
    try {
      if (ui.mode === 'photo' && !ui.photo) throw new Error('Upload the prescription photo, or switch to "Type it"');
      medicines = collectMedicines();
    } catch (err) { $('#rxError').textContent = err.message; return; }
    busy(btn, true, 'Saving…');
    try {
      const out = await api('/api/clinic/prescription', {
        abha: ui.abha, mode: ui.mode, medicines, notes: $('#notes').value, date: $('#rxDate').value,
        ...(ui.mode === 'photo' ? { photo: ui.photo } : {})
      });
      renderDone(out);
    } catch (err) {
      $('#rxError').textContent = err.message;
    } finally {
      busy(btn, false, 'Save to record');
    }
  });

  /* ---------------- saved ---------------- */
  function renderDone(out) {
    const r = out.record;
    $('#doneTitle').textContent = `Saved to ${r.patient}'s record`;
    $('#doneMeta').textContent = `${r.id} · ${r.medicines.length} medicine${r.medicines.length === 1 ? '' : 's'} · ${r.mode === 'photo' ? 'photo + typed' : 'typed'} · ${r.date}`;
    $('#doneRes').innerHTML = '';
    out.bundle.resources.forEach((x) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = x.type;
      const s = document.createElement('span');
      s.textContent = x.text;
      li.append(b, s);
      $('#doneRes').appendChild(li);
    });
    $('#doneJson').textContent = JSON.stringify(out.bundle.json, null, 2);
    const nm = out.new_medicines || [];
    $('#newMeds').hidden = !nm.length;
    if (nm.length) {
      $('#newMeds').textContent = `${nm.join(', ')} ${nm.length === 1 ? 'is' : 'are'} new for ${ui.patient.name}. Sanjeevani will ask the family before adding ${nm.length === 1 ? 'it' : 'them'} to refills; nothing is ordered until then.`;
    }
    if (r.photo_id) { $('#donePhoto').src = `/api/clinic/photo/${r.photo_id}`; $('#donePhoto').hidden = false; }
    else { $('#donePhoto').hidden = true; $('#donePhoto').removeAttribute('src'); }
    show('#viewDone');
  }
  $('#another').addEventListener('click', () => $('#toRx').click());
  $('#newPatient').addEventListener('click', () => { ui.patient = null; $('#abha').value = ''; toPatient(); });

  /* ---------------- boot ---------------- */
  api('/api/clinic/me').then(({ clinic }) => signedIn(clinic)).catch(() => signedOut());
})();
