// Clinic portal API (/api/clinic/*): a clinic logs in, finds a patient by ABHA number, and adds a
// prescription by photo (+ medicines it confirms) or by typing. Each prescription becomes a real
// FHIR bundle; the orchestrator shows it in the agent console with a mock ABHA link.
//
//   POST /api/clinic/login         { email, password } → session cookie
//   POST /api/clinic/logout
//   GET  /api/clinic/me
//   POST /api/clinic/patient       { abha } → the patient (lookup is SIMULATED: Sanjeevani's own family
//                                  records, matched on the visible digits of the masked ABHA number)
//   POST /api/clinic/prescription  { abha, mode: "photo"|"typed", medicines, notes?, date?, photo? }
//   GET  /api/clinic/records       this clinic's prescriptions (this server run)
//   GET  /api/clinic/photo/:id     a photo this clinic uploaded
//
// Demo accounts live in data/clinics.json as salted scrypt hashes. Sessions are in memory, in an
// HttpOnly SameSite=Strict cookie; POSTs must be JSON. Five wrong passwords lock that address out
// for five minutes. Photos are kept in memory only (never written to disk).
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrescriptionBundle, checkBundle, summary, FREQUENCIES } from './integrations/fhir.js';

const COOKIE = 'snj_clinic';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOCKOUT = { tries: 5, ms: 5 * 60 * 1000 };
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;
export const PRESCRIPTION_BODY_MAX = 9 * 1024 * 1024;   // base64 photo + fields
const MAX_PHOTOS = 50;
const IMAGE_MAGIC = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP'
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const istNow = () => `${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 19)}+05:30`;
const istToday = () => istNow().slice(0, 10);

export function createClinic({ root, getState, readBody, sendJson, onPrescription, log }) {
  const accounts = JSON.parse(readFileSync(join(root, 'data', 'clinics.json'), 'utf8')).clinics;
  const dummy = { salt: randomBytes(16).toString('hex'), hash: randomBytes(64).toString('hex') };
  const sessions = new Map();      // token → { clinicId, expires }
  const failures = new Map();      // ip → { count, until }
  const photos = new Map();        // id → { clinicId, contentType, buf }
  const records = [];

  const publicClinic = (c) => ({ id: c.id, name: c.name, doctor: c.doctor, specialty: c.specialty, city: c.city, email: c.email });

  /* ---------- auth ---------- */
  function cookieToken(req) {
    const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
    return m ? m[1] : null;
  }
  function sessionClinic(req) {
    const token = cookieToken(req);
    const s = token && sessions.get(token);
    if (!s) return null;
    if (s.expires < Date.now()) { sessions.delete(token); return null; }
    return accounts.find((c) => c.id === s.clinicId) || null;
  }
  function requireClinic(req) {
    const c = sessionClinic(req);
    if (!c) throw new HttpError(401, 'Please log in again');
    return c;
  }
  function passwordMatches(account, password) {
    const a = account || dummy;   // same work for unknown emails, so timing does not reveal accounts
    const got = scryptSync(String(password), a.salt, 64);
    const ok = timingSafeEqual(got, Buffer.from(a.hash, 'hex'));
    return Boolean(account) && ok;
  }
  function setCookie(res, value, maxAgeS) {
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeS}`);
  }

  async function jsonBody(req, limit) {
    if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Send JSON');
    let raw;
    try { raw = await readBody(req, limit); } catch { throw new HttpError(413, 'That upload is too large (photos up to 6 MB)'); }
    try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'Bad JSON'); }
  }

  /* ---------- patients ---------- */
  function parseAbha(input) {
    const s = String(input || '').trim();
    const digits = s.replace(/[\s-]/g, '');
    if (/^\d{14}$/.test(digits)) return { kind: 'number', digits };
    if (/^[a-z0-9][a-z0-9._]{2,31}@(abdm|sbx)$/i.test(s)) return { kind: 'address', value: s.toLowerCase() };
    return null;
  }
  // Sanjeevani holds ABHA numbers masked ("91-••••-••••-4821"); match on the digits it can see.
  function findPatient(abhaInput) {
    const parsed = parseAbha(abhaInput);
    if (!parsed) throw new HttpError(400, 'Enter a 14-digit ABHA number (e.g. 91-1234-5678-4821)');
    if (parsed.kind === 'address') throw new HttpError(404, 'ABHA addresses are not supported in this demo; use the 14-digit ABHA number');
    const state = getState();
    const member = state.members.find((m) => {
      if (!m.abha) return false;
      const visible = m.abha.replace(/\D/g, '');
      return parsed.digits.startsWith(visible.slice(0, 2)) && parsed.digits.endsWith(visible.slice(-4));
    });
    if (!member) throw new HttpError(404, 'No Sanjeevani family is linked to this ABHA number');
    return { member, state };
  }
  const publicPatient = (m, state) => ({
    abha: m.abha, name: m.full, age: m.age, sex: m.sex === 'F' ? 'Female' : m.sex === 'M' ? 'Male' : '—', city: m.city,
    family: state.caregiver.family, caregiver: state.caregiver.name,
    current_medicines: m.medicines.map((md) => `${md.name} · ${md.freq}`)
  });

  /* ---------- prescriptions ---------- */
  function parsePhoto(dataUrl) {
    const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new HttpError(400, 'Photo must be a JPEG, PNG or WebP image');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > PHOTO_MAX_BYTES) throw new HttpError(413, 'Photo is larger than 6 MB');
    if (!IMAGE_MAGIC[m[1]](buf)) throw new HttpError(400, 'That file is not a valid image');
    return { contentType: m[1], buf };
  }
  function parseMedicines(list) {
    if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, 'Add at least one medicine');
    if (list.length > 10) throw new HttpError(400, 'At most 10 medicines per prescription');
    return list.map((x, i) => {
      const name = String((x && x.name) || '').trim().replace(/\s+/g, ' ');
      const freq = String((x && x.freq) || '').trim();
      const duration = String((x && x.duration) || '').trim();
      if (name.length < 2 || name.length > 80) throw new HttpError(400, `Medicine ${i + 1}: enter the name and strength (e.g. Amlodipine 5mg)`);
      if (!(freq in FREQUENCIES)) throw new HttpError(400, `Medicine ${i + 1}: choose how often`);
      if (duration.length > 40) throw new HttpError(400, `Medicine ${i + 1}: duration is too long`);
      return { name, freq, ...(duration ? { duration } : {}) };
    });
  }

  async function addPrescription(req, clinic) {
    const body = await jsonBody(req, PRESCRIPTION_BODY_MAX);
    const { member, state } = findPatient(body.abha);
    const mode = body.mode === 'photo' ? 'photo' : 'typed';
    const medicines = parseMedicines(body.medicines);
    const notes = String(body.notes || '').trim().slice(0, 500) || null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : istToday();
    if (date > istToday()) throw new HttpError(400, 'The prescription date cannot be in the future');
    let photo = null;
    if (mode === 'photo') {
      if (!body.photo) throw new HttpError(400, 'Upload the prescription photo');
      photo = parsePhoto(body.photo);
    }

    const photoMeta = photo && { contentType: photo.contentType, size: photo.buf.length, sha1: createHash('sha1').update(photo.buf).digest('base64'), title: 'Prescription photo' };
    const bundle = buildPrescriptionBundle({
      patient: { full: member.full, name: member.name, sex: member.sex, abha: member.abha, city: member.city, pincode: member.pincode, lang: member.lang },
      practitioner: { name: clinic.doctor, specialty: clinic.specialty },
      organization: { name: clinic.name, city: clinic.city },
      authored: date, timestamp: istNow(), medicines, notes, photo: photoMeta
    });
    const check = checkBundle(bundle);
    if (!check.ok) throw new HttpError(500, `FHIR bundle failed checks: ${check.errors.join('; ')}`);

    let photoId = null;
    if (photo) {
      photoId = randomBytes(8).toString('hex');
      photos.set(photoId, { clinicId: clinic.id, contentType: photo.contentType, buf: photo.buf });
      while (photos.size > MAX_PHOTOS) photos.delete(photos.keys().next().value);
    }

    const current = new Set(member.medicines.map((md) => normName(md.name)));
    const newMedicines = medicines.filter((md) => !current.has(normName(md.name))).map((md) => md.name);
    const known = medicines.filter((md) => current.has(normName(md.name))).map((md) => md.name);
    const record = {
      id: `RX-${randomBytes(3).toString('hex').toUpperCase()}`, created: istNow(), date, mode,
      clinic: clinic.name, doctor: clinic.doctor, patient: member.full, member: member.id, abha: member.abha,
      medicines, notes, photo_id: photoId, bundle_id: bundle.id, resources: check.resources
    };
    records.unshift({ clinicId: clinic.id, ...record });
    log(`  ← clinic ${clinic.name}: prescription ${record.id} for ${member.name} (${mode}, ${medicines.length} medicine${medicines.length === 1 ? '' : 's'})`);
    onPrescription({ clinic: publicClinic(clinic), member, record, bundle, check, newMedicines, known });

    return {
      ok: true, record,
      bundle: { id: bundle.id, resources: summary(bundle), references: check.references, json: bundle },
      abha: 'linked (simulated)', new_medicines: newMedicines, known_medicines: known
    };
  }

  /* ---------- routing ---------- */
  async function route(req, res, p, ip) {
    if (req.method === 'POST' && p === '/api/clinic/login') {
      const f = failures.get(ip);
      if (f && f.until > Date.now()) throw new HttpError(429, 'Too many wrong passwords. Try again in a few minutes.');
      const body = await jsonBody(req, 4096);
      const email = String(body.email || '').trim().toLowerCase();
      const account = accounts.find((c) => c.email === email);
      if (!passwordMatches(account, body.password || '')) {
        const n = (f && f.until === 0 ? f.count : 0) + 1;   // a lockout that has expired starts the count again
        failures.set(ip, { count: n, until: n >= LOCKOUT.tries ? Date.now() + LOCKOUT.ms : 0 });
        throw new HttpError(401, 'Email or password is wrong');
      }
      failures.delete(ip);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { clinicId: account.id, expires: Date.now() + SESSION_TTL_MS });
      setCookie(res, token, SESSION_TTL_MS / 1000);
      log(`  ← clinic login: ${account.name}`);
      return { clinic: publicClinic(account) };
    }
    if (req.method === 'POST' && p === '/api/clinic/logout') {
      const token = cookieToken(req);
      if (token) sessions.delete(token);
      setCookie(res, '', 0);
      return { ok: true };
    }
    if (req.method === 'GET' && p === '/api/clinic/me') return { clinic: publicClinic(requireClinic(req)) };
    if (req.method === 'POST' && p === '/api/clinic/patient') {
      requireClinic(req);
      const body = await jsonBody(req, 4096);
      const { member, state } = findPatient(body.abha);
      return { patient: publicPatient(member, state), lookup: 'simulated' };
    }
    if (req.method === 'POST' && p === '/api/clinic/prescription') return addPrescription(req, requireClinic(req));
    if (req.method === 'GET' && p === '/api/clinic/records') {
      const c = requireClinic(req);
      return { records: records.filter((r) => r.clinicId === c.id).map(({ clinicId, ...r }) => r) };
    }
    const photo = p.match(/^\/api\/clinic\/photo\/([a-f0-9]{16})$/);
    if (req.method === 'GET' && photo) {
      const c = requireClinic(req);
      const ph = photos.get(photo[1]);
      if (!ph || ph.clinicId !== c.id) throw new HttpError(404, 'Photo not found');
      res.writeHead(200, { 'Content-Type': ph.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(ph.buf);
      return undefined;   // already sent
    }
    throw new HttpError(404, 'Not found');
  }

  return {
    async handle(req, res, p) {
      const ip = req.socket.remoteAddress || '?';
      try {
        const out = await route(req, res, p, ip);
        if (out !== undefined) sendJson(res, 200, out);
      } catch (e) {
        if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
        log(`  ! clinic API failed: ${e.stack || e.message}`);
        sendJson(res, 500, { error: 'Something went wrong' });
      }
    }
  };
}
