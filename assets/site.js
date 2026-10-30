/* ScriptHunting shared script: toast, sign-in, account menu and the intro slideshow. */
(function () {
  "use strict";
  var CFG = window.SH_CONFIG || {};
  var SH = (window.SH = window.SH || {});
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  SH.store = store;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  SH.esc = esc;
  function root() { return document.documentElement.getAttribute("data-root") || ""; }

  /* ---------- toast ---------- */
  var toastTimer;
  SH.toast = function (msg, ms) {
    var el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, ms || 2400);
  };

  /* ---------- sign-in (Firebase, loaded only when configured) ---------- */
  var fbCfg = CFG.firebase && CFG.firebase.apiKey ? CFG.firebase : null;
  var user = null, ready = !fbCfg, listeners = [];
  function emit() {
    renderAccount();
    listeners.slice().forEach(function (f) { try { f(user); } catch (e) { console.error(e); } });
  }
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  SH.auth = {
    enabled: !!fbCfg,
    get user() { return user; },
    get ready() { return ready; },
    onChange: function (f) { listeners.push(f); if (ready) f(user); },
    token: function () { return user ? user.getIdToken().catch(function () { return null; }) : Promise.resolve(null); },
    signIn: function () { openChooser(); return Promise.resolve(); },
    signInWith: function (id) {
      if (!fbCfg || !window.firebase) { SH.toast("Sign-in opens soon. Until then you get " + ((CFG.limits || {}).guest || 3) + " free AI prompts a day.", 3600); return Promise.resolve(); }
      var provider = makeProvider(id);
      return window.firebase.auth().signInWithPopup(provider).then(function () { closeChooser(); }).catch(function (e) {
        var code = e && e.code;
        if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") return window.firebase.auth().signInWithRedirect(provider);
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
        if (code === "auth/account-exists-with-different-credential") { SH.toast("That email already uses a different sign-in option. Pick the one you used before.", 4200); return; }
        SH.toast("Sign-in didn't finish. Try again.");
      });
    },
    signOut: function () { return fbCfg && window.firebase ? window.firebase.auth().signOut() : Promise.resolve(); }
  };
  var PROVIDERS = {
    google: { label: "Continue with Google", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>' },
    apple: { label: "Continue with Apple", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.3 0 1.7-.8 3.3-.8 1.5 0 1.9.8 3.3.8 1.4 0 2.2-1.2 3-2.4a10 10 0 0 0 1.4-2.8 4.4 4.4 0 0 1-2.3-4.2zM13.9 5c.7-.9 1.2-2 1-3.2a4.6 4.6 0 0 0-3 1.6 4.3 4.3 0 0 0-1.1 3.1c1.2.1 2.3-.6 3.1-1.5z"/></svg>' },
    microsoft: { label: "Continue with Microsoft", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="10.5" height="10.5" fill="#F25022"/><rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00"/><rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF"/><rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900"/></svg>' }
  };
  var PROVIDER_ORDER = (CFG.signInProviders || ["google", "apple", "microsoft"]).filter(function (p) { return PROVIDERS[p]; });
  function makeProvider(id) {
    var a = window.firebase.auth, p;
    if (id === "apple") { p = new a.OAuthProvider("apple.com"); p.addScope("email"); p.addScope("name"); return p; }
    if (id === "microsoft") { p = new a.OAuthProvider("microsoft.com"); p.setCustomParameters({ prompt: "select_account" }); return p; }
    p = new a.GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" }); return p;
  }

  /* ---------- sign-in chooser ---------- */
  var dlg = null, dlgFocus = null;
  function openChooser() {
    if (!dlg) {
      dlg = document.createElement("div");
      dlg.className = "signin-dlg";
      dlg.setAttribute("role", "dialog");
      dlg.setAttribute("aria-modal", "true");
      dlg.setAttribute("aria-labelledby", "signin-h");
      var L2 = CFG.limits || { guest: 3, free: 10 };
      dlg.innerHTML = '<div class="signin-card">' +
        '<button type="button" class="signin-x" data-chooser-close aria-label="Close">×</button>' +
        '<h2 id="signin-h">Sign in to ScriptHunting</h2>' +
        '<p>Get ' + L2.free + ' free AI prompts a day, and keep your plan on every device.</p>' +
        '<div class="providers">' + PROVIDER_ORDER.map(function (id) {
          return '<button type="button" class="prov prov-' + id + '" data-provider="' + id + '">' + PROVIDERS[id].icon + "<span>" + PROVIDERS[id].label + "</span></button>";
        }).join("") + "</div>" +
        (fbCfg ? "" : '<p class="signin-soon">Sign-in opens soon. Until then you get ' + L2.guest + " free AI prompts a day without an account.</p>") +
        '<p class="signin-fine">By continuing you agree to the <a href="' + root() + 'terms.html">Terms</a> and <a href="' + root() + 'privacy.html">Privacy Policy</a>.</p>' +
        "</div>";
      dlg.addEventListener("click", function (e) {
        if (e.target === dlg || e.target.closest("[data-chooser-close]")) { closeChooser(); return; }
        var b = e.target.closest("[data-provider]");
        if (b) SH.auth.signInWith(b.getAttribute("data-provider"));
      });
      dlg.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { e.preventDefault(); closeChooser(); }
        else if (e.key === "Tab") {
          var f = dlg.querySelectorAll("button, a[href]"), first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
      document.body.appendChild(dlg);
    }
    dlgFocus = document.activeElement;
    dlg.hidden = false;
    document.documentElement.classList.add("intro-open");
    var firstProv = dlg.querySelector("[data-provider]");
    if (firstProv) firstProv.focus();
  }
  function closeChooser() {
    if (!dlg || dlg.hidden) return;
    dlg.hidden = true;
    if (!overlay || overlay.hidden) document.documentElement.classList.remove("intro-open");
    if (dlgFocus && dlgFocus.focus) dlgFocus.focus();
  }

  if (fbCfg) {
    var v = "10.12.2";
    loadScript("https://www.gstatic.com/firebasejs/" + v + "/firebase-app-compat.js")
      .then(function () { return loadScript("https://www.gstatic.com/firebasejs/" + v + "/firebase-auth-compat.js"); })
      .then(function () {
        window.firebase.initializeApp(fbCfg);
        window.firebase.auth().onAuthStateChanged(function (u) { user = u; ready = true; emit(); });
      })
      .catch(function () { ready = true; SH.auth.enabled = false; emit(); });
  }

  /* ---------- account button ---------- */
  var menu;
  function renderAccount() {
    document.querySelectorAll("[data-signin]").forEach(function (b) {
      if (user) {
        var name = user.displayName || user.email || "Account";
        b.innerHTML = '<span class="avatar" aria-hidden="true">' + esc(name.trim().charAt(0).toUpperCase()) + "</span><span class=\"acct-name\">" + esc(name.split(" ")[0]) + "</span>";
        b.setAttribute("aria-label", "Account: " + name);
        b.setAttribute("aria-haspopup", "menu");
      } else {
        b.textContent = "Sign in";
        b.removeAttribute("aria-haspopup");
        b.setAttribute("aria-label", "Sign in");
      }
    });
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-signin]");
    if (b) {
      e.preventDefault();
      if (!user) { SH.auth.signIn(); return; }
      if (menu) { closeMenu(); return; }
      var r = b.getBoundingClientRect();
      menu = document.createElement("div");
      menu.className = "acct-menu";
      menu.setAttribute("role", "menu");
      var plan = SH.planLabel ? '<div class="acct-plan">' + esc(SH.planLabel) + "</div>" : "";
      menu.innerHTML = '<div class="acct-who">' + esc(user.email || user.displayName || "") + "</div>" + plan +
        '<a role="menuitem" href="' + root() + 'plans.html">Plans and upgrades</a>' +
        '<button type="button" role="menuitem" data-signout>Sign out</button>';
      menu.style.top = (r.bottom + window.scrollY + 6) + "px";
      menu.style.right = Math.max(12, document.documentElement.clientWidth - r.right) + "px";
      document.body.appendChild(menu);
      return;
    }
    if (e.target.closest("[data-signout]")) { closeMenu(); SH.auth.signOut().then(function () { SH.toast("Signed out"); }); return; }
    if (menu && !e.target.closest(".acct-menu")) closeMenu();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });

  /* ---------- intro slideshow ---------- */
  var P = CFG.prices || { plus: { monthly: 5, yearly: 50, daily: 100 }, unlimited: { monthly: 20, yearly: 100 } };
  var L = CFG.limits || { guest: 3, free: 10 };
  var SLIDES = [
    { eyebrow: "Welcome", title: "Welcome to ScriptHunting",
      text: "Find working code in seconds, or let the AI write a script made for your project. C, C++, C#, JavaScript, Python and game engines too.",
      art: '<div class="art-hero"><div class="art-word">Script<b>Hunting</b></div><div class="art-dots"><i style="--lc:var(--l-c)">C</i><i style="--lc:var(--l-cpp)">C++</i><i style="--lc:var(--l-cs)">C#</i><i style="--lc:var(--l-js)">JS</i><i style="--lc:var(--l-py)">Py</i></div></div>' },
    { eyebrow: "Search", title: "Search 129 ready-made snippets",
      text: "Type what you need, like “read file python”. Pick a language tab, press Copy, and run it with the command shown under the code.",
      art: '<div class="art-search"><div class="art-input">read file python<span class="caret"></span></div><div class="art-row on"><b>Read a file line by line</b><span>Py</span></div><div class="art-row"><b>Write or append text to a file</b><span>Py</span></div><div class="art-row"><b>Parse and create JSON</b><span>Py</span></div></div>' },
    { eyebrow: "AI script helper", title: "Tell the AI what you're building",
      text: "Describe your project. The AI asks which language or engine, what the script is for and the details, then writes the full script with steps to use it.",
      art: '<div class="art-chat"><div class="b u">I need a tree script for my Minecraft-like game</div><div class="b a">Which engine are you using, and should the tree grow and be choppable?<span class="opts"><i>Unity C#</i><i>Java mod</i><i>Godot</i></span></div><div class="b u">Unity. Grows, and drops wood when chopped</div></div>' },
    { eyebrow: "Keep improving", title: "Change it, and find related projects",
      text: "Ask for changes as often as you like and get the whole updated script back. The AI can also search the web for similar projects, tutorials and docs, with links.",
      art: '<div class="art-improve"><div class="art-file"><span>VoxelTree.cs</span><i></i><i></i><i class="s"></i><i></i></div><div class="art-chips"><i>Improve it</i><i>Explain it</i><i>Convert language</i><i>Find similar projects</i></div><div class="art-links"><span>docs.unity3d.com</span><span>github.com</span></div></div>' },
    { eyebrow: "Sign in", title: "Sign in for more free prompts",
      text: "Without an account you get " + L.guest + " AI prompts a day. Sign in with Google, Apple or Microsoft to get " + L.free + " a day, free. Snippet search is always free.",
      art: '<div class="art-meters"><div><b>Guest</b><span class="m"><i style="width:' + (L.guest / L.free * 100) + '%"></i></span><em>' + L.guest + " a day</em></div><div><b>Signed in</b><span class=\"m\"><i style=\"width:100%\"></i></span><em>" + L.free + ' a day</em></div><button type="button" class="art-google" data-signin>Sign in</button></div>' },
    { eyebrow: "Upgrade", title: "Need more? Upgrade the AI",
      text: "Plus gives you " + P.plus.daily + " prompts a day. Unlimited removes the daily limit. Pay monthly, or yearly and save.",
      art: '<div class="art-plans"><div><b>Plus</b><strong>$' + P.plus.monthly + '<small>/month</small></strong><em>or $' + P.plus.yearly + '/year</em><span>' + P.plus.daily + ' prompts a day</span></div><div class="hot"><b>Unlimited</b><strong>$' + P.unlimited.monthly + '<small>/month</small></strong><em>or $' + P.unlimited.yearly + '/year</em><span>No daily limit</span></div></div>' },
    { eyebrow: "Ready", title: "Start hunting",
      text: "Search the snippet library, or open the AI helper and describe your first script. You can reopen this tour any time from “How it works”.",
      art: '<div class="art-go"><a class="btn-big primary" href="{root}ai.html">Try the AI helper</a><button type="button" class="btn-big" data-intro-close>Search snippets</button></div>' }
  ];

  var overlay, idx = 0, lastFocus = null;
  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.className = "intro";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "How ScriptHunting works");
    overlay.innerHTML =
      '<div class="intro-card">' +
        '<button type="button" class="intro-x" data-intro-close aria-label="Close the tour">Skip</button>' +
        '<div class="intro-stage" aria-live="polite"></div>' +
        '<div class="intro-foot">' +
          '<div class="intro-dots" role="tablist" aria-label="Slides">' + SLIDES.map(function (s, i) { return '<button type="button" role="tab" data-go="' + i + '" aria-label="Slide ' + (i + 1) + ": " + esc(s.title) + '"></button>'; }).join("") + "</div>" +
          '<div class="intro-nav"><button type="button" class="ibtn" data-prev>Back</button><button type="button" class="ibtn primary" data-next>Next</button></div>' +
        "</div>" +
      "</div>";
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest("[data-intro-close]")) { closeIntro(); return; }
      if (e.target.closest("[data-next]")) { if (idx === SLIDES.length - 1) closeIntro(); else show(idx + 1); return; }
      if (e.target.closest("[data-prev]")) { show(idx - 1); return; }
      var g = e.target.closest("[data-go]");
      if (g) show(Number(g.getAttribute("data-go")));
    });
    overlay.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); if (idx < SLIDES.length - 1) show(idx + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); show(idx - 1); }
      else if (e.key === "Escape") { e.preventDefault(); closeIntro(); }
      else if (e.key === "Tab") {
        var f = overlay.querySelectorAll("button, a[href]");
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    document.body.appendChild(overlay);
  }
  function show(i) {
    idx = Math.max(0, Math.min(SLIDES.length - 1, i));
    var s = SLIDES[idx];
    overlay.querySelector(".intro-stage").innerHTML =
      '<div class="intro-art">' + s.art.replace(/\{root\}/g, root()) + "</div>" +
      '<div class="intro-copy"><span class="eyebrow">' + (idx + 1) + " of " + SLIDES.length + " · " + esc(s.eyebrow) + "</span><h2>" + esc(s.title) + "</h2><p>" + esc(s.text) + "</p></div>";
    overlay.querySelectorAll("[data-go]").forEach(function (d, j) { d.setAttribute("aria-selected", String(j === idx)); });
    overlay.querySelector("[data-prev]").disabled = idx === 0;
    overlay.querySelector("[data-next]").textContent = idx === SLIDES.length - 1 ? "Done" : "Next";
    renderAccount();
  }
  function openIntro(start) {
    if (!overlay) buildOverlay();
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add("intro-open");
    show(start || 0);
    overlay.querySelector("[data-next]").focus();
  }
  function closeIntro() {
    if (!overlay) return;
    overlay.hidden = true;
    document.documentElement.classList.remove("intro-open");
    store.set("sh-intro-seen", "1");
    if (location.hash === "#how") { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  SH.openIntro = openIntro;
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-intro]");
    if (t) { e.preventDefault(); openIntro(0); }
  });

  function boot() {
    renderAccount();
    var auto = document.documentElement.hasAttribute("data-intro-auto");
    if (location.hash === "#how" || (auto && !store.get("sh-intro-seen") && window.innerWidth >= 760)) openIntro(0);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
