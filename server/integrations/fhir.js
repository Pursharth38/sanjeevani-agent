// FHIR R4 bundle + ABHA push (mock) for the records pre-roll.
//
//   node server/integrations/fhir.js --live     build the bundle, print it, write cache/fhir.json
//   node server/integrations/fhir.js --replay   same (nothing here touches the network)
//
// 1. Bundle, real: built in code from Maa's records in ctx.state as an R4 document Bundle shaped
//    like an ABDM Prescription record (NRCeS profiles): Composition + Patient + Practitioner +
//    one MedicationRequest per medicine. Ids are derived from the content, so the same records
//    always give the same bundle. Checked by our own structural checks (required fields, every
//    reference resolves) — not an official FHIR validator.
// 2. ABHA push, SIMULATED: no ABDM call is made. The console names the call it stands in for
//    (HIP-initiated care-context linking, POST /v0.5/links/link/add-contexts on the ABDM gateway).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, writeCache } from '../cache.js';

const PUSH_MS = 1200;
const CARD_MS_PER_RESOURCE = 300;   // the console reveals one resource line this often
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

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const isoDate = (d) => { const [day, mon, year] = String(d).split(' '); return `${year}-${MONTHS[mon]}-${day.padStart(2, '0')}`; };

const TIMES_PER_DAY = { 'once daily': 1, 'twice daily': 2, 'three times daily': 3 };

/* ---------------- Build ---------------- */
export function buildBundle(state) {
  const maa = state.members.find((m) => m.id === 'maa');
  const rx = state.records.find((r) => r.member === 'maa' && r.type === 'rx');   // newest prescription
  const doctor = (rx && rx.from ? rx.from.split(' · ')[0] : (maa.appt && maa.appt.doctor)) || 'Dr. Mehta';
  const specialty = (rx && rx.from && rx.from.split(' · ')[1]) || (maa.appt && maa.appt.spec) || 'Cardiology';
  const authored = rx ? isoDate(rx.date) : state.today;
  const timestamp = `${state.today}T18:31:00+05:30`;

  const patientId = uuidFor('Patient', maa.full, maa.abha);
  const practitionerId = uuidFor('Practitioner', doctor, specialty);
  const patient = {
    resourceType: 'Patient', id: patientId, meta: { profile: [`${PROFILE}/Patient`] },
    identifier: [{ system: ABHA_SYSTEM, value: maa.abha }],
    name: [{ text: maa.full }], gender: maa.sex === 'F' ? 'female' : maa.sex === 'M' ? 'male' : 'unknown',
    address: [{ city: maa.city, postalCode: maa.pincode, country: 'IN' }],
    communication: [{ language: { text: maa.lang } }]
  };
  const practitioner = {
    resourceType: 'Practitioner', id: practitionerId, meta: { profile: [`${PROFILE}/Practitioner`] },
    name: [{ text: doctor }], qualification: [{ code: { text: specialty } }]
  };
  const meds = maa.medicines.map((md) => {
    const id = uuidFor('MedicationRequest', patientId, md.name, authored);
    const perDay = TIMES_PER_DAY[md.freq];
    return {
      resourceType: 'MedicationRequest', id, meta: { profile: [`${PROFILE}/MedicationRequest`] },
      status: 'active', intent: 'order',
      medicationCodeableConcept: { text: md.name },
      subject: { reference: urn(patientId), display: maa.name },
      authoredOn: authored,
      requester: { reference: urn(practitionerId), display: doctor },
      dosageInstruction: [{ text: md.freq, ...(perDay ? { timing: { repeat: { frequency: perDay, period: 1, periodUnit: 'd' } } } : {}) }],
      dispenseRequest: { performer: { display: md.pharmacy } }
    };
  });
  const compositionId = uuidFor('Composition', patientId, authored, ...meds.map((m) => m.id));
  const composition = {
    resourceType: 'Composition', id: compositionId, meta: { profile: [`${PROFILE}/PrescriptionRecord`] },
    status: 'final', type: { coding: [PRESCRIPTION_RECORD], text: 'Prescription record' },
    subject: { reference: urn(patientId), display: maa.name }, date: timestamp,
    author: [{ reference: urn(practitionerId), display: doctor }],
    title: 'Prescription record',
    section: [{ title: 'Prescription', code: { coding: [PRESCRIPTION_RECORD] }, entry: meds.map((m) => ({ reference: urn(m.id), type: 'MedicationRequest' })) }]
  };
  const resources = [composition, patient, practitioner, ...meds];
  return {
    resourceType: 'Bundle', id: uuidFor('Bundle', compositionId), meta: { lastUpdated: timestamp, profile: [`${PROFILE}/DocumentBundle`] },
    identifier: { system: 'https://sanjeevani.example/bundles', value: compositionId },
    type: 'document', timestamp,
    entry: resources.map((r) => ({ fullUrl: urn(r.id), resource: r }))
  };
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
    MedicationRequest: ['status', 'intent', 'medicationCodeableConcept', 'subject', 'authoredOn', 'requester']
  };
  for (const e of b.entry) {
    const r = e.resource;
    if (!e.fullUrl || !r || !r.resourceType || !r.id) { errors.push(`entry missing fullUrl/resourceType/id`); continue; }
    for (const f of required[r.resourceType] || []) if (r[f] == null) errors.push(`${r.resourceType} ${r.id} missing ${f}`);
    walk(r, r.resourceType);
  }
  for (const [path, ref] of refs) if (ref.startsWith('urn:uuid:') && !urls.has(ref)) errors.push(`${path} → ${ref} does not resolve`);
  return { ok: errors.length === 0, errors, resources: b.entry.length, references: refs.length };
}

/* ---------------- run(ctx) ---------------- */
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal && signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason || new Error('aborted')); }, { once: true });
});

function summary(b) {
  return b.entry.map(({ resource: r }) => {
    if (r.resourceType === 'Patient') return { type: 'Patient', text: `${r.name[0].text} · ${r.gender} · ABHA ${r.identifier[0].value}` };
    if (r.resourceType === 'Practitioner') return { type: 'Practitioner', text: `${r.name[0].text} · ${r.qualification[0].code.text}` };
    if (r.resourceType === 'MedicationRequest') return { type: 'MedicationRequest', text: `${r.medicationCodeableConcept.text} · ${r.dosageInstruction[0].text}` };
    if (r.resourceType === 'Composition') return { type: 'Composition', text: `${r.title} · ${r.author[0].display} · ${r.date.slice(0, 10)}` };
    return { type: r.resourceType, text: r.id };
  });
}

export async function run(ctx) {
  const emit = (e) => ctx.emit({ source: 'abha', ...e });
  const maa = ctx.state.members.find((m) => m.id === 'maa');

  // 1. Build + check (real)
  const bundle = buildBundle(ctx.state);
  const check = checkBundle(bundle);
  const meds = bundle.entry.filter((e) => e.resource.resourceType === 'MedicationRequest').length;
  emit({ source: 'agent', label: 'LIVE', type: 'fhir', title: `FHIR R4 bundle built · ${check.resources} resources`,
    body: check.ok ? `Prescription record for Maa · ${meds} medicines · structure checked (${check.references} references resolve)` : `Structure check failed: ${check.errors.join('; ')}`,
    resources: summary(bundle), json: bundle });
  if (!check.ok) throw new Error(`FHIR bundle failed checks: ${check.errors.join('; ')}`);
  await sleep(check.resources * CARD_MS_PER_RESOURCE, ctx.signal);

  // 2. ABHA push (mock)
  const careContext = `Prescription · ${bundle.entry[0].resource.author[0].display} · ${bundle.entry[0].resource.section[0].entry.length} medicines`;
  emit({ label: 'SIMULATED', type: 'request', title: 'abha.push · link care context to Maa\'s ABHA', endpoint: `no API call · ABDM gateway ${ABDM_LINK} (simulated)`,
    json: { simulated: true, patient: { abha: maa.abha }, careContexts: [{ referenceNumber: bundle.identifier.value, display: careContext }], bundle_id: bundle.id } });
  await sleep(PUSH_MS, ctx.signal);
  emit({ label: 'SIMULATED', type: 'response', title: 'Linked to Maa\'s ABHA ✓ · simulated', endpoint: `no API call · callback /v0.5/links/link/on-add-contexts (simulated)`,
    body: 'The bundle above is real; the push to ABDM is simulated',
    json: { simulated: true, abha: maa.abha, care_context: careContext, bundle_id: bundle.id, resources: check.resources, status: 'linked (simulated)' } });

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
