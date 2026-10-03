// Internal story state (not synced to the dashboard). Modules read it through ctx.state,
// e.g. hf_reason builds its prompt from the facts at beat 5.
//
// Patch rules (used by data/beats/*.json and every module's statePatch):
//   - plain objects merge recursively
//   - an array of objects that all have an `id` merges into the target array by id
//     (unknown ids are appended), so { members: [{ id: "maa", medicines: [{ id: "amlo", days: 3 }] }] }
//     changes one field without restating the rest
//   - any other array replaces the target (so `decisions: []` clears it)
//   - { "$set": value }       replaces the target wholesale (e.g. a whole `delivery` object, or null)
//   - { "$prepend": [...] }   adds items to the front of an array (activity rows are newest first)
//   - { "$append": [...] }    adds items to the end of an array
//   - { "$remove": ["id"] }   removes items by id from an array
//
// Weekday labels are never stored by hand: any object with a `date` (YYYY-MM-DD) and no `day`
// gets `day` filled in as "Wed 7", and caregiver.away_until_date fills caregiver.away_until.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INITIAL = fileURLToPath(new URL('../data/state.initial.json', import.meta.url));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let state = null;
let rev = 0;

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasIds = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => isObj(x) && x.id != null);

function parseDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function weekday(ymd) {
  return DAYS[parseDate(ymd).getUTCDay()];
}

// "2026-10-07" → "Wed 7"
export function dayLabel(ymd) {
  return `${weekday(ymd)} ${parseDate(ymd).getUTCDate()}`;
}

// "2026-10-11" → "Sun 11 Oct"
export function dateLabel(ymd) {
  const d = parseDate(ymd);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function fillLabels(node) {
  if (Array.isArray(node)) { node.forEach(fillLabels); return node; }
  if (!isObj(node)) return node;
  if (typeof node.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(node.date) && node.day == null) {
    node.day = dayLabel(node.date);
  }
  Object.values(node).forEach(fillLabels);
  return node;
}

function withLabels(s) {
  fillLabels(s);
  if (s.caregiver && s.caregiver.away_until_date) s.caregiver.away_until = dateLabel(s.caregiver.away_until_date);
  return s;
}

export function merge(target, patch) {
  if (isObj(patch)) {
    if ('$set' in patch) return clone(patch.$set);
    if ('$prepend' in patch || '$append' in patch || '$remove' in patch) {
      let arr = Array.isArray(target) ? target.slice() : [];
      if (patch.$remove) arr = arr.filter((x) => !(isObj(x) && patch.$remove.includes(x.id)));
      if (patch.$prepend) arr = clone(patch.$prepend).concat(arr);
      if (patch.$append) arr = arr.concat(clone(patch.$append));
      return arr;
    }
    const out = isObj(target) ? { ...target } : {};
    for (const [k, v] of Object.entries(patch)) out[k] = merge(out[k], v);
    return out;
  }
  if (hasIds(patch) && hasIds(target)) {
    const out = target.slice();
    for (const item of patch) {
      const i = out.findIndex((x) => x.id === item.id);
      if (i >= 0) out[i] = merge(out[i], item);
      else out.push(clone(item));
    }
    return out;
  }
  return clone(patch);
}

export function reset() {
  state = withLabels(JSON.parse(readFileSync(INITIAL, 'utf8')));
  state.rev = `r${++rev}`;
  return state;
}

export function apply(patch, beat) {
  if (!state) reset();
  if (!patch || !isObj(patch) || Object.keys(patch).length === 0) return state;
  state = withLabels(merge(state, patch));
  state.rev = `r${++rev}`;
  if (beat != null) state.step = beat;
  return state;
}

export function setStep(beat) {
  if (!state) reset();
  state.step = beat;
  state.rev = `r${++rev}`;
}

export function get() {
  if (!state) reset();
  return state;
}

export function json() {
  return JSON.stringify(get(), null, 2);
}
