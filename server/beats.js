// The story the agent runner plays: an optional pre-roll, the trigger, the plan's step → module
// map, and the limits the orchestrator enforces on every plan step. The orchestrator only ever
// calls modules through run(ctx); this file never edits them.

// Story clock is IST. Weekday labels are computed from these dates, never typed in.
const at = (date, time) => `${date}T${time}+05:30`;

export const STORY = {
  preroll: at('2026-10-03', '18:20:00'),     // records read, caregiver about to fly
  trigger: at('2026-10-06', '09:58:00'),     // Amlodipine hits 3 days
  delivered: at('2026-10-08', '11:20:00'),   // delivery confirmed (simulated)
  summary: at('2026-10-11', '18:05:00')      // caregiver lands
};

const say = (source, label, type, title, extra = {}) => ({ kind: 'event', event: { source, label, type, title, ...extra } });
const mod = (name) => ({ kind: 'module', name });
const wa = (step, args = {}) => ({ kind: 'whatsapp', step: { step, ...args } });   // a cued WhatsApp exchange

// Before the trigger: records consolidated and away mode on. Skipped with PREROLL=0.
// Documents and the "Amlodipine or Amlokind?" question happen on the web upload screen
// (web/onboarding), so they are not WhatsApp steps.
export const PREROLL = [
  say('agent', 'SCRIPTED', 'info', 'records · 4 of Maa\'s documents read', { body: 'Prescription, 2 lab reports, discharge summary' }),
  mod('hf_ocr'),
  mod('fhir'),
  wa('away_mode'),                                                  // "Flying to Delhi, back Sunday" → "Got it ✈ …"
  say('agent', 'SCRIPTED', 'info', 'caregiver.away = true · backup = Rohan', { body: 'Pursharth flies to Delhi, back Sun 11 Oct' }),
  { kind: 'patch', patch: { caregiver: { away: true } } }
];

// After a completed run: "Landed" → the welcome-back summary.
export const SUMMARY_WHATSAPP = { step: 'caregiver_lands' };

// WhatsApp step → the cue page's beat number (whatsapp_script.json is keyed by these). The
// orchestrator pushes {"beat": N, "step": …} on /cue-stream when the step starts; whatsapp.js can
// push its own payload with ctx.cue(). escalate_to_backup has no scripted beat.
export const CUE_BEAT = {
  documents_received: 1, confirm_medicine_name: 3, away_mode: 4,
  notify_caregiver: 7, notify_parent: 12, caregiver_lands: 13
};

export const TRIGGER = {
  events: [
    say('agent', 'SCRIPTED', 'info', 'monitor.stock · Amlodipine 3 days', { body: 'Maa · Apollo Pharmacy, Lucknow' }),
    say('agent', 'SCRIPTED', 'info', 'monitor.trend · HbA1c rising (3)', { body: '6.8 → 6.9 → 7.1 → 7.2 → 7.4' }),
    say('agent', 'SCRIPTED', 'info', 'followup due · Dr. Mehta', { body: 'Cardiology · not booked' })
  ],
  statePatch: {
    caregiver: { away: true },
    members: [{ id: 'maa', medicines: [{ id: 'amlo', days: 3 }] }]
  }
};

// Plan step → the module(s) that carry it out, in order. Any other step is rejected.
export const STEP_MODULES = {
  notify_caregiver: ['whatsapp'],
  book_appointment: ['gnani'],
  create_order: ['pinelabs'],
  route_delivery: ['delhivery'],
  notify_parent: ['gnani', 'whatsapp'],
  escalate_to_backup: ['whatsapp']
};

// Steps that act on the world; notify_caregiver must come before any of them.
export const ACTION_STEPS = ['book_appointment', 'create_order', 'route_delivery'];

// Seconds before a module call is aborted and fails honestly. WhatsApp waits on a person tapping
// Sent ✓ / Received ✓ on the cue page, so every WhatsApp call gets `whatsapp`.
export const TIMEOUT_S = {
  whatsapp: 600,
  hf_ocr: 90, fhir: 15, hf_reason: 180,
  notify_caregiver: 120, book_appointment: 420, create_order: 300,
  route_delivery: 45, notify_parent: 180, escalate_to_backup: 120
};

// The plan section 8 target. Used only when hf_reason yields no plan, and labelled SCRIPTED.
export const FALLBACK_PLAN = {
  decision: 'act_and_inform',
  plan: [
    { step: 'notify_caregiver', hold_window_min: 10 },
    { step: 'book_appointment', via: 'gnani_call', target: 'Dr. Mehta clinic', pref: 'Saturday AM' },
    { step: 'create_order', via: 'pinelabs', amount_inr: 184, within_mandate: true },
    { step: 'route_delivery', via: 'delhivery', pincode: '226001' },
    { step: 'notify_parent', via: 'gnani_tts', lang: 'hi-IN', when: 'after_delivery' }
  ]
};

// After route_delivery: there is no real courier, so delivery completion is simulated.
export const DELIVERED = {
  event: { source: 'delhivery', label: 'SIMULATED', type: 'info', title: 'delivery.delivered', body: 'Amlodipine 5mg × 30 delivered to Maa, Lucknow' },
  statePatch: { members: [{ id: 'maa', medicines: [{ id: 'amlo', days: 33 }] }] }
};

export const SUMMARY_PATCH = { caregiver: { away: false } };
