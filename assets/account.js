// Signing in with Google keeps answers, cards, mistakes and activity in the student's account, so
// every device they sign in on shows the same. The device copy stays the working copy (see sync.js).
// Off inside claude.ai (the page cannot reach Google there) and while no Firebase project is set.
import { createSync } from "./sync.js";
import { mergeMap, mergeSet, mergeValue, newer, same } from "./merge.js";
import { firebaseConfig } from "./cloud-config.js";

const RECORD = "sat-trainer:sync:v1";   // { uid, email, on, base: { section: last agreed value } }
const SOURCES = "sat-trainer:sources:v1";   // the PDFs this device should have: { list: {id: {fileName, importedAt}}, numbers: {qid: n} }

// Days of activity: numbers take the larger, marks stay set.
const maxFields = (x, y) => Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])]
  .map((k) => [k, typeof x[k] === "number" || typeof y[k] === "number" ? Math.max(x[k] || 0, y[k] || 0) : x[k] || y[k]]));
const mine = (l) => l;                  // own words and edits changed on both devices: this device's version
const one = (b, l, r, resolve) => mergeMap({ v: b }, { v: l }, { v: r }, resolve).v;
const larger = (b, l, r) => Math.max(l || 0, r || 0);

// An object merged field by field; fields without a rule are single values.
function byField(b, l, r, rules) {
  b ||= {}; l ||= {}; r ||= {};
  const out = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const v = (rules[k] || mergeValue)(b[k], l[k], r[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export const MERGE = {
  progress: (b, l, r) => mergeMap(b, l, r, newer((x) => x.t)),
  review: (b, l, r) => mergeMap(b, l, r, newer((x) => x.last || x.added)),
  flags: mergeSet,
  vocab: (b, l, r) => byField(b, l, r, {
    srs: (b, l, r) => mergeMap(b, l, r, newer((x) => x.last)),
    user: (b, l, r) => mergeMap(b, l, r, mine),
    edits: (b, l, r) => mergeMap(b, l, r, mine),
    known: mergeSet,
    test: (b, l, r) => one(b, l, r, newer((x) => x.at)),
  }),
  activity: (b, l, r) => byField(b, l, r, {
    days: (b, l, r) => mergeMap(b, l, r, maxFields),
    unlocked: mergeSet,
    bestRun: larger,
    bestStreak: larger,
  }),
  sources: (b, l, r) => byField(b, l, r, {
    list: (b, l, r) => mergeMap(b, l, r, mine),
    numbers: (b, l, r) => mergeMap(b, l, r, mine),
  }),
};

// Brings this device's questions in line with the PDFs the account lists. `have` is what the
// device's set is built from: { ids, numbers }. `bytesOf(id)` finds a PDF here or in the account
// (null: not uploaded yet); `install(list, numbers)` builds the set. An empty list in the account
// never removes questions from a device. Returns "same", "done" or "waiting" (some PDF is missing).
export async function syncSources(want, have, bytesOf, install) {
  const list = Object.entries(want?.list || {}).map(([id, s]) => ({ id, ...s })).sort((a, b) => (a.importedAt || 0) - (b.importedAt || 0));
  if (!list.length) return "same";
  const ids = list.map((s) => s.id);
  if (same([...ids].sort(), [...have.ids].sort()) && same(want.numbers || {}, have.numbers || {})) return "same";
  const ready = [];
  for (const s of list) if (await bytesOf(s.id)) ready.push(s);
  if (!ready.length) return "waiting";
  await install(ready, want.numbers || {});
  return ready.length < list.length ? "waiting" : "done";
}

const STATUS = {
  saving: ["cloud", "Сохраняю…"],
  saved: ["cloudCheck", "Сохранено в аккаунте"],
  offline: ["cloudOff", "Нет связи — сохраню, когда появится"],
  error: ["cloudOff", "Не получилось сохранить — попробую ещё раз"],
};

function signInError(e) {
  const code = e?.code || "";
  if (/popup-closed-by-user|cancelled-popup-request/.test(code)) return null;
  if (/popup-blocked/.test(code)) return "Браузер не дал открыть окно входа. Разрешите всплывающие окна для этого сайта и попробуйте ещё раз.";
  if (/unauthorized-domain/.test(code)) return "Вход с этого адреса не разрешён: в Firebase его нужно добавить в Authorized domains.";
  if (/network-request-failed/.test(code)) return "Нет связи с интернетом — попробуйте ещё раз.";
  return `Не удалось войти${code ? ` (${code})` : ""}.`;
}

// data: { [section]: { read(), write(value) } } — the trainer's own copy of each section.
// sets: { current() → {list, numbers} | null, have() → {ids, numbers}, stored(id), store(id, bytes), install(list, numbers) }
//   — the questions on this device, the PDFs behind them, and building them from PDFs.
export function createAccount({ ls, icon, esc, toast, data, sets, changed }) {
  const enabled = !!firebaseConfig && !window.claude;
  let cloudP = null;
  let cloud = null;
  let sync = null;
  let user = null;
  let started = false;
  let watching = false;
  let state = "off";
  let applying = false;
  let refreshTimer = null;

  const record = () => ls.get(RECORD, null);
  const load = () => (cloudP ||= import("./cloud.js").then((m) => m.loadCloud(firebaseConfig)).then((c) => (cloud = c)))
    .catch((e) => { cloudP = null; throw e; });

  // Several parts report (data, the list of PDFs, an upload); the chip shows the most pressing.
  const states = {};
  function setState(part, s) {
    if (s) states[part] = s; else delete states[part];
    state = ["offline", "error", "saving", "saved"].find((x) => Object.values(states).includes(x)) || (user ? "saved" : "off");
    const el = document.getElementById("sync-chip");
    if (el) el.outerHTML = chip();
  }
  const clearStates = () => { for (const k of Object.keys(states)) delete states[k]; setState("none", null); };

  // After the account changed the trainer's data: redraw once, not per section.
  const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(changed, 120); };

  const sections = Object.fromEntries(Object.keys(MERGE).filter((n) => n !== "sources").map((name) => [name, {
    read: () => data[name].read(),
    apply: (v) => { applying = true; try { data[name].write(v); } finally { applying = false; } refresh(); },
    merge: MERGE[name],
  }]));

  // ---------------------------------------------------------------- questions and PDFs
  // The list of PDFs this device should have is kept apart from the set, which may still be
  // waiting for one of them. It goes to the account only after its PDFs are there.

  let sourcesSync = null;
  let waitTimer = null;
  let ensuring = Promise.resolve();
  const uploaded = new Set();

  const wanted = () => ls.get(SOURCES, null) || sets.current() || undefined;
  const sourcesSection = { sources: {
    read: wanted,
    apply: (v) => { ls.set(SOURCES, v); ensureSources(); },
    merge: MERGE.sources,
  } };

  async function bytesOf(id) {
    const here = await sets.stored(id);
    if (here || !user || !cloud) return here || null;
    const got = await cloud.getPdf(user.uid, id);
    if (got) await sets.store(id, got);
    return got;
  }

  function ensureSources() {
    clearTimeout(waitTimer);
    ensuring = ensuring.then(async () => {
      try {
        const res = await syncSources(ls.get(SOURCES, null), sets.have(), bytesOf, sets.install);
        if (res === "waiting" && user) waitTimer = setTimeout(ensureSources, 20_000);   // another device is still uploading
      } catch (e) { console.warn("sources", e); }
    });
    return ensuring;
  }

  async function uploadMissing() {
    for (const id of Object.keys(wanted()?.list || {})) {
      if (uploaded.has(id)) continue;
      if (!(await cloud.hasPdf(user.uid, id))) {
        const bytes = await sets.stored(id);
        if (!bytes) continue;          // not here: the device that has it uploads it
        await cloud.putPdf(user.uid, id, bytes);
      }
      uploaded.add(id);
    }
  }

  async function sendSources() {
    setState("pdf", "saving");
    try { await uploadMissing(); setState("pdf", null); }
    catch (e) { console.warn("pdf upload", e); setState("pdf", navigator.onLine ? "error" : "offline"); return false; }
    return true;
  }

  // A PDF was added here (or the set started over with `replace`): the list follows, after the upload.
  async function setsChanged({ replace = false } = {}) {
    const now = sets.current();
    const before = ls.get(SOURCES, null);
    // a PDF still on its way from the account stays on the list unless the set started over
    ls.set(SOURCES, replace || !before ? now : { list: { ...before.list, ...now?.list }, numbers: { ...before.numbers, ...now?.numbers } });
    if (!user || !sourcesSync) return;
    if (await sendSources()) sourcesSync.notify("sources");
  }

  const base = {
    get: (name) => record()?.base?.[name],
    set: (name, value) => { const r = record(); if (!r) return; r.base = { ...r.base, [name]: value }; ls.set(RECORD, r); },
  };

  function stopAll() {
    sync?.stop();
    sourcesSync?.stop();
    sync = sourcesSync = null;
    started = false;
    clearTimeout(waitTimer);
  }

  async function begin(u) {
    stopAll();
    let r = record();
    if (!r || r.uid !== u.uid) { r = { uid: u.uid, base: {} }; uploaded.clear(); }   // another account starts from nothing agreed
    ls.set(RECORD, { ...r, on: true, email: u.email || "" });
    const adapter = cloud.adapter(u.uid);
    sync = createSync({ adapter, sections, base, onStatus: (s) => setState("data", s) });
    setState("data", "saving");
    try {
      await sync.start();
      changed();
      // questions: this device's PDFs go up first, then the list that names them
      if (await sendSources()) {
        sourcesSync = createSync({ adapter, sections: sourcesSection, base, onStatus: (s) => setState("sources", s) });
        await sourcesSync.start();
        await ensureSources();
      }
      started = true;
    } catch (e) {
      console.warn("sync start", e);
      setState("data", navigator.onLine ? "error" : "offline");
    }
    changed();
  }

  async function onUser(u) {
    if ((u?.uid || null) === (user?.uid || null)) return;
    user = u;
    if (u) return begin(u);
    stopAll();
    const r = record();
    if (r) ls.set(RECORD, { ...r, on: false });
    clearStates();
    changed();
  }

  async function connect() {
    await load();
    if (!watching) { watching = true; cloud.onUser(onUser); }
  }

  // On start: a device that was signed in reconnects; one that never was does not load Firebase.
  async function init() {
    if (!enabled || !record()?.on) return;
    try { await connect(); } catch (e) { console.warn("account", e); setState("data", "offline"); }
  }

  async function signIn() {
    if (!enabled) return;
    try {
      await connect();
      const res = await cloud.signIn();
      toast(`Вы вошли: ${res.user.email || "аккаунт Google"}. Прогресс сохраняется в аккаунте`);
    } catch (e) {
      const msg = e?.code ? signInError(e) : "Не удалось загрузить вход — проверьте интернет.";
      if (msg) toast(msg);
    }
  }

  async function signOut() {
    sync?.flush();
    sourcesSync?.flush();
    await cloud?.signOut();
    toast("Вы вышли из аккаунта. Прогресс на этом устройстве остался");
  }

  // "Удалить данные из браузера": sign out here and forget what was agreed with the account.
  async function forget() {
    stopAll();
    try { await cloud?.signOut(); } catch { /* not signed in */ }
    ls.del(RECORD);
    ls.del(SOURCES);
  }

  addEventListener("online", () => { if (user && !started) begin(user); else { sync?.status(); sourcesSync?.status(); } });
  addEventListener("offline", () => { sync?.status(); sourcesSync?.status(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { sync?.flush(); sourcesSync?.flush(); } });

  // ---------------------------------------------------------------- screens

  function chip() {
    if (!enabled || !user || !STATUS[state]) return `<span id="sync-chip" hidden></span>`;
    const [ic, text] = STATUS[state];
    return `<span id="sync-chip" class="sync-chip ${state}" title="${esc(`${text} · ${user.email || ""}`)}" role="status">${icon(ic, "icon-sm")}<span class="label">${state === "saved" ? "В аккаунте" : esc(text.split(" — ")[0])}</span></span>`;
  }

  function menuHtml() {
    if (!enabled) return "";
    if (user) return `<div class="menu-note">${icon("cloudCheck", "icon-sm")} ${esc(user.email || "Аккаунт Google")}</div>
      <button role="menuitem" data-action="sign-out">${icon("x")} Выйти из аккаунта</button><hr>`;
    return `<button role="menuitem" data-action="sign-in">${icon("cloud")} Войти через Google — прогресс на всех устройствах</button><hr>`;
  }

  function landingHtml() {
    if (!enabled) return "";
    if (user) return `<div class="landing-alt"><span class="muted">${icon("cloudCheck", "icon-sm")} Вы вошли: ${esc(user.email || "аккаунт Google")}. Если на другом устройстве уже есть вопросы, они появятся здесь сами.</span></div>`;
    return `<div class="landing-alt">
      <button class="btn btn-ghost" data-action="sign-in">${icon("cloud", "icon-sm")} Войти через Google</button>
      <span class="muted">Если вы уже занимались на другом устройстве с этим аккаунтом</span>
    </div>`;
  }

  return {
    enabled, init, forget, chip, menuHtml, landingHtml, setsChanged,
    notify: (section) => { if (!applying) sync?.notify(section); },
    signedIn: () => !!user,
    actions: { "sign-in": signIn, "sign-out": signOut },
  };
}
