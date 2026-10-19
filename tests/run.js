// A tiny test runner for the browser: open /tests/ (or run scripts/test.sh) and read the page.
const tests = [];

export const test = (name, fn) => tests.push({ name, fn });

// JSON with sorted keys, so {a, b} and {b, a} compare equal
export const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

export function eq(actual, expected, what = "") {
  if (canon(actual) !== canon(expected)) throw new Error(`${what ? what + ": " : ""}expected ${canon(expected)}, got ${canon(actual)}`);
}

export async function run(files) {
  const lines = [];
  let pass = 0, fail = 0;
  for (const f of files) {
    try { await import(f); } catch (e) { fail++; lines.push(`FAIL ${f}: ${e.message}`); }
  }
  for (const t of tests) {
    try { await t.fn(); pass++; lines.push(`ok   ${t.name}`); }
    catch (e) { fail++; lines.push(`FAIL ${t.name}: ${e.message}`); }
  }
  const summary = `${fail ? "FAIL" : "PASS"} ${pass}/${pass + fail}`;
  document.getElementById("out").textContent = `${lines.join("\n")}\n${summary}`;
  document.title = summary;
}
