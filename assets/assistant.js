// AI tutor: a chat about the open question or word, answered by Claude through the viewer's own
// Claude account (the artifact `sample` capability). Absent everywhere else — the panel stays hidden.
import { plain } from "./parser.js";

const MAX_TURNS = 16;        // earlier turns are dropped from what Claude reads (they stay on screen)
const MAX_THREADS = 150;

const RULES = `You are Claude, a patient SAT Reading & Writing tutor built into a practice app. The student is a native Russian speaker preparing for the digital SAT.
Rules:
- Answer in Russian unless the student writes in English. Quote words and phrases from the passage in English.
- Be concrete and brief: a few short paragraphs or a bullet list, under 200 words unless the student asks for more.
- Explaining a word or phrase: give a plain English definition, a Russian translation, what it means in this passage, one or two short example sentences, and a memory hook if one helps.
- Explaining a question: walk through the reasoning the SAT rewards — what the text says, what the question asks, why each choice fits or fails.
- Follow the STATUS line in the context. If the question is not answered yet, never reveal or hint at which choice is correct unless the student explicitly asks for the answer; help with understanding, vocabulary and strategy instead.
- Text between ⟦ and ⟧ is underlined in the original question.
- Format with Markdown: **bold**, *italic*, bullet lists. No tables, no headings.
- If the student asks about something unrelated to SAT prep, help briefly and kindly steer back.`;

const ERRORS = {
  not_granted: "Доступ к Claude для этой страницы не разрешён. Разрешить можно в меню артефакта → «Разрешения».",
  sampling_disabled: "Claude недоступен для этого аккаунта.",
  rate_limited: "Слишком много запросов или достигнут лимит подписки. Попробуйте чуть позже.",
  session_expired: "Сессия claude.ai истекла — войдите заново и обновите страницу.",
  refused: "Claude не стал отвечать на этот запрос. Попробуйте сформулировать иначе.",
  prompt_too_large: "Переписка стала слишком длинной — начните новый чат.",
  empty_completion: "Пустой ответ. Попробуйте спросить иначе.",
};
const FATAL = new Set(["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"]);

const SUGGEST = {
  todo: [
    ["Подсказка без ответа", "Дай подсказку, как подойти к этому вопросу, не раскрывая правильный ответ."],
    ["Переведи текст", "Переведи текст и вопрос на русский."],
    ["Трудные слова", "Объясни трудные слова и выражения из этого текста."],
    ["Что от меня хотят?", "Объясни простыми словами, что спрашивает этот вопрос и какой навык он проверяет."],
  ],
  wrong: [
    ["Почему мой ответ неверный?", "Почему мой ответ неверный? Где была ошибка в рассуждении?"],
    ["Разбери все варианты", "Разбери по-русски каждый вариант ответа: почему он подходит или нет."],
    ["Как не ошибиться?", "Как не ошибиться в похожих вопросах в следующий раз? Дай короткую стратегию."],
    ["Похожий вопрос", "Составь один похожий вопрос для практики (текст, вопрос, 4 варианта). Ответ и объяснение дай только после того, как я отвечу."],
  ],
  right: [
    ["Почему это верно?", "Объясни коротко, почему правильный ответ именно этот."],
    ["Разбери все варианты", "Разбери по-русски каждый вариант ответа: почему он подходит или нет."],
    ["Переведи текст", "Переведи текст и вопрос на русский."],
    ["Похожий вопрос", "Составь один похожий вопрос для практики (текст, вопрос, 4 варианта). Ответ и объяснение дай только после того, как я отвечу."],
  ],
  word: [
    ["Объясни по-русски", "Объясни это слово по-русски: значение, перевод, как оно используется в тексте вопроса."],
    ["3 примера", "Дай 3 коротких примера употребления этого слова в типичном для SAT контексте."],
    ["Синонимы и антонимы", "Какие у этого слова синонимы и антонимы? Чем оно отличается от близких по смыслу слов?"],
    ["Как запомнить?", "Помоги запомнить это слово: ассоциация, этимология или мнемоника."],
  ],
  general: [
    ["Как учить Reading & Writing?", "Как эффективно готовиться к разделу Reading and Writing на digital SAT?"],
    ["Стратегия Words in Context", "Какая стратегия лучше всего работает для вопросов Words in Context?"],
    ["Время на экзамене", "Как распределять время в модуле Reading and Writing (27 вопросов за 32 минуты)?"],
  ],
};

function md(src, esc) {
  const inline = (s) => s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/⟦([^⟧]+)⟧/g, "<u>$1</u>");
  let html = "", list = null, para = [];
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join("<br>"))}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of esc(src).split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara();
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) { flushPara(); closeList(); html += `<p class="md-h">${inline(m[1])}</p>`; continue; }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return html;
}

// Runs -> plain text with *italic* and ⟦underline⟧ marks, so Claude sees what the student sees.
function marked(runs) {
  return runs.map((r) => {
    let t = r.t;
    if (r.v === "sub") t = `_${t}`;
    if (r.v === "sup") t = `^${t}`;
    // keep surrounding spaces outside the marks: "*Ebony and Topaz* (1927)", not "*Ebony and Topaz *"
    const [, lead, core, tail] = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
    let m = core;
    if (r.i && m) m = `*${m}*`;
    if (r.u && m) m = `⟦${m}⟧`;
    return lead + m + tail;
  }).join("");
}

export function createAssistant(ctx) {
  const { S, $, icon, esc, toast, ls, KEY } = ctx;
  let sample = null;
  let disabledReason = null;
  let threads = ls.get(KEY.chats, {});
  let threadId = null;
  let view = "chat";
  let ctl = null;
  let streaming = null;   // {threadId, text}
  let tier = ls.get(KEY.aiTier, null);

  const save = () => {
    const list = Object.values(threads).sort((a, b) => b.updated - a.updated);
    if (list.length > MAX_THREADS) for (const t of list.slice(MAX_THREADS)) delete threads[t.id];
    ls.set(KEY.chats, threads);
  };

  // ---------------------------------------------------------------- availability

  async function init() {
    try { sample = (await window.claude?.use?.("sample")) || null; } catch { sample = null; }
    if (!sample) return false;
    mount();
    document.body.classList.add("has-ai");
    ctx.onAvailable();
    return true;
  }
  const available = () => !!sample && !disabledReason;

  // ---------------------------------------------------------------- threads & context

  function refOf(id) {
    const [kind, ...rest] = id.split(":");
    return { kind, ref: rest.join(":") };
  }

  function titleFor(kind, ref) {
    if (kind === "q") {
      const q = S.set?.questions.find((x) => x.id === ref);
      return q ? `Вопрос ${q.n} · ${q.skill}` : `Вопрос ${ref}`;
    }
    if (kind === "w") return `Слово: ${ctx.vocabCard(ref)?.term || ref}`;
    return "Общий вопрос";
  }

  function ensureThread(id) {
    if (!threads[id]) {
      const { kind, ref } = refOf(id);
      threads[id] = { id, kind, ref, title: titleFor(kind, ref), messages: [], updated: Date.now() };
    }
    return threads[id];
  }

  function contextText(th) {
    if (th.kind === "q") {
      const q = S.set?.questions.find((x) => x.id === th.ref);
      if (!q) return "No question context (the question set is not loaded).";
      const pr = ctx.answerOf ? ctx.answerOf(q.id) : S.progress[q.id];
      const out = [
        `SAT ${q.section || "Reading and Writing"} question #${q.n} — ${q.domain} › ${q.skill}, difficulty ${q.difficulty || "unknown"}.`,
        "PASSAGE:\n" + q.stem.map((p) => marked(p.runs)).join("\n\n"),
      ];
      if (q.prompt) out.push("QUESTION: " + marked(q.prompt.runs));
      if (q.choices.length) out.push("CHOICES:\n" + q.choices.map((c) => `${c.letter}) ${marked(c.runs)}`).join("\n"));
      if (pr) {
        const how = pr.revealed ? "The student gave up and revealed the answer." : `The student chose ${pr.c}, which is ${pr.ok ? "correct" : "incorrect"}.`;
        out.push(`STATUS: answered. ${how} Correct answer: ${q.correct || q.correctText}.`);
        out.push("OFFICIAL EXPLANATION:\n" + q.rationale.map(plain).join("\n\n"));
      } else {
        out.push("STATUS: NOT answered yet — do not reveal or hint at the correct choice unless the student explicitly asks for the answer.");
      }
      return out.join("\n\n");
    }
    if (th.kind === "w") {
      const c = ctx.vocabCard(th.ref);
      if (!c) return `Vocabulary word: "${th.ref}".`;
      const ex = c.examples.slice(0, 2).map((e) => `- ${e.before}${e.term || c.term}${e.after}`).join("\n");
      return `Vocabulary flashcard the student is studying: "${c.term}".\nDefinition shown on the card: ${c.def || "none yet"}.\n${c.note ? `Student's own note: ${c.note}\n` : ""}${ex ? `Sentences where it appears in their SAT practice questions:\n${ex}` : ""}`;
    }
    return "General SAT preparation question (no specific question is open).";
  }

  function statusKind(th) {
    if (th.kind === "w") return "word";
    if (th.kind !== "q") return "general";
    const pr = ctx.answerOf ? ctx.answerOf(th.ref) : S.progress[th.ref];
    return !pr ? "todo" : pr.ok ? "right" : "wrong";
  }

  // ---------------------------------------------------------------- panel

  let panel, body, chips, input, form, fab;

  function mount() {
    fab = document.createElement("button");
    fab.className = "ai-fab";
    fab.dataset.action = "ai-open";
    fab.setAttribute("aria-label", "Спросить Claude");
    fab.innerHTML = `${icon("sparkles")}<span>Спросить Claude</span>`;
    panel = document.createElement("aside");
    panel.className = "ai-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Ассистент Claude");
    panel.innerHTML = `
      <header class="ai-head">
        <div class="ai-title"><span class="ai-mark">${icon("sparkles", "icon-sm")}</span><div><b>Claude</b><span id="ai-ctx"></span></div></div>
        <button class="icon-btn" data-action="ai-history" title="История" aria-label="История">${icon("history")}</button>
        <button class="icon-btn" data-action="ai-general" title="Общий вопрос" aria-label="Общий вопрос">${icon("plus")}</button>
        <button class="icon-btn" data-action="ai-close" title="Закрыть (Esc)" aria-label="Закрыть">${icon("x")}</button>
      </header>
      <div class="ai-body" id="ai-body"></div>
      <div class="ai-chips" id="ai-chips"></div>
      <form class="ai-form" id="ai-form">
        <textarea id="ai-input" rows="1" placeholder="Спросите про слово, вопрос или стратегию…" autocomplete="off"></textarea>
        <button class="ai-send" type="submit" aria-label="Отправить">${icon("arrowUp")}</button>
      </form>
      <div class="ai-foot">
        <div class="ai-tier" role="group" aria-label="Режим ответа">
          <button type="button" data-action="ai-tier" data-tier="quick">Быстро</button>
          <button type="button" data-action="ai-tier" data-tier="default">Подробно</button>
        </div>
        <span>Отвечает Claude через ваш аккаунт</span>
      </div>`;
    document.body.append(fab, panel);
    body = panel.querySelector("#ai-body");
    chips = panel.querySelector("#ai-chips");
    input = panel.querySelector("#ai-input");
    form = panel.querySelector("#ai-form");
    form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
      if (e.key === "Escape") close();
    });
    input.addEventListener("input", autosize);
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  const effectiveTier = (th) => tier || (th.kind === "q" ? "default" : "quick");

  function render() {
    if (!panel || panel.hidden) return;
    const th = threadId && threads[threadId] ? threads[threadId] : ensureThread(threadId || "g:general");
    panel.querySelector("#ai-ctx").textContent = view === "history" ? "История" : th.title;
    panel.querySelectorAll("[data-action=ai-tier]").forEach((b) => b.classList.toggle("active", b.dataset.tier === effectiveTier(th)));
    panel.classList.toggle("history", view === "history");
    if (view === "history") return renderHistory();

    const msgs = th.messages.map((m) => bubble(m.role, m.content, m.error)).join("");
    const live = streaming && streaming.threadId === th.id
      ? bubble("assistant", streaming.text, null, !streaming.text) : "";
    const intro = !th.messages.length && !live ? introHtml(th) : "";
    body.innerHTML = intro + msgs + live;
    const kind = statusKind(th);
    chips.innerHTML = disabledReason ? "" : (SUGGEST[kind] || []).map(([label, prompt]) =>
      `<button type="button" class="chip" data-action="ai-suggest" data-prompt="${esc(prompt)}">${esc(label)}</button>`).join("");
    chips.hidden = !!streaming || !!disabledReason;
    form.classList.toggle("busy", !!streaming);
    form.querySelector(".ai-send").innerHTML = streaming ? icon("stop") : icon("arrowUp");
    form.querySelector(".ai-send").setAttribute("aria-label", streaming ? "Остановить" : "Отправить");
    input.disabled = !!disabledReason;
    body.scrollTop = body.scrollHeight;
  }

  function introHtml(th) {
    if (disabledReason) return `<div class="ai-intro">${esc(disabledReason)}</div>`;
    if (th.kind === "q") {
      const answered = !!(ctx.answerOf ? ctx.answerOf(th.ref) : S.progress[th.ref]);
      return `<div class="ai-intro"><p>Спросите что угодно про этот вопрос: слово, перевод, логику ответа.</p>
        ${answered ? "" : "<p>Пока вы не ответили, Claude не будет подсказывать правильный вариант — только помогать рассуждать.</p>"}</div>`;
    }
    if (th.kind === "w") return `<div class="ai-intro"><p>Спросите про слово «${esc(ctx.vocabCard(th.ref)?.term || th.ref)}»: значение, перевод, примеры, как запомнить.</p></div>`;
    return `<div class="ai-intro"><p>Задайте любой вопрос о подготовке к SAT. Чтобы спросить про конкретный вопрос или слово, откройте его и нажмите «Спросить Claude».</p></div>`;
  }

  function bubble(role, content, error, thinking) {
    if (role === "user") return `<div class="msg user"><div class="bubble">${esc(content).replace(/\n/g, "<br>")}</div></div>`;
    return `<div class="msg ai"><div class="avatar">${icon("sparkles", "icon-sm")}</div>
      <div class="bubble md">${thinking ? `<span class="thinking"><i></i><i></i><i></i> Думаю…</span>` : md(content || "", esc)}
      ${error ? `<div class="msg-error">${esc(error)}</div>` : ""}</div></div>`;
  }

  function renderHistory() {
    const list = Object.values(threads).filter((t) => t.messages.length).sort((a, b) => b.updated - a.updated);
    chips.hidden = true;
    body.innerHTML = list.length
      ? `<div class="ai-hist">${list.map((t) => {
          const last = t.messages[t.messages.length - 1];
          const when = new Date(t.updated).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
          return `<div class="hist-row"><button class="hist-open" data-action="ai-thread" data-id="${esc(t.id)}">
              <b>${esc(t.title)}</b><span>${esc((last?.content || "").replace(/[*_`⟦⟧#]/g, "").slice(0, 110))}</span><small>${when} · ${t.messages.length} сообщ.</small></button>
              <button class="icon-btn" data-action="ai-del" data-id="${esc(t.id)}" aria-label="Удалить переписку">${icon("trash", "icon-sm")}</button></div>`;
        }).join("")}</div>`
      : `<div class="ai-intro"><p>Здесь появятся ваши переписки с Claude — по каждому вопросу и слову отдельно.</p></div>`;
  }

  function openThread(id, { focus = true } = {}) {
    threadId = id;
    ensureThread(id);
    view = "chat";
    panel.hidden = false;
    fab.hidden = true;
    document.body.classList.add("ai-open");
    render();
    if (focus && !matchMedia("(pointer: coarse)").matches) input.focus();
  }

  function close() {
    if (!panel) return;
    panel.hidden = true;
    fab.hidden = false;
    document.body.classList.remove("ai-open");
  }

  // Thread for what is on screen right now.
  function currentThreadId() {
    if (S.ui.view === "vocab") {
      const key = ctx.currentCardKey();
      return key ? `w:${key}` : "g:general";
    }
    const q = ctx.current();
    return q ? `q:${q.id}` : "g:general";
  }

  // ---------------------------------------------------------------- sending

  async function send(text, { threadOverride } = {}) {
    if (streaming) { ctl?.abort(); return; }
    text = String(text || "").trim();
    if (!text || !sample || disabledReason) return;
    const th = ensureThread(threadOverride || threadId || currentThreadId());
    threadId = th.id;
    th.messages.push({ role: "user", content: text, t: Date.now() });
    th.updated = Date.now();
    save();
    input.value = "";
    autosize();
    streaming = { threadId: th.id, text: "" };
    view = "chat";
    render();

    const turns = th.messages.slice(-MAX_TURNS).filter((m) => m.content && !m.error);
    while (turns.length && turns[0].role !== "user") turns.shift();
    const call = [{ role: "user", content: `${RULES}\n\nCONTEXT:\n${contextText(th)}` },
      ...turns.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }))];
    ctl = new AbortController();
    let lastPaint = 0;
    try {
      const { text: answer, truncated } = await sample(call, {
        modelTier: effectiveTier(th),
        cache: false,
        signal: ctl.signal,
        onText: ({ text: t }) => {
          streaming.text = t;
          const now = performance.now();
          if (now - lastPaint > 60) { lastPaint = now; paintStreaming(); }
        },
      });
      th.messages.push({ role: "assistant", content: answer + (truncated ? "\n\n*(ответ обрезан — попросите продолжить)*" : ""), t: Date.now() });
    } catch (e) {
      const partial = e?.text || streaming.text || "";
      if (e?.code === "cancelled") {
        if (partial) th.messages.push({ role: "assistant", content: partial + "\n\n*(остановлено)*", t: Date.now() });
      } else {
        const msg = ERRORS[e?.code] || "Не удалось получить ответ. Попробуйте ещё раз.";
        th.messages.push({ role: "assistant", content: e?.code === "refused" ? "" : partial, error: msg, t: Date.now() });
        if (FATAL.has(e?.code)) { disabledReason = ERRORS[e.code] || "Claude недоступен на этой странице."; }
      }
    } finally {
      streaming = null;
      ctl = null;
      th.updated = Date.now();
      save();
      render();
      ctx.onThreadsChanged();
    }
  }

  function paintStreaming() {
    const last = body.querySelector(".msg.ai:last-child .bubble");
    if (!last || !streaming) return render();
    last.innerHTML = md(streaming.text, esc);
    body.scrollTop = body.scrollHeight;
  }

  // ---------------------------------------------------------------- word definitions for flashcards

  async function define(term, sentence) {
    if (!available()) return undefined;
    const prompt = `Define the English word or phrase "${term}" for an SAT student, in the style of a learner's dictionary.
${sentence ? `It appears in this sentence: "${sentence}"\n` : ""}Reply with exactly one line in English and nothing else: its main meaning in plain words (or two short numbered meanings if the word has two common ones), at most 20 words. No translation, no quotes, no example.`;
    try {
      const { text } = await sample(prompt, { modelTier: "quick", cache: { gcTime: 86400000 } });
      return text.trim().split("\n")[0].replace(/^["“]|["”]$/g, "").slice(0, 200) || null;
    } catch (e) {
      if (FATAL.has(e?.code)) disabledReason = ERRORS[e.code] || "Claude недоступен на этой странице.";
      return undefined;
    }
  }

  // ---------------------------------------------------------------- actions

  const actions = {
    "ai-open": () => openThread(currentThreadId()),
    "ai-ask-question": () => { const q = ctx.current(); if (q) openThread(`q:${q.id}`); },
    "ai-ask-word": (el) => openThread(`w:${el.dataset.key}`),
    "ai-close": close,
    "ai-history": () => { view = view === "history" ? "chat" : "history"; render(); },
    "ai-general": () => openThread("g:general"),
    "ai-thread": (el) => openThread(el.dataset.id),
    "ai-del": async (el) => {
      if (!(await ctx.confirmDialog("Удалить переписку?", "Сообщения этой переписки будут удалены из браузера.", "Удалить", true))) return;
      delete threads[el.dataset.id];
      save();
      render();
      ctx.onThreadsChanged();
    },
    "ai-suggest": (el) => send(el.dataset.prompt),
    "ai-tier": (el) => { tier = el.dataset.tier; ls.set(KEY.aiTier, tier); render(); },
  };

  // Explain a word the student selected in the question text.
  function explainSelection(term, sentence) {
    const id = currentThreadId();
    openThread(id, { focus: false });
    send(`Объясни «${term}» в этом контексте${sentence ? `: "${sentence}"` : ""}.`, { threadOverride: id });
  }

  // Keep the open chat on what the student is looking at.
  function follow() {
    if (!panel || panel.hidden || streaming || view !== "chat") return;
    const id = currentThreadId();
    const th = threads[threadId];
    if (id !== threadId && (!th || th.kind !== "g")) { threadId = id; ensureThread(id); render(); }
  }

  const hasThread = (id) => !!threads[id]?.messages.length;

  function merge(incoming) {
    if (!incoming || typeof incoming !== "object") return 0;
    let n = 0;
    for (const [id, t] of Object.entries(incoming)) {
      if (!t?.messages) continue;
      if (!threads[id] || (t.updated || 0) > (threads[id].updated || 0)) { threads[id] = t; n++; }
    }
    save();
    return n;
  }

  function wipe() { threads = {}; ls.del(KEY.chats); close(); }

  return {
    init, available, actions, explainSelection, follow, hasThread, define, merge, wipe, close,
    isOpen: () => !!panel && !panel.hidden,
    threads: () => threads,
  };
}
