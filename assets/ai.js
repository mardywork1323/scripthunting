/* ScriptHunting AI script helper (chat page). */
(function () {
  "use strict";
  var CFG = window.SH_CONFIG || {};
  var SH = window.SH || {};
  var AI = (CFG.aiUrl || "").replace(/\/+$/, "");
  var LIMITS = CFG.limits || { guest: 3, free: 10 };
  var esc = SH.esc || function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var store = SH.store || { get: function () { return null; }, set: function () {} };
  var $ = function (s) { return document.querySelector(s); };

  var log = $("#log"), form = $("#composer"), input = $("#prompt"), sendBtn = $("#send"), meter = $("#meter"), startCard = $("#start");
  var KEY = "sh-ai-chat-v1";
  var chat = [];           // [{ role, content, sources, note }]
  var busy = false, ctrl = null, codeSeq = 0;
  var demo = !AI;

  /* ---------- languages for code blocks ---------- */
  var LANGS = {
    c: ["c", "C", "--l-c", ".c"], h: ["c", "C", "--l-c", ".h"],
    cpp: ["cpp", "C++", "--l-cpp", ".cpp"], "c++": ["cpp", "C++", "--l-cpp", ".cpp"], hpp: ["cpp", "C++", "--l-cpp", ".hpp"],
    cs: ["csharp", "C#", "--l-cs", ".cs"], csharp: ["csharp", "C#", "--l-cs", ".cs"], "c#": ["csharp", "C#", "--l-cs", ".cs"],
    js: ["javascript", "JavaScript", "--l-js", ".js"], javascript: ["javascript", "JavaScript", "--l-js", ".js"], mjs: ["javascript", "JavaScript", "--l-js", ".mjs"], jsx: ["javascript", "JavaScript", "--l-js", ".jsx"],
    ts: ["typescript", "TypeScript", "--l-js", ".ts"], typescript: ["typescript", "TypeScript", "--l-js", ".ts"],
    py: ["python", "Python", "--l-py", ".py"], python: ["python", "Python", "--l-py", ".py"],
    java: ["java", "Java", "--l-cpp", ".java"], kotlin: ["kotlin", "Kotlin", "--l-cs", ".kt"],
    lua: ["lua", "Lua", "--l-c", ".lua"], luau: ["lua", "Luau", "--l-c", ".luau"],
    gdscript: ["gdscript", "GDScript", "--l-py", ".gd"], gd: ["gdscript", "GDScript", "--l-py", ".gd"],
    json: ["json", "JSON", "--l-js", ".json"], html: ["markup", "HTML", "--l-js", ".html"], xml: ["markup", "XML", "--l-js", ".xml"],
    css: ["css", "CSS", "--l-cs", ".css"], bash: ["bash", "Shell", "--l-c", ".sh"], sh: ["bash", "Shell", "--l-c", ".sh"], shell: ["bash", "Shell", "--l-c", ".sh"],
    powershell: ["powershell", "PowerShell", "--l-c", ".ps1"], sql: ["sql", "SQL", "--l-cs", ".sql"], yaml: ["yaml", "YAML", "--l-c", ".yml"]
  };
  function highlight(code, prism) {
    var P = window.Prism;
    try { if (P && P.languages && P.languages[prism]) return P.highlight(code, P.languages[prism], prism); } catch (e) {}
    return esc(code);
  }

  /* ---------- tiny, safe markdown renderer (everything is escaped first) ---------- */
  function inline(s) {
    return s.split(/(`[^`\n]+`)/).map(function (part) {
      if (/^`[^`]+`$/.test(part)) return "<code>" + esc(part.slice(1, -1)) + "</code>";
      var t = esc(part);
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, txt, url) {
        return '<a href="' + url + '" target="_blank" rel="noopener nofollow">' + txt + "</a>";
      });
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
      return t;
    }).join("");
  }
  function codeBlock(code, lang, name, streaming) {
    var L = LANGS[(lang || "").toLowerCase()] || ["", lang ? lang.toUpperCase() : "Code", "--l-c", ".txt"];
    var label = name || (L[1] + " code");
    var id = "code" + (++codeSeq);
    return '<div class="editor ai-code"><div class="ehead"><div class="tabs"><span class="tab" aria-current="page" style="--lc:var(' + L[2] + ')">' + esc(label) + "</span></div>" +
      (streaming ? '<span class="writing">Writing…</span>' : '<button type="button" class="copy" data-copy-ai="' + id + '" aria-label="Copy ' + esc(label) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>Copy</button>') +
      '</div><pre class="code" id="' + id + '"><code>' + highlight(code, L[0]) + "</code></pre></div>";
  }
  function md(src) {
    var lines = String(src || "").replace(/\r/g, "").split("\n");
    var out = [], para = [], list = null, pendingFile = null, i = 0;
    function flushPara() { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } }
    function flushList() {
      if (!list) return;
      out.push("<" + list.type + ">" + list.items.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + "</" + list.type + ">");
      list = null;
    }
    while (i < lines.length) {
      var line = lines[i];
      var fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w#+.-]*)/);
      if (fence) {
        flushPara(); flushList();
        var mark = fence[1].charAt(0), lang = fence[2], code = [];
        i++;
        while (i < lines.length && !new RegExp("^\\s*\\" + mark + "{3,}\\s*$").test(lines[i])) { code.push(lines[i]); i++; }
        var closed = i < lines.length;
        i++;
        var name = null;
        if (pendingFile && pendingFile.at === out.length - 1) { name = pendingFile.name; out.pop(); }
        pendingFile = null;
        out.push(codeBlock(code.join("\n"), lang, name, !closed));
        continue;
      }
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara(); flushList();
        var lvl = Math.min(4, h[1].length + 1), text = h[2].replace(/#+\s*$/, "").trim();
        var bare = text.replace(/[`*]/g, "").trim();
        out.push("<h" + lvl + ">" + inline(text) + "</h" + lvl + ">");
        pendingFile = /^[\w./\\-]+\.[A-Za-z0-9]{1,8}$/.test(bare) ? { at: out.length - 1, name: bare } : null;
        i++; continue;
      }
      var li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
      if (li) {
        flushPara();
        var type = /\d/.test(li[1]) ? "ol" : "ul";
        if (!list || list.type !== type) { flushList(); list = { type: type, items: [] }; }
        list.items.push(li[2]);
        i++; continue;
      }
      if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += " " + line.trim(); i++; continue; }
      if (!line.trim()) { flushPara(); if (list && !(lines[i + 1] && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1]))) flushList(); i++; continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push("<hr>"); i++; continue; }
      if (/^\s*>/.test(line)) { flushPara(); flushList(); out.push("<blockquote>" + inline(line.replace(/^\s*>\s?/, "")) + "</blockquote>"); i++; continue; }
      flushList();
      para.push(line.trim());
      i++;
    }
    flushPara(); flushList();
    return out.join("");
  }

  /* ---------- rendering ---------- */
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }
  function sourcesHtml(list) {
    if (!list || !list.length) return "";
    return '<div class="sources"><div class="label">Found on the web</div><ul>' + list.slice(0, 6).map(function (s) {
      return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener nofollow"><span class="src-title">' + esc(s.title || s.url) + '</span><span class="src-host">' + esc(hostOf(s.url)) + "</span></a></li>";
    }).join("") + "</ul></div>";
  }
  var CHIPS = [
    ["Improve it", "Improve this script. Pick the most useful upgrades, then send the full updated script."],
    ["Explain how it works", "Explain how this script works, step by step, for a beginner."],
    ["Convert to another language", null],
    ["Find similar projects online", "Search the web for similar projects, tutorials and examples for what I'm building, and list the best ones with links."]
  ];
  function msgHtml(m, i, isLast) {
    if (m.role === "user") return '<article class="msg user"><div class="bubble">' + esc(m.content).replace(/\n/g, "<br>") + "</div></article>";
    var hasCode = /```/.test(m.content || "");
    var status = m.status ? '<div class="status"><span class="spin" aria-hidden="true"></span>' + esc(m.status) + "</div>" : "";
    var note = m.note ? '<div class="note ' + (m.noteKind || "") + '">' + m.note + "</div>" : "";
    var chips = isLast && !busy && hasCode && !m.demo ? '<div class="chips" aria-label="Next steps">' + CHIPS.map(function (c, j) { return '<button type="button" class="chip" data-chip="' + j + '">' + esc(c[0]) + "</button>"; }).join("") + "</div>" : "";
    return '<article class="msg ai" data-i="' + i + '"><div class="who"><span class="ai-mark" aria-hidden="true"></span>ScriptHunting AI' + (m.demo ? ' <span class="tag-ex">Example</span>' : "") + "</div>" +
      status + '<div class="md">' + md(m.content || "") + "</div>" + sourcesHtml(m.sources) + note + chips + "</article>";
  }
  function render() {
    codeSeq = 0;
    var list = demo && !chat.length ? DEMO : chat;
    log.innerHTML = list.map(function (m, i) { return msgHtml(m, i, i === list.length - 1); }).join("");
    startCard.hidden = !!chat.length || demo;
    $("#newchat").hidden = !chat.length;
    document.body.classList.toggle("has-chat", !!chat.length);
  }
  var raf = 0;
  function renderLastSoon() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var el = log.lastElementChild, i = chat.length - 1;
      if (!el || !chat[i] || chat[i].role !== "assistant") { render(); return; }
      var tmp = document.createElement("div");
      tmp.innerHTML = msgHtml(chat[i], i, true);
      el.replaceWith(tmp.firstChild);
      if (nearBottom) window.scrollTo(0, document.documentElement.scrollHeight);
    });
  }
  var nearBottom = true;
  window.addEventListener("scroll", function () {
    nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
  }, { passive: true });

  function save() { try { localStorage.setItem(KEY, JSON.stringify(chat.slice(-30))); } catch (e) {} }
  function loadSaved() { try { var c = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(c) ? c : []; } catch (e) { return []; } }

  /* ---------- usage meter ---------- */
  var status = null;
  function meterText(s) {
    if (demo) return '<span class="dot-off"></span>The AI helper is being connected';
    if (!s) return '<span class="dot-wait"></span>Checking your prompts…';
    if (s.limit == null) return '<span class="dot-on"></span>' + esc(s.planLabel) + " plan · no daily limit";
    var left = Math.max(0, s.remaining);
    var extra = !s.signedIn ? ' · <button type="button" class="linkish" data-signin-inline>Sign in for ' + LIMITS.free + "</button>"
      : s.plan === "free" ? ' · <a href="plans.html">Get more</a>' : "";
    return '<span class="' + (left ? "dot-on" : "dot-off") + '"></span><b>' + left + "</b> of " + s.limit + " prompts left today" + extra;
  }
  function paintMeter() { meter.innerHTML = meterText(status); SH.planLabel = status && status.signedIn ? status.planLabel + " plan" : null; }
  function refreshStatus() {
    if (demo) { paintMeter(); return; }
    authHeaders().then(function (h) {
      return fetch(AI + "/me", { headers: h });
    }).then(function (r) { return r.json(); }).then(function (s) { status = s; paintMeter(); })
      .catch(function () { status = null; meter.innerHTML = '<span class="dot-off"></span>Can\'t reach the AI right now'; });
  }
  function authHeaders() {
    return (SH.auth ? SH.auth.token() : Promise.resolve(null)).then(function (t) {
      var h = { "Content-Type": "application/json" };
      if (t) h.Authorization = "Bearer " + t;
      return h;
    });
  }

  /* ---------- sending ---------- */
  function setBusy(b) {
    busy = b;
    sendBtn.textContent = b ? "Stop" : "Send";
    sendBtn.classList.toggle("stop", b);
    sendBtn.setAttribute("aria-label", b ? "Stop the reply" : "Send");
  }
  function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    if (demo) { SH.toast && SH.toast("The AI helper isn't connected yet. It goes live soon."); return; }
    chat.push({ role: "user", content: text });
    var ai = { role: "assistant", content: "", sources: [], status: "Thinking…" };
    chat.push(ai);
    input.value = "";
    autosize();
    setBusy(true);
    nearBottom = true;
    render();
    window.scrollTo(0, document.documentElement.scrollHeight);

    var history = chat.slice(0, -1).filter(function (m) { return !m.failed && m.content; }).map(function (m) { return { role: m.role, content: m.content }; });
    ctrl = new AbortController();
    authHeaders().then(function (h) {
      var wantsSearch = /\b(search|find|similar|tutorials?|examples? online|on the web|online|links?|docs|documentation)\b/i.test(text);
      return fetch(AI + "/chat", { method: "POST", headers: h, body: JSON.stringify({ messages: history, search: wantsSearch }), signal: ctrl.signal });
    }).then(function (res) {
      var used = res.headers.get("x-sh-used"), limit = res.headers.get("x-sh-limit");
      if (res.ok && status && used) {
        status.used = Number(used);
        status.remaining = limit === "unlimited" ? null : Math.max(0, Number(limit) - Number(used));
        paintMeter();
      }
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          ai.status = null; ai.failed = true;
          chat[chat.length - 2].failed = true;
          if (res.status === 429 && j.error === "limit_reached") {
            ai.note = esc(j.message || "You've reached today's limit.") +
              '<div class="note-actions">' + (j.signedIn ? "" : '<button type="button" class="btn" data-signin-inline>Sign in free</button>') +
              '<a class="btn primary" href="plans.html">See plans</a></div>';
            ai.noteKind = "limit";
            if (j.plan) { status = j; paintMeter(); }
          } else {
            ai.note = esc(j.message || "Something went wrong. Try again.") + '<div class="note-actions"><button type="button" class="btn" data-retry>Try again</button></div>';
            ai.noteKind = "error";
          }
        });
      }
      return readStream(res, ai);
    }).catch(function (e) {
      ai.status = null;
      if (e && e.name === "AbortError") { ai.note = "Stopped."; ai.noteKind = "muted"; if (!ai.content) { ai.failed = true; chat[chat.length - 2].failed = true; } }
      else { ai.failed = true; chat[chat.length - 2].failed = true; ai.note = "Couldn't reach the AI. Check your connection and try again." + '<div class="note-actions"><button type="button" class="btn" data-retry>Try again</button></div>'; ai.noteKind = "error"; }
    }).then(function () {
      ai.status = null;
      setBusy(false);
      ctrl = null;
      save();
      render();
      if (!status || status.limit == null) refreshStatus();
    });
  }

  function readStream(res, ai) {
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = "";
    var blocks = {};       // index -> { type, json }
    var seen = {};
    function addSource(url, title) {
      if (!url || seen[url]) return;
      seen[url] = 1;
      ai.sources.push({ url: url, title: title });
    }
    function handle(ev) {
      var t = ev.type;
      if (t === "content_block_start") {
        var b = ev.content_block || {};
        blocks[ev.index] = { type: b.type, json: "" };
        if (b.type === "server_tool_use") ai.status = "Searching the web…";
        if (b.type === "web_search_tool_result") {
          if (Array.isArray(b.content)) {
            ai.status = "Reading " + b.content.length + " results…";
            ai._results = (ai._results || []).concat(b.content.filter(function (r) { return r && r.url; }).map(function (r) { return { url: r.url, title: r.title }; }));
          }
        }
        if (b.type === "text") ai.status = ai.content ? null : "Writing…";
      } else if (t === "content_block_delta") {
        var d = ev.delta || {};
        if (d.type === "text_delta") { ai.content += d.text; ai.status = null; }
        else if (d.type === "input_json_delta" && blocks[ev.index]) {
          blocks[ev.index].json += d.partial_json || "";
          var q = blocks[ev.index].json.match(/"query"\s*:\s*"((?:[^"\\]|\\.)*)/);
          if (q) ai.status = "Searching the web for “" + q[1].replace(/\\"/g, '"') + "”";
        } else if (d.type === "citations_delta" && d.citation) addSource(d.citation.url, d.citation.title);
      } else if (t === "message_delta") {
        var sr = ev.delta && ev.delta.stop_reason;
        if (sr === "max_tokens") { ai.note = "The reply hit the length limit."; ai.noteKind = "muted"; ai.cont = true; }
        if (sr === "pause_turn") { ai.note = "The AI paused while searching."; ai.noteKind = "muted"; ai.cont = true; }
        if (sr === "refusal") { ai.note = "The AI can't help with that request."; ai.noteKind = "muted"; }
      } else if (t === "error") {
        var msg = ev.error && ev.error.type === "overloaded_error" ? "The AI is busy right now. Try again in a moment." : "The reply was cut off. Try again.";
        ai.note = msg + '<div class="note-actions"><button type="button" class="btn" data-retry>Try again</button></div>';
        ai.noteKind = "error";
      }
      renderLastSoon();
    }
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) { finish(); return; }
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split(/\n\n/);
        buf = parts.pop();
        parts.forEach(function (chunk) {
          var data = chunk.split("\n").filter(function (l) { return l.indexOf("data:") === 0; }).map(function (l) { return l.slice(5).trim(); }).join("");
          if (!data) return;
          try { handle(JSON.parse(data)); } catch (e) {}
        });
        return pump();
      });
    }
    function finish() {
      // If the reply didn't cite anything, show the top search results it read.
      if (!ai.sources.length && ai._results) ai._results.slice(0, 4).forEach(function (r) { addSource(r.url, r.title); });
      delete ai._results;
      if (ai.cont) ai.note = (ai.note || "") + '<div class="note-actions"><button type="button" class="btn" data-continue>Continue</button></div>';
      if (!ai.content && !ai.note) { ai.failed = true; ai.note = "No answer came back. Try again." + '<div class="note-actions"><button type="button" class="btn" data-retry>Try again</button></div>'; ai.noteKind = "error"; }
    }
    return pump();
  }

  /* ---------- events ---------- */
  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 260) + "px"; }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) { if (ctrl) ctrl.abort(); return; }
    send(input.value);
  });

  // Start card: language chips + two fields compose the first message.
  var pickedLang = null;
  $("#langpick").addEventListener("click", function (e) {
    var b = e.target.closest("[data-lang]");
    if (!b) return;
    pickedLang = b.getAttribute("aria-pressed") === "true" ? null : b.getAttribute("data-lang");
    this.querySelectorAll("[data-lang]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b && !!pickedLang)); });
  });
  $("#startform").addEventListener("submit", function (e) {
    e.preventDefault();
    var project = $("#s-project").value.trim(), what = $("#s-what").value.trim();
    if (!what) { $("#s-what").focus(); SH.toast && SH.toast("Describe what the script should do."); return; }
    var msg = (project ? "I'm making " + project + ". " : "") + (pickedLang ? "Language or engine: " + pickedLang + ". " : "") + "I need a script that " + what.replace(/^i need a script (that|to)\s*/i, "");
    send(msg);
  });
  document.addEventListener("click", function (e) {
    var ex = e.target.closest("[data-example]");
    if (ex) { input.value = ex.getAttribute("data-example"); autosize(); input.focus(); return; }
    var c = e.target.closest("[data-chip]");
    if (c) {
      var chip = CHIPS[Number(c.getAttribute("data-chip"))];
      if (chip[1]) send(chip[1]);
      else { input.value = "Convert this script to "; autosize(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      return;
    }
    if (e.target.closest("[data-retry]")) {
      var lastUser = null;
      for (var i = chat.length - 1; i >= 0; i--) if (chat[i].role === "user") { lastUser = chat[i].content; break; }
      while (chat.length && chat[chat.length - 1].failed) chat.pop();
      if (chat.length && chat[chat.length - 1].role === "user" && chat[chat.length - 1].content === lastUser) chat.pop();
      render();
      send(lastUser);
      return;
    }
    if (e.target.closest("[data-continue]")) { send("Continue from where you stopped."); return; }
    if (e.target.closest("[data-signin-inline]")) { e.preventDefault(); SH.auth && SH.auth.signIn(); return; }
    var cp = e.target.closest("[data-copy-ai]");
    if (cp) {
      var pre = document.getElementById(cp.getAttribute("data-copy-ai"));
      var done = function () { SH.toast && SH.toast("Copied"); };
      var fail = function () { var r = document.createRange(); r.selectNodeContents(pre); var s = getSelection(); s.removeAllRanges(); s.addRange(r); SH.toast && SH.toast("Code selected. Press Ctrl+C (⌘C) to copy."); };
      try { navigator.clipboard.writeText(pre.textContent).then(done, fail); } catch (err) { fail(); }
    }
  });
  $("#newchat").addEventListener("click", function () {
    if (busy && ctrl) ctrl.abort();
    chat = [];
    save();
    render();
    window.scrollTo(0, 0);
  });

  /* ---------- example conversation (shown until the AI is connected) ---------- */
  var DEMO = [
    { role: "user", content: "I'm making a Minecraft-like game and I need a script for a tree." },
    { role: "assistant", demo: true, content: "Nice project. A few quick questions so the script fits your game:\n\n1. **Which engine or language?** Unity (C#), Godot (GDScript), a Java mod for real Minecraft, or something else?\n2. **What should the tree do?** Just appear, grow over time, or also be chopped down for wood?\n3. **What style?** Blocky like Minecraft, or smooth?" },
    { role: "user", content: "Unity C#. Blocky. It should grow from a sapling with a random height and drop wood when the player chops it." },
    { role: "assistant", demo: true, sources: [
      { url: "https://docs.unity3d.com/ScriptReference/Object.Instantiate.html", title: "Object.Instantiate · Unity Scripting API" },
      { url: "https://docs.unity3d.com/Manual/Coroutines.html", title: "Coroutines · Unity Manual" }
    ], content: "This script grows a blocky tree one log at a time, adds a leaf canopy, and drops wood when it's chopped.\n\n### VoxelTree.cs\n```csharp\nusing System.Collections;\nusing System.Collections.Generic;\nusing UnityEngine;\n\n// Grows a blocky tree from a sapling, then lets the player chop it for wood.\npublic class VoxelTree : MonoBehaviour\n{\n    [Header(\"Blocks\")]\n    public GameObject logBlock;    // 1x1x1 cube with a bark material\n    public GameObject leafBlock;   // 1x1x1 cube with a leaf material\n    public GameObject woodDrop;    // the item the player picks up\n\n    [Header(\"Growth\")]\n    public int minHeight = 4;\n    public int maxHeight = 7;\n    public float secondsPerLog = 1.5f;\n    public int leafRadius = 2;\n\n    [Header(\"Chopping\")]\n    public int hitsToChop = 5;\n\n    int height, logsPlaced, hitsTaken;\n    readonly List<GameObject> blocks = new List<GameObject>();\n\n    void Start()\n    {\n        height = Random.Range(minHeight, maxHeight + 1);\n        StartCoroutine(Grow());\n    }\n\n    IEnumerator Grow()\n    {\n        for (int y = 0; y < height; y++)\n        {\n            Place(logBlock, new Vector3(0, y, 0));\n            logsPlaced++;\n            yield return new WaitForSeconds(secondsPerLog);\n        }\n\n        int top = height - 1;\n        for (int x = -leafRadius; x <= leafRadius; x++)\n        for (int y = top - 1; y <= top + 1; y++)\n        for (int z = -leafRadius; z <= leafRadius; z++)\n        {\n            bool corner = Mathf.Abs(x) == leafRadius && Mathf.Abs(z) == leafRadius;\n            bool trunk = x == 0 && z == 0 && y <= top;\n            if (!corner && !trunk) Place(leafBlock, new Vector3(x, y, z));\n        }\n    }\n\n    void Place(GameObject prefab, Vector3 offset)\n    {\n        blocks.Add(Instantiate(prefab, transform.position + offset, Quaternion.identity, transform));\n    }\n\n    // Call this from your player's attack code.\n    public void Hit()\n    {\n        if (++hitsTaken < hitsToChop) return;\n        for (int i = 0; i < logsPlaced; i++)\n            Instantiate(woodDrop, transform.position + Vector3.up * (i + 0.5f), Quaternion.identity);\n        Destroy(gameObject);\n    }\n}\n```\n\n**How to use it**\n1. Create `VoxelTree.cs` in `Assets/Scripts` and paste the code.\n2. Make three prefabs: a log cube, a leaf cube and a wood item.\n3. Add an empty GameObject where the tree should grow, add **VoxelTree** to it, and drag the prefabs into its slots.\n4. In your player's attack code, after a raycast hit, call `hit.collider.GetComponentInParent<VoxelTree>()?.Hit();`\n\n**Settings to tweak:** `minHeight`, `maxHeight`, `secondsPerLog`, `leafRadius`, `hitsToChop`.\n\nWant falling leaves, a sapling that drops when the tree is chopped, or trees that only grow in daylight?" }
  ];

  /* ---------- boot ---------- */
  chat = demo ? [] : loadSaved().filter(function (m) { return m && (m.role === "user" || m.role === "assistant"); });
  if (chat.length && chat[chat.length - 1].role === "assistant" && chat[chat.length - 1].status) chat[chat.length - 1].status = null;
  document.body.classList.toggle("ai-demo", demo);
  if (demo) {
    $("#demo-banner").hidden = false;
    input.disabled = true;
    sendBtn.disabled = true;
    $("#s-go").disabled = true;
    input.placeholder = "The AI helper goes live soon";
  }
  render();
  paintMeter();
  if (SH.auth) SH.auth.onChange(function () { refreshStatus(); });
  else refreshStatus();
  try {
    var q = new URLSearchParams(location.search).get("q");
    if (q && !demo) { input.value = "I need a script that " + q; autosize(); input.focus(); }
  } catch (e) {}
})();
