// Three-way merge of this device's data with the account's copy. `b` is the copy both last agreed
// on, `l` this device, `r` the account. A side that did not change since `b` takes the other's
// value, so additions, edits and deletions (a reset too) carry over; only a real conflict, both
// sides changing the same thing, needs a rule.

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

export const same = (a, b) => canon(a) === canon(b);

// A single value (a setting, a level): on a conflict this device wins.
export function mergeValue(b, l, r) {
  if (same(l, r) || same(r, b)) return l;
  if (same(l, b)) return r;
  return l;
}

// A list of plain values used as a set (flagged questions, known words).
export function mergeSet(b, l, r) {
  const B = new Set(b || []), L = new Set(l || []), R = new Set(r || []);
  return [...new Set([...L, ...R])].filter((x) => (L.has(x) && R.has(x)) || !B.has(x));
}

// Records by key (answers by question, cards by word). `resolve(l, r)` settles a key both sides changed.
export function mergeMap(b, l, r, resolve) {
  b ||= {}; l ||= {}; r ||= {};
  const out = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const v = mergeItem(b[k], l[k], r[k], resolve);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function mergeItem(b, l, r, resolve) {
  if (same(l, r) || same(r, b)) return l;
  if (same(l, b)) return r;
  if (l === undefined) return r;      // deleted on one side, changed on the other: keep the change
  if (r === undefined) return l;
  return resolve(l, r);
}

// The record with the later timestamp wins; this device's on a tie.
export const newer = (time) => (l, r) => ((time(r) || 0) > (time(l) || 0) ? r : l);
