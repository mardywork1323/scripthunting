/* SH.AI shared helpers: safe markdown, code blocks and Claude stream reading.
   Used by the website (SH.AI page) and the SH.AI Agent editor extension. */
(function (root) {
  "use strict";
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var codeSeq = 0;
  function resetIds() { codeSeq = 0; }
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
    var P = root.Prism;
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
  function md(src, opts) {
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
      var fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w#+.-]*)[ \t]*(.*)$/);
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
        var custom = opts && opts.fence ? opts.fence(lang, (fence[3] || "").trim(), code.join("\n"), closed) : null;
        out.push(custom != null ? custom : codeBlock(code.join("\n"), lang, name, !closed));
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
  function readStream(res, ai, onUpdate) {
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
      onUpdate && onUpdate();
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
  root.SHMD = { esc: esc, md: md, inline: inline, codeBlock: codeBlock, highlight: highlight, sourcesHtml: sourcesHtml, hostOf: hostOf, readStream: readStream, resetIds: resetIds, LANGS: LANGS };
})(typeof window !== "undefined" ? window : globalThis);
