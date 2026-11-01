/* SH.AI — ScriptHunting's chat app (ChatGPT-style): chats, history, projects. */
(function () {
  "use strict";
  var CFG = window.SH_CONFIG || {};
  var SH = window.SH || {};
  var M = window.SHMD;
  var esc = M.esc;
  var AI = (CFG.aiUrl || "").replace(/\/+$/, "");
  var LIMITS = CFG.limits || { guest: 3, free: 10 };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var demo = !AI;

  var els = {
    app: $("#app"), side: $("#side"), scrim: $("#scrim"), log: $("#log"), empty: $("#empty"),
    form: $("#composer"), input: $("#prompt"), send: $("#send"), meter: $("#meter"),
    chats: $("#chatlist"), projects: $("#projlist"), title: $("#chat-title"), projChip: $("#proj-chip"),
    scroller: $("#scroller"), dlg: $("#proj-dlg")
  };

  /* ---------- storage: chats live in this browser ---------- */
  var KEY = "sh-chats-v2";
  var state = { chats: [], current: null };
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && Array.isArray(s.chats)) state = s; } catch (e) {}
    try {   // bring over the single chat from the old AI page
      var old = JSON.parse(localStorage.getItem("sh-ai-chat-v1") || "null");
      if (Array.isArray(old) && old.length) {
        state.chats.unshift({ id: uid(), title: titleFrom(old), projectId: null, updated: Date.now(), messages: old.filter(function (m) { return m && !m.failed; }) });
        localStorage.removeItem("sh-ai-chat-v1");
      }
    } catch (e) {}
    state.chats.forEach(function (c) { c.messages.forEach(function (m) { m.status = null; }); });
  }
  function save() {
    state.chats = state.chats.filter(function (c) { return c.messages.length; }).slice(0, 40);
    state.chats.forEach(function (c) { c.messages = c.messages.slice(-30); });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function titleFrom(msgs) {
    var u = msgs.filter(function (m) { return m.role === "user"; })[0];
    var t = u ? u.content.replace(/\s+/g, " ").trim() : "New chat";
    return t.length > 46 ? t.slice(0, 44).trim() + "…" : t;
  }
  function cur() { return state.chats.find(function (c) { return c.id === state.current; }) || null; }

  /* ---------- projects (signed-in users, stored on the server) ---------- */
  var projects = [], projLimit = 0, pendingProject = null;
  function projById(id) { return projects.find(function (p) { return p.id === id; }) || null; }
  function signedIn() { return !!(SH.auth && SH.auth.user); }
  function api(path, opts) {
    opts = opts || {};
    return authHeaders().then(function (h) {
      return fetch(AI + path, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined });
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); });
  }
  function loadProjects() {
    if (!signedIn() || demo) { projects = []; renderSide(); return; }
    api("/projects").then(function (j) { projects = j.projects || []; projLimit = j.limit || 0; renderSide(); renderTop(); })
      .catch(function () { projects = []; renderSide(); });
  }

  /* ---------- sidebar ---------- */
  var ICON = {
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };
  function chatRow(c) {
    return '<li><button type="button" class="srow' + (c.id === state.current ? " on" : "") + '" data-open="' + c.id + '" title="' + esc(c.title) + '">' +
      ICON.chat + '<span class="stext">' + esc(c.title) + '</span></button>' +
      '<button type="button" class="sdel" data-del="' + c.id + '" aria-label="Delete chat: ' + esc(c.title) + '">' + ICON.trash + "</button></li>";
  }
  function renderSide() {
    // Projects
    if (demo) {
      els.projects.innerHTML = "";
    } else if (!signedIn()) {
      els.projects.innerHTML = '<div class="plock">' + ICON.lock + '<div><b>Projects</b><p>Keep your game\'s details in one place, so every chat already knows them.</p><button type="button" class="sbtn" data-signin-inline>Sign in to use Projects</button></div></div>';
    } else {
      els.projects.innerHTML = '<ul class="slist">' + projects.map(function (p) {
        var pchats = state.chats.filter(function (c) { return c.projectId === p.id; });
        var open = (cur() && cur().projectId === p.id) || pendingProject === p.id;
        return '<li class="pitem' + (open ? " open" : "") + '"><div class="prow-wrap"><button type="button" class="srow prow" data-proj="' + p.id + '">' + ICON.folder +
          '<span class="stext">' + esc(p.name) + '</span></button><button type="button" class="sdel" data-proj-edit="' + p.id + '" aria-label="Edit project ' + esc(p.name) + '">' + ICON.edit + "</button></div>" +
          (pchats.length ? '<ul class="slist sub">' + pchats.map(chatRow).join("") + "</ul>" : "") + "</li>";
      }).join("") + "</ul>" +
        '<button type="button" class="srow addproj" data-proj-new>' + ICON.plus + '<span class="stext">New project</span></button>';
    }
    // Chats without a project, newest first, grouped
    var loose = state.chats.filter(function (c) { return !c.projectId || !projById(c.projectId); }).sort(function (a, b) { return b.updated - a.updated; });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var groups = [["Today", loose.filter(function (c) { return c.updated >= +today; })], ["Earlier", loose.filter(function (c) { return c.updated < +today; })]];
    els.chats.innerHTML = loose.length ? groups.filter(function (g) { return g[1].length; }).map(function (g) {
      return '<div class="sgroup">' + g[0] + '</div><ul class="slist">' + g[1].map(chatRow).join("") + "</ul>";
    }).join("") : '<p class="snone">Your chats will show up here.</p>';
  }

  /* ---------- top bar ---------- */
  function renderTop() {
    var c = cur();
    var pid = c ? c.projectId : pendingProject;
    var p = pid ? projById(pid) : null;
    els.title.textContent = c ? c.title : "New chat";
    els.projChip.hidden = !p;
    if (p) els.projChip.innerHTML = ICON.folder + "<span>" + esc(p.name) + (p.engine ? " · " + esc(p.engine) : "") + "</span>";
    document.title = (c ? c.title + " · " : "") + "SH.AI · ScriptHunting";
  }

  /* ---------- messages ---------- */
  var CHIPS = [
    ["Improve it", "Improve this script. Pick the most useful upgrades, then send the full updated script."],
    ["Explain how it works", "Explain how this script works, step by step, for a beginner."],
    ["Convert to another language", null],
    ["Find similar projects online", "Search the web for similar projects, tutorials and examples for what I'm building, and list the best ones with links."]
  ];
  function msgHtml(m, i, isLast, busy) {
    if (m.role === "user") return '<article class="msg user"><div class="bubble">' + esc(m.content).replace(/\n/g, "<br>") + "</div></article>";
    var hasCode = /```/.test(m.content || "");
    var status = m.status ? '<div class="status"><span class="spin" aria-hidden="true"></span>' + esc(m.status) + "</div>" : "";
    var note = m.note ? '<div class="note ' + (m.noteKind || "") + '">' + m.note + "</div>" : "";
    var chips = isLast && !busy && hasCode && !m.demo ? '<div class="chips" aria-label="Next steps">' + CHIPS.map(function (c, j) { return '<button type="button" class="chip" data-chip="' + j + '">' + esc(c[0]) + "</button>"; }).join("") + "</div>" : "";
    return '<article class="msg ai"><div class="who"><span class="shmark" aria-hidden="true">SH</span>SH.AI' + (m.demo ? ' <span class="tag-ex">Example</span>' : "") + "</div>" +
      status + '<div class="md">' + M.md(m.content || "") + "</div>" + M.sourcesHtml(m.sources) + note + chips + "</article>";
  }
  var busy = false, ctrl = null;
  function renderLog() {
    M.resetIds();
    var c = cur();
    var list = c ? c.messages : (demo ? DEMO : []);
    els.log.innerHTML = list.map(function (m, i) { return msgHtml(m, i, i === list.length - 1, busy); }).join("");
    var isEmpty = !list.length;
    els.empty.hidden = !isEmpty;
    els.app.classList.toggle("is-empty", isEmpty);
  }
  var raf = 0, nearBottom = true;
  function renderLastSoon() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var c = cur(); if (!c) return;
      var el = els.log.lastElementChild, i = c.messages.length - 1;
      if (!el || c.messages[i].role !== "assistant") { renderLog(); return; }
      var tmp = document.createElement("div");
      tmp.innerHTML = msgHtml(c.messages[i], i, true, busy);
      el.replaceWith(tmp.firstChild);
      if (nearBottom) els.scroller.scrollTop = els.scroller.scrollHeight;
    });
  }
  els.scroller.addEventListener("scroll", function () {
    nearBottom = els.scroller.scrollTop + els.scroller.clientHeight >= els.scroller.scrollHeight - 140;
  }, { passive: true });
  function renderAll() { renderSide(); renderTop(); renderLog(); }

  /* ---------- usage meter ---------- */
  var status = null;
  function paintMeter() {
    var s = status, h;
    if (demo) h = '<span class="dot-off"></span>Connecting soon';
    else if (!s) h = '<span class="dot-wait"></span>Checking…';
    else if (s.limit == null) h = '<span class="dot-on"></span>' + esc(s.planLabel) + " · no daily limit";
    else {
      var left = Math.max(0, s.remaining);
      h = '<span class="' + (left ? "dot-on" : "dot-off") + '"></span><b>' + left + "</b>&nbsp;of " + s.limit + " left today";
    }
    els.meter.innerHTML = h;
    SH.planLabel = s && s.signedIn ? s.planLabel + " plan" : null;
  }
  function authHeaders() {
    return (SH.auth ? SH.auth.token() : Promise.resolve(null)).then(function (t) {
      var h = { "Content-Type": "application/json", "X-SH-Client": "web" };
      if (t) h.Authorization = "Bearer " + t;
      return h;
    });
  }
  function refreshStatus() {
    if (demo) { paintMeter(); return; }
    authHeaders().then(function (h) { return fetch(AI + "/me", { headers: h }); })
      .then(function (r) { return r.json(); }).then(function (s) { status = s; paintMeter(); })
      .catch(function () { els.meter.innerHTML = '<span class="dot-off"></span>Can\'t reach SH.AI'; });
  }

  /* ---------- chats ---------- */
  function newChat(projectId) {
    if (busy && ctrl) ctrl.abort();
    state.current = null;
    pendingProject = projectId || null;
    save();
    renderAll();
    closeSide();
    els.input.focus();
  }
  function openChat(id) {
    if (busy && ctrl) ctrl.abort();
    state.current = id;
    pendingProject = null;
    save();
    renderAll();
    closeSide();
    els.scroller.scrollTop = els.scroller.scrollHeight;
  }

  function setBusy(b) {
    busy = b;
    els.send.classList.toggle("stop", b);
    els.send.setAttribute("aria-label", b ? "Stop the reply" : "Send");
    els.send.innerHTML = b ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    updateSendState();
  }
  function updateSendState() { els.send.disabled = demo || (!busy && !els.input.value.trim()); }

  function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    if (demo) { SH.toast && SH.toast("SH.AI isn't connected yet."); return; }
    var c = cur();
    if (!c) {
      c = { id: uid(), title: "New chat", projectId: pendingProject, updated: Date.now(), messages: [] };
      state.chats.unshift(c);
      state.current = c.id;
      pendingProject = null;
    }
    c.messages.push({ role: "user", content: text });
    if (c.messages.length === 1) c.title = titleFrom(c.messages);
    var ai = { role: "assistant", content: "", sources: [], status: "Thinking…" };
    c.messages.push(ai);
    c.updated = Date.now();
    els.input.value = "";
    autosize();
    setBusy(true);
    nearBottom = true;
    renderAll();
    els.scroller.scrollTop = els.scroller.scrollHeight;

    var history = c.messages.slice(0, -1).filter(function (m) { return !m.failed && m.content; }).map(function (m) { return { role: m.role, content: m.content }; });
    var p = c.projectId ? projById(c.projectId) : null;
    var wantsSearch = /\b(search|find|similar|tutorials?|examples? online|on the web|online|links?|docs|documentation)\b/i.test(text);
    ctrl = new AbortController();
    var userMsg = c.messages[c.messages.length - 2];
    authHeaders().then(function (h) {
      return fetch(AI + "/chat", { method: "POST", headers: h, signal: ctrl.signal,
        body: JSON.stringify({ messages: history, search: wantsSearch, project: p ? { name: p.name, engine: p.engine, notes: p.notes } : undefined }) });
    }).then(function (res) {
      var used = res.headers.get("x-sh-used"), limit = res.headers.get("x-sh-limit");
      if (res.ok && status && used) {
        status.used = Number(used);
        status.remaining = limit === "unlimited" ? null : Math.max(0, Number(limit) - Number(used));
        paintMeter();
      }
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          ai.status = null; ai.failed = true; userMsg.failed = true;
          if (res.status === 429 && j.error === "limit_reached") {
            ai.note = esc(j.message || "You've reached today's limit.") + '<div class="note-actions">' +
              (j.signedIn ? "" : '<button type="button" class="btn" data-signin-inline>Sign in free</button>') + '<a class="btn primary" href="plans.html">See plans</a></div>';
            ai.noteKind = "limit";
            if (j.plan) { status = j; paintMeter(); }
          } else {
            ai.note = esc(j.message || "Something went wrong. Try again.") + '<div class="note-actions"><button type="button" class="btn" data-retry>Try again</button></div>';
            ai.noteKind = "error";
          }
        });
      }
      return M.readStream(res, ai, renderLastSoon);
    }).catch(function (e) {
      ai.status = null;
      if (e && e.name === "AbortError") { ai.note = "Stopped."; ai.noteKind = "muted"; if (!ai.content) { ai.failed = true; userMsg.failed = true; } }
      else { ai.failed = true; userMsg.failed = true; ai.note = "Couldn't reach SH.AI. Check your connection and try again." + '<div class="note-actions"><button type="button" class="btn" data-retry>Try again</button></div>'; ai.noteKind = "error"; }
    }).then(function () {
      ai.status = null;
      c.updated = Date.now();
      setBusy(false);
      ctrl = null;
      save();
      renderAll();
    });
  }

  /* ---------- project dialog ---------- */
  var editing = null;
  function openProjDlg(p) {
    editing = p || null;
    $("#pd-title").textContent = p ? "Edit project" : "New project";
    $("#pd-name").value = p ? p.name : "";
    $("#pd-engine").value = p ? (p.engine || "") : "";
    $("#pd-notes").value = p ? (p.notes || "") : "";
    $("#pd-delete").hidden = !p;
    $("#pd-confirm").hidden = true;
    $("#pd-error").hidden = true;
    var count = $("#pd-count");
    count.textContent = p ? "" : (projLimit ? projects.length + " of " + projLimit + " projects used" : "");
    els.dlg.hidden = false;
    document.documentElement.classList.add("intro-open");
    $("#pd-name").focus();
  }
  function closeProjDlg() { els.dlg.hidden = true; document.documentElement.classList.remove("intro-open"); }
  function showDlgError(msg) { var e = $("#pd-error"); e.textContent = msg; e.hidden = false; }
  $("#pd-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var body = { name: $("#pd-name").value.trim(), engine: $("#pd-engine").value.trim(), notes: $("#pd-notes").value.trim() };
    if (!body.name) { showDlgError("Give the project a name."); $("#pd-name").focus(); return; }
    var btn = $("#pd-save"); btn.disabled = true;
    (editing ? api("/projects/" + editing.id, { method: "PUT", body: body }) : api("/projects", { method: "POST", body: body }))
      .then(function (j) {
        projects = j.projects || projects; projLimit = j.limit || projLimit;
        closeProjDlg();
        if (!editing && j.project) newChat(j.project.id); else renderAll();
        SH.toast && SH.toast(editing ? "Project saved" : "Project created");
      })
      .catch(function (j) { showDlgError((j && j.message) || "Couldn't save the project. Try again."); })
      .then(function () { btn.disabled = false; });
  });
  $("#pd-delete").addEventListener("click", function () { $("#pd-confirm").hidden = false; });
  $("#pd-confirm-no").addEventListener("click", function () { $("#pd-confirm").hidden = true; });
  $("#pd-confirm-yes").addEventListener("click", function () {
    if (!editing) return;
    var id = editing.id;
    api("/projects/" + id, { method: "DELETE" }).then(function (j) {
      projects = j.projects || [];
      state.chats.forEach(function (c) { if (c.projectId === id) c.projectId = null; });
      if (pendingProject === id) pendingProject = null;
      save(); closeProjDlg(); renderAll();
      SH.toast && SH.toast("Project deleted. Its chats moved to your chat list.");
    }).catch(function (j) { showDlgError((j && j.message) || "Couldn't delete the project."); });
  });
  els.dlg.addEventListener("click", function (e) { if (e.target === els.dlg || e.target.closest("[data-pd-close]")) closeProjDlg(); });
  els.dlg.addEventListener("keydown", function (e) { if (e.key === "Escape") closeProjDlg(); });

  /* ---------- mobile sidebar ---------- */
  function openSide() { els.app.classList.add("side-open"); }
  function closeSide() { els.app.classList.remove("side-open"); }
  $("#side-open").addEventListener("click", openSide);
  els.scrim.addEventListener("click", closeSide);

  /* ---------- events ---------- */
  function autosize() { els.input.style.height = "auto"; els.input.style.height = Math.min(els.input.scrollHeight, 220) + "px"; updateSendState(); }
  els.input.addEventListener("input", autosize);
  els.input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(els.input.value); }
  });
  els.form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) { if (ctrl) ctrl.abort(); return; }
    send(els.input.value);
  });
  var lastDeleted = null;
  document.addEventListener("click", function (e) {
    var t;
    if ((t = e.target.closest("[data-new-chat]"))) { newChat(null); return; }
    if ((t = e.target.closest("[data-open]"))) { openChat(t.getAttribute("data-open")); return; }
    if ((t = e.target.closest("[data-del]"))) {
      var id = t.getAttribute("data-del"), i = state.chats.findIndex(function (c) { return c.id === id; });
      if (i < 0) return;
      lastDeleted = { chat: state.chats[i], index: i };
      state.chats.splice(i, 1);
      if (state.current === id) state.current = null;
      save(); renderAll();
      showUndo();
      return;
    }
    if (e.target.closest("[data-undo]")) {
      if (lastDeleted) { state.chats.splice(lastDeleted.index, 0, lastDeleted.chat); lastDeleted = null; save(); renderAll(); }
      hideUndo(); return;
    }
    if ((t = e.target.closest("[data-proj]"))) { newChat(t.getAttribute("data-proj")); return; }
    if ((t = e.target.closest("[data-proj-edit]"))) { openProjDlg(projById(t.getAttribute("data-proj-edit"))); return; }
    if (e.target.closest("[data-proj-new]")) { openProjDlg(null); return; }
    if ((t = e.target.closest("[data-suggest]"))) { els.input.value = t.getAttribute("data-suggest"); autosize(); els.input.focus(); return; }
    if ((t = e.target.closest("[data-chip]"))) {
      var chip = CHIPS[Number(t.getAttribute("data-chip"))];
      if (chip[1]) send(chip[1]);
      else { els.input.value = "Convert this script to "; autosize(); els.input.focus(); }
      return;
    }
    if (e.target.closest("[data-retry]")) {
      var c = cur(); if (!c) return;
      var lastUser = null;
      for (var k = c.messages.length - 1; k >= 0; k--) if (c.messages[k].role === "user") { lastUser = c.messages[k].content; break; }
      while (c.messages.length && c.messages[c.messages.length - 1].failed) c.messages.pop();
      renderAll(); send(lastUser); return;
    }
    if (e.target.closest("[data-continue]")) { send("Continue from where you stopped."); return; }
    if (e.target.closest("[data-signin-inline]")) { e.preventDefault(); SH.auth && SH.auth.signIn(); return; }
    if ((t = e.target.closest("[data-copy-ai]"))) {
      var pre = document.getElementById(t.getAttribute("data-copy-ai"));
      var done = function () { SH.toast && SH.toast("Copied"); };
      var fail = function () { var r = document.createRange(); r.selectNodeContents(pre); var s = getSelection(); s.removeAllRanges(); s.addRange(r); SH.toast && SH.toast("Code selected. Press Ctrl+C (⌘C) to copy."); };
      try { navigator.clipboard.writeText(pre.textContent).then(done, fail); } catch (err) { fail(); }
    }
  });
  var undoTimer;
  function showUndo() {
    var u = $("#undo"); u.hidden = false;
    clearTimeout(undoTimer); undoTimer = setTimeout(hideUndo, 6000);
  }
  function hideUndo() { $("#undo").hidden = true; lastDeleted = null; }
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); newChat(null); }
  });

  /* ---------- example chat while not connected ---------- */
  var DEMO = [
    { role: "user", content: "I'm making a Minecraft-like game and I need a script for a tree." },
    { role: "assistant", demo: true, content: "Nice project. A few quick questions first:\n\n1. **Which engine?** Unity (C#), Godot, or a Java Minecraft mod?\n2. **Should it grow** over time or appear instantly?\n3. **Can players chop it** for wood?" }
  ];

  /* ---------- boot ---------- */
  load();
  if (!cur()) state.current = null;
  if (demo) { els.input.disabled = true; els.input.placeholder = "SH.AI goes live soon"; $("#demo-banner").hidden = false; }
  setBusy(false);
  renderAll();
  paintMeter();
  if (SH.auth) SH.auth.onChange(function () { refreshStatus(); loadProjects(); });
  else { refreshStatus(); }
  try {
    var q = new URLSearchParams(location.search).get("q");
    if (q && !demo) { newChat(null); els.input.value = "I need a script that " + q; autosize(); }
  } catch (e) {}
  autosize();
})();
