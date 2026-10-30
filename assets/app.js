(function () {
  const LANGS = [
    { id: "c",   label: "C",          short: "C",   prism: "c", dir: "c" },
    { id: "cpp", label: "C++",        short: "C++", prism: "cpp", dir: "cpp" },
    { id: "cs",  label: "C#",         short: "C#",  prism: "csharp", dir: "csharp" },
    { id: "js",  label: "JavaScript", short: "JS",  prism: "javascript", dir: "javascript" },
    { id: "py",  label: "Python",     short: "Py",  prism: "python", dir: "python" }
  ];
  const LANG = Object.fromEntries(LANGS.map(l => [l.id, l]));
  const ALIAS = {
    "c": "c", "c++": "cpp", "cpp": "cpp", "cplusplus": "cpp",
    "c#": "cs", "csharp": "cs", "cs": "cs", "dotnet": "cs", ".net": "cs",
    "js": "js", "javascript": "js", "node": "js", "nodejs": "js",
    "py": "py", "python": "py", "python3": "py"
  };
  const DATA = JSON.parse(document.getElementById("sf-data").textContent);
  const { CATS, TASKS, NOTES, RUN } = DATA;
  TASKS.forEach((t, i) => { t.order = i; });
  const byId = Object.fromEntries(TASKS.map(t => [t.id, t]));
  TASKS.forEach(t => {
    t.h = { title: t.title.toLowerCase(), tags: t.tags.join(" | ").toLowerCase(), cat: t.cat.toLowerCase(), desc: t.desc.toLowerCase(), codeBy: {} };
    for (const l in t.code) t.h.codeBy[l] = t.code[l].toLowerCase();
    t.h.codeAll = Object.values(t.h.codeBy).join("\n");
  });
  const SNIPPETS = TASKS.reduce((n, t) => n + Object.keys(t.code).length, 0);

  // ---- Helpers ----
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const has = (hay, tok) => hay.includes(tok) || (tok.length > 3 && tok.endsWith("s") && hay.includes(tok.slice(0, -1)));
  const startsWord = (hay, tok) => { const i = hay.indexOf(tok); return i === 0 || (i > 0 && /[^a-z0-9]/.test(hay[i - 1])); };

  function hl(text, tokens) {
    const toks = tokens.filter(t => t.length > 1);
    if (!toks.length) return esc(text);
    const low = text.toLowerCase(), ranges = [];
    for (const tok of toks) {
      for (const v of [tok, tok.endsWith("s") && tok.length > 3 ? tok.slice(0, -1) : null]) {
        if (!v) continue;
        let i = 0;
        while ((i = low.indexOf(v, i)) !== -1) { ranges.push([i, i + v.length]); i += v.length; }
      }
    }
    if (!ranges.length) return esc(text);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice());
    }
    let out = "", pos = 0;
    for (const [a, b] of merged) { out += esc(text.slice(pos, a)) + "<mark>" + esc(text.slice(a, b)) + "</mark>"; pos = b; }
    return out + esc(text.slice(pos));
  }

  const hlCache = {};
  function highlight(code, lang, key) {
    if (hlCache[key]) return hlCache[key];
    const P = window.Prism, name = LANG[lang].prism;
    let out;
    try { out = (P && P.languages && P.languages[name]) ? P.highlight(code, P.languages[name], name) : esc(code); }
    catch (e) { out = esc(code); }
    return (hlCache[key] = out);
  }

  const fileName = (t, l) => l === "cs" ? "Program.cs" : t.file + ({ c: ".c", cpp: ".cpp", js: ".mjs", py: ".py" }[l]);
  function runCmd(t, l) {
    if (RUN[t.id] && RUN[t.id][l]) return RUN[t.id][l];
    const f = t.file;
    return {
      c: `gcc ${f}.c -o ${f} && ./${f}`,
      cpp: `g++ -std=c++17 ${f}.cpp -o ${f} && ./${f}`,
      cs: "dotnet run",
      js: `node ${f}.mjs`,
      py: `python3 ${f}.py`
    }[l];
  }

  // ---- State ----
  const savedLang = store.get("sf-lang");
  const state = {
    q: "",
    lang: savedLang && (savedLang === "all" || LANG[savedLang]) ? savedLang : "all",
    cat: "all",
    sel: null,
    tab: LANG[store.get("sf-tab")] ? store.get("sf-tab") : "py"
  };
  let lastLang = null, current = { results: [] };

  const q = $("#q"), list = $("#list"), detail = $("#detail"), meta = $("#meta"), langsEl = $("#langs"), catsEl = $("#cats");
  $("#lede").textContent = `${SNIPPETS} copy-ready snippets for ${TASKS.length} everyday tasks in C, C++, C#, JavaScript and Python. Type what you need.`;

  function search() {
    const raw = state.q.toLowerCase().trim();
    let qLang = null;
    const tokens = raw.split(/\s+/).filter(Boolean).filter(tok => {
      if (ALIAS[tok]) { qLang = ALIAS[tok]; return false; }
      return true;
    });
    const lang = qLang || (state.lang !== "all" ? state.lang : null);
    const base = [];
    for (const t of TASKS) {
      if (state.cat !== "all" && t.cat !== state.cat) continue;
      let total = 0, ok = true;
      for (const tok of tokens) {
        const h = t.h;
        let s = 0;
        if (has(h.title, tok)) s += startsWord(h.title, tok) ? 14 : 9;
        if (has(h.tags, tok)) s += 6;
        if (has(h.cat, tok)) s += 4;
        if (has(h.desc, tok)) s += 2;
        if (!s && has(lang ? (h.codeBy[lang] || "") : h.codeAll, tok)) s = 1;
        if (!s) { ok = false; break; }
        total += s;
      }
      if (ok) base.push({ t, score: total });
    }
    if (tokens.length) base.sort((a, b) => b.score - a.score || a.t.order - b.t.order);
    const counts = { all: base.length };
    LANGS.forEach(l => { counts[l.id] = base.filter(r => r.t.code[l.id]).length; });
    const results = (lang ? base.filter(r => r.t.code[lang]) : base).map(r => r.t);
    return { results, counts, tokens, lang, qLang };
  }

  function render(opts = {}) {
    const t0 = performance.now();
    const r = search();
    const ms = performance.now() - t0;
    current = r;
    if (r.lang && r.lang !== lastLang) state.tab = r.lang;
    lastLang = r.lang;
    if (opts.resetSel || !r.results.some(t => t.id === state.sel)) state.sel = r.results[0] ? r.results[0].id : null;

    // Languages
    const langBtns = [`<button type="button" class="pill" data-lang="all" aria-pressed="${!r.lang}">All <span class="n">${r.counts.all}</span></button>`]
      .concat(LANGS.map(l => `<button type="button" class="pill${r.counts[l.id] ? "" : " zero"}" data-lang="${l.id}" aria-pressed="${r.lang === l.id}" style="--lc:var(--l-${l.id})"><span class="dot"></span>${l.label} <span class="n">${r.counts[l.id]}</span></button>`));
    langsEl.innerHTML = langBtns.join("");

    // Categories
    catsEl.innerHTML = [`<button type="button" class="pill sm" data-cat="all" aria-pressed="${state.cat === "all"}">All topics</button>`]
      .concat(CATS.map(c => `<button type="button" class="pill sm" data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${esc(c)}</button>`)).join("");

    // Meta
    const n = r.results.length;
    meta.innerHTML = `<span>${n} ${n === 1 ? "task" : "tasks"}${r.lang ? " in " + esc(LANG[r.lang].label) : ""}${r.qLang ? " (from your search)" : ""}</span><span>${ms < 0.1 ? "&lt;0.1" : ms.toFixed(1)} ms</span>`;

    // List
    if (!n) {
      list.innerHTML = `<li class="none"><span>No snippets match “${esc(state.q)}”${state.cat !== "all" ? " in " + esc(state.cat) : ""}. Try one word, like <b>file</b> or <b>sort</b>, or <a href="ai.html?q=${encodeURIComponent(state.q)}">ask the AI to write it</a>.</span><button type="button" class="btn" data-clear>Clear search and filters</button></li>`;
    } else {
      list.innerHTML = r.results.map(t => {
        const badges = LANGS.map(l => `<span class="b${t.code[l.id] ? " on" : ""}${r.lang === l.id ? " cur" : ""}" style="--lc:var(--l-${l.id})" title="${t.code[l.id] ? l.label : "No " + l.label + " version"}">${esc(l.short)}</span>`).join("");
        return `<li><button type="button" class="item" role="option" data-id="${t.id}" aria-selected="${t.id === state.sel}"><span class="t">${hl(t.title, r.tokens)}</span><span class="sub"><span>${esc(t.cat)}</span><span class="badges">${badges}</span></span></button></li>`;
      }).join("");
    }
    renderDetail();
  }

  function currentTab(t) {
    if (t.code[state.tab]) return state.tab;
    return LANGS.find(l => t.code[l.id]).id;
  }

  function renderDetail() {
    const t = byId[state.sel];
    if (!t) {
      detail.innerHTML = `<div class="dhead"><span class="eyebrow">Nothing selected</span><h2>No matching snippet</h2><p class="desc">Change the search or pick another language to see code here.</p></div>`;
      return;
    }
    const tab = currentTab(t);
    const code = t.code[tab];
    const notes = [];
    if ((tab === "c" || tab === "cpp") && !/\bmain\s*\(/.test(code)) notes.push("Function only. Call it from your own main() before building.");
    if (tab === "cs") notes.push("Paste into Program.cs of a console app (dotnet new console). Needs .NET 6 or later.");
    if (NOTES[t.id] && NOTES[t.id][tab]) notes.push(NOTES[t.id][tab]);

    const tabs = LANGS.map(l => {
      const ok = !!t.code[l.id];
      return `<button type="button" class="tab" role="tab" data-tab="${l.id}" aria-selected="${l.id === tab}" style="--lc:var(--l-${l.id})" ${ok ? "" : `disabled title="No ${esc(l.label)} version"`}>${esc(fileName(t, l.id))}</button>`;
    }).join("");

    detail.innerHTML = `
      <div class="dhead">
        <span class="eyebrow">${esc(t.cat)} · ${esc(LANG[tab].label)}</span>
        <h2>${esc(t.title)}</h2>
        <p class="desc">${esc(t.desc)}</p>
      </div>
      <div class="editor">
        <div class="ehead">
          <div class="tabs" role="tablist" aria-label="Language versions">${tabs}</div>
          <button type="button" class="copy" data-copy aria-label="Copy ${esc(LANG[tab].label)} code"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>Copy</button>
        </div>
        <pre class="code" id="code"><code class="language-${LANG[tab].prism}">${highlight(code, tab, t.id + ":" + tab)}</code></pre>
      </div>
      <div class="lower">
        <div>
          <div class="label">Build &amp; run</div>
          <code class="cmd">${esc(runCmd(t, tab))}</code>
          ${notes.length ? `<ul class="notes">${notes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        </div>
        <div>
          <div class="label">Permanent link</div>
          <a class="pagelink" href="${LANG[tab].dir}/${t.id}.html">${esc(t.title)} in ${esc(LANG[tab].label)} →</a>
        </div>
        <div>
          <div class="label">Related searches</div>
          <div class="tags">${t.tags.map(g => `<button type="button" class="tag" data-q="${esc(g)}">${esc(g)}</button>`).join("")}</div>
        </div>
      </div>`;
  }

  // ---- Copy & toast ----
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
  }
  function selectCode() {
    const pre = document.getElementById("code");
    if (!pre) return;
    const range = document.createRange();
    range.selectNodeContents(pre);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function copyCurrent() {
    const t = byId[state.sel];
    if (!t) return;
    const tab = currentTab(t);
    const done = () => toast(`Copied ${LANG[tab].label}: ${t.title}`);
    const fail = () => { selectCode(); toast("Code selected. Press Ctrl+C (⌘C) to copy."); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.code[tab]).then(done, fail);
      else fail();
    } catch (e) { fail(); }
  }

  // ---- Events ----
  const narrow = () => window.matchMedia("(max-width: 899px)").matches;
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function setQuery(v) { q.value = v; state.q = v; render({ resetSel: true }); }
  function stripAliases(s) { return s.split(/\s+/).filter(w => w && !ALIAS[w.toLowerCase()]).join(" "); }

  q.addEventListener("input", () => { state.q = q.value; render({ resetSel: true }); });

  langsEl.addEventListener("click", e => {
    const b = e.target.closest("[data-lang]");
    if (!b) return;
    state.lang = b.dataset.lang;
    store.set("sf-lang", state.lang);
    if (current.qLang) { q.value = stripAliases(q.value); state.q = q.value; }
    if (state.lang !== "all") { state.tab = state.lang; store.set("sf-tab", state.tab); }
    render();
  });

  catsEl.addEventListener("click", e => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    state.cat = b.dataset.cat;
    render({ resetSel: true });
  });

  $("#try").addEventListener("click", e => {
    const b = e.target.closest("[data-q]");
    if (b) { setQuery(b.dataset.q); q.focus(); }
  });

  list.addEventListener("click", e => {
    if (e.target.closest("[data-clear]")) {
      state.cat = "all"; state.lang = "all"; store.set("sf-lang", "all");
      setQuery(""); q.focus(); return;
    }
    const b = e.target.closest("[data-id]");
    if (!b) return;
    state.sel = b.dataset.id;
    render();
    if (narrow()) detail.scrollIntoView({ behavior: reduce() ? "auto" : "smooth", block: "start" });
  });

  detail.addEventListener("click", e => {
    const tb = e.target.closest("[data-tab]");
    if (tb && !tb.disabled) {
      state.tab = tb.dataset.tab;
      store.set("sf-tab", state.tab);
      renderDetail();
      const again = detail.querySelector(`[data-tab="${state.tab}"]`);
      if (again) again.focus();
      return;
    }
    if (e.target.closest("[data-copy]")) { copyCurrent(); return; }
    const tg = e.target.closest("[data-q]");
    if (tg) { setQuery(tg.dataset.q); window.scrollTo({ top: 0, behavior: reduce() ? "auto" : "smooth" }); q.focus(); }
  });

  function move(delta) {
    const res = current.results;
    if (!res.length) return;
    let i = res.findIndex(t => t.id === state.sel);
    i = Math.max(0, Math.min(res.length - 1, i + delta));
    state.sel = res[i].id;
    render();
    const el = list.querySelector(`[data-id="${state.sel}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  document.addEventListener("keydown", e => {
    const inField = e.target === q;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault(); q.focus(); q.select(); return;
    }
    if (inField) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); copyCurrent(); }
      else if (e.key === "Escape") { if (q.value) { e.preventDefault(); setQuery(""); } else q.blur(); }
    }
  });

  // ---- Start ----
  try {
    const pq = new URLSearchParams(location.search).get("q");
    if (pq) { q.value = pq; state.q = pq; }
  } catch (e) {}
  const hash = (location.hash || "").slice(1);
  if (byId[hash]) state.sel = hash;
  render();
})();
