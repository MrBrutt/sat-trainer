import { test, eq } from "./run.js";
import { buildModule, routeOf, scoreRange, resultOf, BLUEPRINT } from "../assets/mock.js";

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
