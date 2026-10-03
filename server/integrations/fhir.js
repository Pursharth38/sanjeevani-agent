// FHIR R4 prescription bundles + ABHA push (mock), for the records pre-roll and the clinic portal.
//
//   node server/integrations/fhir.js --live     build Maa's bundle, print it, write cache/fhir.json
//   node server/integrations/fhir.js --replay   same (nothing here touches the network)
//
// 1. Bundle, real: built in code as an R4 document Bundle shaped like an ABDM Prescription record
//    (NRCeS profiles): Composition + Patient + Practitioner (+ clinic Organization) + one
//    MedicationRequest per medicine (+ a DocumentReference for a prescription photo). Ids are
//    derived from the content, so the same input always gives the same bundle. Checked by our own
//    structural checks (required fields, every reference resolves), not an official FHIR validator.
// 2. ABHA push, SIMULATED: no ABDM call is made. The console names the call it stands in for
//    (HIP-initiated care-context linking, POST /v0.5/links/link/add-contexts on the ABDM gateway).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, writeCache } from '../cache.js';

const PUSH_MS = 1200;
export const CARD_MS_PER_RESOURCE = 300;   // the console reveals one resource line this often
const PROFILE = 'https://nrces.in/ndhm/fhir/r4/StructureDefinition';
const ABHA_SYSTEM = 'https://healthid.ndhm.gov.in';
const SNOMED = 'http://snomed.info/sct';
const PRESCRIPTION_RECORD = { system: SNOMED, code: '440545006', display: 'Prescription record' };
const ABDM_LINK = 'POST /v0.5/links/link/add-contexts';

// Content-derived UUID (v5-style layout) so the bundle is stable across runs.
function uuidFor(...parts) {
  const h = createHash('sha256').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const urn = (id) => `urn:uuid:${id}`;
const escXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const isoDate = (d) => { const [day, mon, year] = String(d).split(' '); return `${year}-${MONTHS[mon]}-${day.padStart(2, '0')}`; };

export const FREQUENCIES = { 'once daily': 1, 'twice daily': 2, 'three times daily': 3, 'four times daily': 4, 'as needed': null };

function supplyDuration(text) {
  const m = String(text || '').match(/^\s*(\d{1,3})\s*(day|days|week|weeks|month|months)\s*$/i);
  if (!m) return null;
  const unit = m[2].toLowerCase().replace(/s$/, '');
  return { value: Number(m[1]), unit: `${unit}s`, system: 'http://unitsofmeasure.org', code: { day: 'd', week: 'wk', month: 'mo' }[unit] };
}

/* ---------------- Build ---------------- */
// input = {
//   patient: { full, name, sex: 'F'|'M', abha, city, pincode, lang },
//   practitioner: { name, specialty },
//   organization: { name, city } | null,           // the clinic, when a clinic submits
//   authored: 'YYYY-MM-DD', timestamp: ISO string,
//   medicines: [{ name, freq, duration?, pharmacy? }],
//   notes: string | null,
//   photo: { contentType, size, sha1, title } | null
// }
export function buildPrescriptionBundle(input) {
  const { patient: p, practitioner: dr, organization: org, authored, timestamp, medicines, notes, photo } = input;
  const patientId = uuidFor('Patient', p.full, p.abha);
  const practitionerId = uuidFor('Practitioner', dr.name, dr.specialty);
  const orgId = org ? uuidFor('Organization', org.name, org.city || '') : null;

  const patient = {
    resourceType: 'Patient', id: patientId, meta: { profile: [`${PROFILE}/Patient`] },
    identifier: [{ system: ABHA_SYSTEM, value: p.abha }],
    name: [{ text: p.full }], gender: p.sex === 'F' ? 'female' : p.sex === 'M' ? 'male' : 'unknown',
    address: [{ city: p.city, postalCode: p.pincode, country: 'IN' }],
    ...(p.lang ? { communication: [{ language: { text: p.lang } }] } : {})
  };
  const practitioner = {
    resourceType: 'Practitioner', id: practitionerId, meta: { profile: [`${PROFILE}/Practitioner`] },
    name: [{ text: dr.name }], qualification: [{ code: { text: dr.specialty } }]
  };
  const organization = org && {
    resourceType: 'Organization', id: orgId, meta: { profile: [`${PROFILE}/Organization`] },
    name: org.name, ...(org.city ? { address: [{ text: org.city, country: 'IN' }] } : {})
  };
  const meds = medicines.map((md) => {
    const id = uuidFor('MedicationRequest', patientId, md.name, md.freq, md.duration || '', authored);
    const perDay = FREQUENCIES[md.freq];
    const supply = supplyDuration(md.duration);
    return {
      resourceType: 'MedicationRequest', id, meta: { profile: [`${PROFILE}/MedicationRequest`] },
      status: 'active', intent: 'order',
      medicationCodeableConcept: { text: md.name },
      subject: { reference: urn(patientId), display: p.name || p.full },
      authoredOn: authored,
      requester: { reference: urn(practitionerId), display: dr.name },
      dosageInstruction: [{
        text: [md.freq, md.duration].filter(Boolean).join(' · '),
        ...(perDay ? { timing: { repeat: { frequency: perDay, period: 1, periodUnit: 'd' } } } : {}),
        ...(md.freq === 'as needed' ? { asNeededBoolean: true } : {})
      }],
      ...(md.pharmacy || supply ? { dispenseRequest: { ...(md.pharmacy ? { performer: { display: md.pharmacy } } : {}), ...(supply ? { expectedSupplyDuration: supply } : {}) } } : {})
    };
  });
  const photoDoc = photo && {
    resourceType: 'DocumentReference', id: uuidFor('DocumentReference', patientId, photo.sha1), meta: { profile: [`${PROFILE}/DocumentReference`] },
    status: 'current', type: { text: 'Prescription photo' },
    subject: { reference: urn(patientId), display: p.name || p.full }, date: timestamp,
    author: [{ reference: urn(practitionerId), display: dr.name }],
    content: [{ attachment: { contentType: photo.contentType, size: photo.size, hash: photo.sha1, title: photo.title } }]
  };

  const entries = [...meds.map((m) => ({ reference: urn(m.id), type: 'MedicationRequest' })), ...(photoDoc ? [{ reference: urn(photoDoc.id), type: 'DocumentReference' }] : [])];
  const compositionId = uuidFor('Composition', patientId, authored, ...entries.map((e) => e.reference));
  const composition = {
    resourceType: 'Composition', id: compositionId, meta: { profile: [`${PROFILE}/PrescriptionRecord`] },
    status: 'final', type: { coding: [PRESCRIPTION_RECORD], text: 'Prescription record' },
    subject: { reference: urn(patientId), display: p.name || p.full }, date: timestamp,
    author: [{ reference: urn(practitionerId), display: dr.name }],
    ...(organization ? { custodian: { reference: urn(orgId), display: org.name } } : {}),
    title: 'Prescription record',
    section: [
      { title: 'Prescription', code: { coding: [PRESCRIPTION_RECORD] }, entry: entries },
      ...(notes ? [{ title: 'Clinic notes', text: { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${escXml(notes)}</div>` } }] : [])
    ]
  };
  const resources = [composition, patient, practitioner, ...(organization ? [organization] : []), ...meds, ...(photoDoc ? [photoDoc] : [])];
  return {
    resourceType: 'Bundle', id: uuidFor('Bundle', compositionId), meta: { lastUpdated: timestamp, profile: [`${PROFILE}/DocumentBundle`] },
    identifier: { system: 'https://sanjeevani.example/bundles', value: compositionId },
    type: 'document', timestamp,
    entry: resources.map((r) => ({ fullUrl: urn(r.id), resource: r }))
  };
}

// Maa's prescription from her records (the records pre-roll).
export function buildBundle(state) {
  const maa = state.members.find((m) => m.id === 'maa');
  const rx = state.records.find((r) => r.member === 'maa' && r.type === 'rx');   // newest prescription
  const [doctor, specialty] = rx && rx.from ? rx.from.split(' · ') : [maa.appt && maa.appt.doctor, maa.appt && maa.appt.spec];
  return buildPrescriptionBundle({
    patient: { full: maa.full, name: maa.name, sex: maa.sex, abha: maa.abha, city: maa.city, pincode: maa.pincode, lang: maa.lang },
    practitioner: { name: doctor || 'Dr. Mehta', specialty: specialty || 'Cardiology' },
    organization: null,
    authored: rx ? isoDate(rx.date) : state.today,
    timestamp: `${state.today}T18:31:00+05:30`,
    medicines: maa.medicines.map((md) => ({ name: md.name, freq: md.freq, pharmacy: md.pharmacy })),
    notes: null, photo: null
  });
}

/* ---------------- Structural checks ---------------- */
export function checkBundle(b) {
  const errors = [];
  const urls = new Set(b.entry.map((e) => e.fullUrl));
  if (b.resourceType !== 'Bundle') errors.push('not a Bundle');
  if (b.type === 'document') {
    if (!b.identifier || !b.timestamp) errors.push('document Bundle needs identifier and timestamp');
    if (!b.entry.length || b.entry[0].resource.resourceType !== 'Composition') errors.push('document Bundle must start with a Composition');
  }
  const refs = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (node && typeof node === 'object') {
      if (typeof node.reference === 'string') refs.push([path, node.reference]);
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }
  };
  const required = {
    Composition: ['status', 'type', 'subject', 'date', 'author', 'title'],
    Patient: ['identifier', 'name'],
    Practitioner: ['name'],
    Organization: ['name'],
    MedicationRequest: ['status', 'intent', 'medicationCodeableConcept', 'subject', 'authoredOn', 'requester'],
    DocumentReference: ['status', 'content']
  };
  for (const e of b.entry) {
    const r = e.resource;
    if (!e.fullUrl || !r || !r.resourceType || !r.id) { errors.push('entry missing fullUrl/resourceType/id'); continue; }
    for (const f of required[r.resourceType] || []) if (r[f] == null) errors.push(`${r.resourceType} ${r.id} missing ${f}`);
    walk(r, r.resourceType);
  }
  for (const [path, ref] of refs) if (ref.startsWith('urn:uuid:') && !urls.has(ref)) errors.push(`${path} → ${ref} does not resolve`);
  return { ok: errors.length === 0, errors, resources: b.entry.length, references: refs.length };
}

/* ---------------- Console helpers ---------------- */
export function summary(b) {
  return b.entry.map(({ resource: r }) => {
    if (r.resourceType === 'Patient') return { type: 'Patient', text: `${r.name[0].text} · ${r.gender} · ABHA ${r.identifier[0].value}` };
    if (r.resourceType === 'Practitioner') return { type: 'Practitioner', text: `${r.name[0].text} · ${r.qualification[0].code.text}` };
    if (r.resourceType === 'Organization') return { type: 'Organization', text: r.name };
    if (r.resourceType === 'MedicationRequest') return { type: 'MedicationRequest', text: `${r.medicationCodeableConcept.text} · ${r.dosageInstruction[0].text}` };
    if (r.resourceType === 'DocumentReference') return { type: 'DocumentReference', text: `${r.type.text} · ${r.content[0].attachment.contentType} · ${Math.round(r.content[0].attachment.size / 1024)} KB` };
    if (r.resourceType === 'Composition') return { type: 'Composition', text: `${r.title} · ${r.author[0].display} · ${r.date.slice(0, 10)}` };
    return { type: r.resourceType, text: r.id };
  });
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal && signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason || new Error('aborted')); }, { once: true });
});

// The bundle card event (real). The console reveals one line per resource; callers wait cardMs().
export function bundleEvent(bundle, check, body) {
  return {
    source: 'agent', label: 'LIVE', type: 'fhir', title: `FHIR R4 bundle built · ${check.resources} resources`,
    body: check.ok ? body : `Structure check failed: ${check.errors.join('; ')}`,
    resources: summary(bundle), json: bundle
  };
}
export const cardMs = (check) => check.resources * CARD_MS_PER_RESOURCE;

// The ABHA link (mock): two SIMULATED rows naming the ABDM call it stands in for.
export async function abhaPush(emit, { bundle, abha, careContext, resources }, signal) {
  emit({ source: 'abha', label: 'SIMULATED', type: 'request', title: 'abha.push · link care context to the patient\'s ABHA', endpoint: `no API call · ABDM gateway ${ABDM_LINK} (simulated)`,
    json: { simulated: true, patient: { abha }, careContexts: [{ referenceNumber: bundle.identifier.value, display: careContext }], bundle_id: bundle.id } });
  await sleep(PUSH_MS, signal);
  emit({ source: 'abha', label: 'SIMULATED', type: 'response', title: 'Linked to ABHA ✓ · simulated', endpoint: 'no API call · callback /v0.5/links/link/on-add-contexts (simulated)',
    body: 'The bundle above is real; the push to ABDM is simulated',
    json: { simulated: true, abha, care_context: careContext, bundle_id: bundle.id, resources, status: 'linked (simulated)' } });
}

/* ---------------- run(ctx): the records pre-roll ---------------- */
export async function run(ctx) {
  const maa = ctx.state.members.find((m) => m.id === 'maa');
  const bundle = buildBundle(ctx.state);
  const check = checkBundle(bundle);
  const meds = bundle.entry.filter((e) => e.resource.resourceType === 'MedicationRequest').length;
  ctx.emit(bundleEvent(bundle, check, `Prescription record for Maa · ${meds} medicines · structure checked (${check.references} references resolve)`));
  if (!check.ok) throw new Error(`FHIR bundle failed checks: ${check.errors.join('; ')}`);
  await sleep(cardMs(check), ctx.signal);

  const careContext = `Prescription · ${bundle.entry[0].resource.author[0].display} · ${meds} medicines`;
  await abhaPush(ctx.emit, { bundle, abha: maa.abha, careContext, resources: check.resources }, ctx.signal);
  return { events: [], statePatch: {}, artifacts: {}, result: { bundle_id: bundle.id, resources: check.resources, checked: check.ok, pushed: 'simulated' } };
}

/* ---------------- CLI ---------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const state = JSON.parse(readFileSync(join(ROOT, 'data', 'state.initial.json'), 'utf8'));
  const bundle = buildBundle(state);
  const check = checkBundle(bundle);
  console.log(JSON.stringify(bundle, null, 2));
  console.error(`\n${check.ok ? 'checks passed' : 'checks FAILED'} · ${check.resources} resources · ${check.references} references${check.errors.length ? `\n  ${check.errors.join('\n  ')}` : ''}`);
  if (process.argv.includes('--live')) console.error(`saved ${writeCache('fhir', { bundle, check })}`);
  process.exit(check.ok ? 0 : 1);
}
