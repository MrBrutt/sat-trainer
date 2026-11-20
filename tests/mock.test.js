import { test, eq } from "./run.js";
import { buildModule, routeOf, scoreRange, resultOf, BLUEPRINT, historyEntry, lastLine, pastMocks, mockQuestions } from "../assets/mock.js";

const SKILLS = BLUEPRINT.flatMap((b) => b.skills.map(([skill]) => ({ domain: b.domain, skill })));
let seq = 0;
const q = (skill, difficulty = "Medium") => ({ id: `q${++seq}`, n: seq, skill, difficulty, choices: [], correct: "A" });
// plenty of every type and difficulty
const bank = () => SKILLS.flatMap(({ skill }) => ["Easy", "Medium", "Hard"].flatMap((d) => [q(skill, d), q(skill, d), q(skill, d), q(skill, d), q(skill, d)]));
const first = () => 0;
const byId = (qs) => new Map(qs.map((x) => [x.id, x]));

test("a module follows the exam: 27 questions, the blocks in order, the agreed counts", () => {
  const qs = bank();
  const ids = buildModule(qs, {}, { level: "mixed", rng: first });
  eq(ids.length, 27);
  const m = byId(qs);
  const skills = ids.map((id) => m.get(id).skill);
  const count = (s) => skills.filter((x) => x === s).length;
  eq(BLUEPRINT.flatMap((b) => b.skills.map(([s, n]) => count(s) === n)).every(Boolean), true);
  const blockOf = (s) => BLUEPRINT.findIndex((b) => b.skills.some(([x]) => x === s));
  eq(skills.map(blockOf).every((b, i, a) => i === 0 || a[i - 1] <= b), true, "blocks never go back");
});

test("inside a block: by type, then easier first; grammar by difficulty alone", () => {
  const qs = bank();
  const m = byId(qs);
  const rank = { Easy: 0, Medium: 1, Hard: 2 };
  const mod = buildModule(qs, {}, { level: "mixed", rng: first }).map((id) => m.get(id));
  const wic = mod.filter((x) => x.skill === "Words in Context").map((x) => rank[x.difficulty]);
  eq(wic.every((d, i) => i === 0 || wic[i - 1] <= d), true, "Words in Context easier first");
  const sec = mod.filter((x) => x.skill === "Boundaries" || x.skill === "Form, Structure, and Sense").map((x) => rank[x.difficulty]);
  eq(sec.every((d, i) => i === 0 || sec[i - 1] <= d), true, "grammar by difficulty");
});

test("the first module leans on Medium; the harder second on Hard; the easier on Easy", () => {
  const qs = bank();
  const m = byId(qs);
  const share = (ids, d) => ids.filter((id) => m.get(id).difficulty === d).length;
  const one = buildModule(qs, {}, { level: "mixed", rng: first });
  const hard = buildModule(qs, {}, { level: "harder", exclude: new Set(one), rng: first });
  const easy = buildModule(qs, {}, { level: "easier", exclude: new Set(one), rng: first });
  eq(share(one, "Medium") >= share(one, "Easy") && share(one, "Medium") >= share(one, "Hard"), true);
  eq(share(hard, "Hard") > 27 / 2, true);
  eq(share(easy, "Easy") > 27 / 2, true);
});

test("a bank without Easy still gives full modules", () => {
  const qs = bank().filter((x) => x.difficulty !== "Easy");
  eq(buildModule(qs, {}, { level: "easier", rng: first }).length, 27);
});

test("questions not answered come first; of the answered, the oldest", () => {
  const a = q("Cross-Text Connections"), b = q("Cross-Text Connections"), c = q("Cross-Text Connections");
  const progress = { [a.id]: { t: 5 }, [b.id]: { t: 1 } };
  const qs = [a, b, ...bank().filter((x) => x.skill !== "Cross-Text Connections")];
  const m1 = buildModule(qs, progress, { level: "mixed", rng: first });
  eq(m1.includes(b.id) && !m1.includes(a.id), true, "the one answered longest ago");
  const fresh = buildModule([...qs, c], progress, { level: "mixed", rng: first });
  eq(fresh.includes(c.id), true, "an unanswered one before any answered");
});

test("the second module repeats nothing from the first", () => {
  const qs = bank();
  const one = buildModule(qs, {}, { level: "mixed" });
  const two = buildModule(qs, {}, { level: "harder", exclude: new Set(one) });
  eq(two.filter((id) => one.includes(id)), []);
});

test("a small bank gives a shorter module and no repeats", () => {
  const qs = [q("Words in Context"), q("Transitions"), q("Transitions")];
  const ids = buildModule(qs, {}, { level: "mixed", rng: first });
  eq([ids.length, new Set(ids).size], [3, 3]);
});

test("two thirds right sends the second module harder", () => {
  eq([routeOf(18, 27), routeOf(17, 27), routeOf(27, 27), routeOf(0, 27)], ["harder", "easier", "harder", "easier"]);
});

test("the score range comes from College Board's table, raw scaled to 66 questions", () => {
  eq(scoreRange(40, 54), [580, 640]);
  eq(scoreRange(54, 54), [800, 800]);
  eq(scoreRange(0, 54), [200, 200]);
  eq(scoreRange(27, 54), [420, 460], "33 of 66");
});

test("the result counts unanswered as wrong and adds up per type", () => {
  const w1 = q("Words in Context"), w2 = q("Words in Context"), t1 = q("Transitions");
  const modules = [{ ids: [w1.id, w2.id], answers: { [w1.id]: "A", [w2.id]: "B" }, ms: {} }, { ids: [t1.id], answers: {}, ms: {} }];
  const r = resultOf(modules, byId([w1, w2, t1]));
  eq([r.correct, r.total, r.perModule], [1, 3, [1, 0]]);
  eq(r.skills.find((s) => s.skill === "Words in Context"), { skill: "Words in Context", n: 2, ok: 1, rushed: 0, slow: 0 });
  eq(r.wrong, [w2.id, t1.id]);
});

test("a mock stopped after the first module keeps that module's result, without a score from 800", () => {
  const w1 = q("Words in Context"), w2 = q("Words in Context");
  const modules = [{ ids: [w1.id, w2.id], answers: { [w1.id]: "A", [w2.id]: "B" }, ms: {} }];
  const h = historyEntry({ at: 5, route: "harder", modules }, byId([w1, w2]));
  eq([h.correct, h.total, h.onlyFirst, h.range, h.wrong], [1, 2, true, null, [w2.id]]);
});

test("the line on «Сегодня» tells a full mock from one stopped after the first module", () => {
  const at = new Date(2026, 10, 20).getTime();
  eq(lastLine({ at, correct: 40, total: 54, range: [580, 640] }), "Последний: <b>580–640</b> · верно 40 из 54 · 20 ноября");
  eq(lastLine({ at, correct: 20, total: 27, range: null, onlyFirst: true }), "Последний: <b>только модуль 1</b> · верно 20 из 27 · 20 ноября");
});

test("past mocks are listed newest first, each with its date and result", () => {
  const h = {
    a: { at: new Date(2026, 10, 16).getTime(), correct: 40, total: 54, range: [580, 640] },
    b: { at: new Date(2026, 10, 20).getTime(), correct: 20, total: 27, range: null, onlyFirst: true },
  };
  eq(pastMocks(h), [
    { id: "b", label: "20 ноября · верно 20 из 27 · только модуль 1" },
    { id: "a", label: "16 ноября · верно 40 из 54 · 580–640" },
  ]);
});

test("a mock's every question is kept: right, wrong or left blank, in module order", () => {
  const a = q("Words in Context"), b = q("Inferences"), c = q("Transitions");
  const modules = [{ ids: [a.id, b.id], answers: { [a.id]: "A", [b.id]: "C" }, ms: {} }, { ids: [c.id], answers: {}, ms: {} }];
  const h = historyEntry({ at: 1, route: "harder", modules }, byId([a, b, c]));
  eq(mockQuestions(h, "m1", {}, byId([a, b, c])).map((m) => m.map((x) => [x.n, x.state])),
    [[[a.n, "ok"], [b.n, "bad"]], [[c.n, "blank"]]]);
});

test("a mock saved before the list was kept is put together from the trainer's records", () => {
  const a = q("Inferences"), b = q("Words in Context"), c = q("Transitions"), other = q("Boundaries");
  const progress = { [a.id]: { ok: false, mock: "m1" }, [b.id]: { ok: true, mock: "m1" }, [other.id]: { ok: true } };
  const h = { at: 1, correct: 1, total: 3, onlyFirst: true, wrong: [a.id, c.id] };
  eq(mockQuestions(h, "m1", progress, byId([a, b, c, other])).map((m) => m.map((x) => [x.n, x.state])),
    [[[b.n, "ok"], [a.n, "bad"], [c.n, "blank"]]]);
});
