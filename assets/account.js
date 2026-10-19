// Signing in with Google keeps answers, cards, mistakes and activity in the student's account, so
// every device they sign in on shows the same. The device copy stays the working copy (see sync.js).
// Off inside claude.ai (the page cannot reach Google there) and while no Firebase project is set.
import { createSync } from "./sync.js";
import { mergeMap, mergeSet, mergeValue, newer } from "./merge.js";
import { firebaseConfig } from "./cloud-config.js";

const RECORD = "sat-trainer:sync:v1";   // { uid, email, on, base: { section: last agreed value } }

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
};

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
export function createAccount({ ls, icon, esc, toast, data, changed }) {
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

  function setState(s) {
    state = s;
    const el = document.getElementById("sync-chip");
    if (el) el.outerHTML = chip();
  }

  // After the account changed the trainer's data: redraw once, not per section.
  const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(changed, 120); };

  const sections = Object.fromEntries(Object.keys(MERGE).map((name) => [name, {
    read: () => data[name].read(),
    apply: (v) => { applying = true; try { data[name].write(v); } finally { applying = false; } refresh(); },
    merge: MERGE[name],
  }]));

  const base = {
    get: (name) => record()?.base?.[name],
    set: (name, value) => { const r = record(); if (!r) return; r.base = { ...r.base, [name]: value }; ls.set(RECORD, r); },
  };

  async function begin(u) {
    sync?.stop();
    started = false;
    let r = record();
    if (!r || r.uid !== u.uid) r = { uid: u.uid, base: {} };     // another account starts from nothing agreed
    ls.set(RECORD, { ...r, on: true, email: u.email || "" });
    sync = createSync({ adapter: cloud.adapter(u.uid), sections, base, onStatus: setState });
    setState("saving");
    try {
      await sync.start();
      started = true;
    } catch (e) {
      console.warn("sync start", e);
      setState(navigator.onLine ? "error" : "offline");
    }
    changed();
  }

  async function onUser(u) {
    if ((u?.uid || null) === (user?.uid || null)) return;
    user = u;
    if (u) return begin(u);
    sync?.stop();
    sync = null;
    started = false;
    const r = record();
    if (r) ls.set(RECORD, { ...r, on: false });
    setState("off");
    changed();
  }

  async function connect() {
    await load();
    if (!watching) { watching = true; cloud.onUser(onUser); }
  }

  // On start: a device that was signed in reconnects; one that never was does not load Firebase.
  async function init() {
    if (!enabled || !record()?.on) return;
    state = "saving";
    try { await connect(); } catch (e) { console.warn("account", e); setState("offline"); }
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
    await cloud?.signOut();
    toast("Вы вышли из аккаунта. Прогресс на этом устройстве остался");
  }

  // "Удалить данные из браузера": sign out here and forget what was agreed with the account.
  async function forget() {
    sync?.stop();
    sync = null;
    try { await cloud?.signOut(); } catch { /* not signed in */ }
    ls.del(RECORD);
  }

  addEventListener("online", () => { if (user && !started) begin(user); else sync?.status(); });
  addEventListener("offline", () => sync?.status());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sync?.flush(); });

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
    init, forget, chip, menuHtml, landingHtml,
    notify: (section) => { if (!applying) sync?.notify(section); },
    signedIn: () => !!user,
    actions: { "sign-in": signIn, "sign-out": signOut },
  };
}
