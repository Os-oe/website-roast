/* Roast My Website — Frontend-Orchestrierung.
 *
 * Flow: URL eingeben → /api/roast → Röst-Animation (Ticker + Hitze-Meter) →
 * Ergebnis-Karte (Score-Count-up + Sprüche-Reveal + echter Tipp) →
 * teilen / andere rösten. localStorage-Historie + Live-Tageszähler.
 *
 * Test-Hooks: window.__wr (für Playwright). ?fast=1 → deterministische
 * gestagte Röstung ohne Live-API + verkürzte Animation.
 */
(function () {
  "use strict";

  var qs = new URLSearchParams(location.search);
  var FAST = qs.get("fast") === "1";          // deterministisch + schnell (Tests)
  var FORCE = qs.get("force");                // "cap" | "error" → Fallback-Pfade testen
  var ANIM_MS = FAST ? 240 : 3400;            // Röst-Animation-Dauer
  var TICK_MS = FAST ? 60 : 520;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var els = {};
  var roastCount = 0;
  var lastResult = null;

  function normalizeUrl(raw) {
    var v = (raw || "").trim();
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    return v;
  }

  function verdictFor(score) {
    if (score <= 20) return "verkohlt 💀";
    if (score <= 40) return "well done, leider";
    if (score <= 60) return "medium — geht besser";
    if (score <= 80) return "schön kross 🔥";
    return "Sterneküche 👨‍🍳";
  }

  function pickStaged() {
    var arr = window.STAGED_ROASTS || [];
    return arr[Math.floor(Math.random() * arr.length)] || arr[0];
  }

  // ---------- Tageszähler (localStorage, best effort, nur Anzeige) ----------
  function counterKey() { return "wr_count_" + new Date().toISOString().slice(0, 10); }
  function loadCounter() {
    var n = parseInt(localStorage.getItem(counterKey()) || "0", 10);
    // kleiner „Startwert", damit es nicht bei 0 wirkt — rein kosmetisch, lokal
    if (!localStorage.getItem("wr_seeded_" + counterKey())) {
      n = 40 + Math.floor(Math.random() * 60);
      localStorage.setItem(counterKey(), String(n));
      localStorage.setItem("wr_seeded_" + counterKey(), "1");
    }
    roastCount = n;
    return n;
  }
  function bumpCounter() {
    roastCount += 1;
    try { localStorage.setItem(counterKey(), String(roastCount)); } catch (e) {}
    if (els.counterNum) animateNumber(els.counterNum, roastCount - 1, roastCount, 600);
  }

  // ---------- Historie (localStorage) ----------
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem("wr_history") || "[]"); } catch (e) { return []; }
  }
  function pushHistory(entry) {
    var h = loadHistory();
    h.unshift(entry);
    h = h.slice(0, 8);
    try { localStorage.setItem("wr_history", JSON.stringify(h)); } catch (e) {}
    renderHistory();
  }
  function renderHistory() {
    var h = loadHistory();
    if (!els.history || !els.historyList) return;
    if (!h.length) { els.history.hidden = true; return; }
    els.historyList.innerHTML = "";
    h.forEach(function (e) {
      var li = document.createElement("li");
      li.className = "hist-item";
      var dot = document.createElement("span");
      dot.className = "hist-score s" + scoreBucket(e.score);
      dot.textContent = e.score;
      var url = document.createElement("span");
      url.className = "hist-url";
      url.textContent = e.host || e.url || "?";
      li.appendChild(dot); li.appendChild(url);
      li.addEventListener("click", function () {
        els.input.value = e.url || e.host || "";
        window.scrollTo({ top: 0, behavior: "smooth" });
        els.input.focus();
      });
      els.historyList.appendChild(li);
    });
    els.history.hidden = false;
  }
  function scoreBucket(s) {
    if (s <= 20) return 0; if (s <= 40) return 1; if (s <= 60) return 2; if (s <= 80) return 3; return 4;
  }

  // ---------- Number count-up ----------
  function animateNumber(node, from, to, dur) {
    if (FAST) { node.textContent = String(to); return; }
    var start = performance.now();
    function step(now) {
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      node.textContent = String(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step);
      else node.textContent = String(to);
    }
    requestAnimationFrame(step);
  }

  // ---------- Röst-Animation ----------
  var tickTimer = null;
  function startRoasting(targetHost) {
    els.mascotStage.dataset.mood = "roasting";
    els.roastingTarget.textContent = targetHost ? "Röste " + targetHost + " …" : "";
    els.heatFill.style.transition = "width " + ANIM_MS + "ms cubic-bezier(.4,0,.2,1)";
    els.roasting.hidden = false;
    // force reflow then fill
    void els.roasting.offsetWidth;
    els.heatFill.style.width = "100%";
    els.roasting.classList.add("on");

    var lines = (window.STAGED_TICKER || []).slice();
    var i = 0;
    els.ticker.textContent = lines[0] || "Röste …";
    tickTimer = setInterval(function () {
      i = (i + 1) % lines.length;
      els.ticker.classList.remove("tick-in");
      void els.ticker.offsetWidth;
      els.ticker.textContent = lines[i];
      els.ticker.classList.add("tick-in");
    }, TICK_MS);
  }
  function stopRoasting() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    els.roasting.classList.remove("on");
    els.roasting.hidden = true;
    els.heatFill.style.width = "0%";
  }

  // ---------- Ergebnis rendern ----------
  function showResult(host, url, roast) {
    lastResult = { host: host, url: url, roast: roast };
    var score = Math.max(0, Math.min(100, Math.round(roast.score)));
    var bucket = scoreBucket(score);

    els.cardUrl.textContent = host || url || "";
    els.roastCard.dataset.bucket = String(bucket);
    els.scoreLabel.textContent = roast.verdict || verdictFor(score);

    // roasts
    els.roastList.innerHTML = "";
    (roast.roasts || []).forEach(function (txt, idx) {
      var li = document.createElement("li");
      li.className = "roast-line";
      li.style.setProperty("--i", idx);
      li.textContent = txt;
      els.roastList.appendChild(li);
    });

    // real tip
    els.realTip.textContent = roast.realTip || "";

    // reveal
    els.result.hidden = false;
    els.mascotStage.dataset.mood = "done";
    requestAnimationFrame(function () {
      els.result.classList.add("on");
      els.roastCard.classList.add("reveal");
    });

    // score ring + count-up
    var ring = els.ringFg;
    var circ = 2 * Math.PI * 52;
    ring.style.strokeDasharray = String(circ);
    ring.style.strokeDashoffset = String(circ);
    ring.dataset.bucket = String(bucket);
    requestAnimationFrame(function () {
      ring.style.transition = FAST ? "none" : "stroke-dashoffset 1100ms cubic-bezier(.2,.7,.2,1)";
      ring.style.strokeDashoffset = String(circ * (1 - score / 100));
    });
    animateNumber(els.scoreNum, 0, score, 1100);

    pushHistory({ host: host, url: url, score: score, ts: Date.now() });
    els.result.scrollIntoView({ behavior: FAST ? "auto" : "smooth", block: "start" });
  }

  // ---------- API ----------
  function callRoast(url) {
    return fetch("/api/roast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    });
  }

  function hostFromUrl(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; }
  }

  // central: run a roast and resolve to a roast object (or error roast)
  function runRoast(url) {
    var host = hostFromUrl(url);

    // forced fallback paths (for tests / resilience demo)
    if (FORCE === "cap" || FORCE === "error") {
      return Promise.resolve({ host: host, roast: stagedAsRoast(), fallback: true });
    }
    if (FAST) {
      // deterministic — no live call in tests
      if (/broken|nonexistent|error-case/.test(url)) {
        return Promise.resolve({ host: host, roast: { error: "Deine Seite hat sich vor mir versteckt — verdächtig." } });
      }
      return Promise.resolve({ host: host, roast: stagedAsRoast(0) });
    }

    return callRoast(url).then(function (res) {
      var b = res.body || {};
      if (b.ok && b.roast) {
        return { host: b.host || host, roast: b.roast };
      }
      // graceful fallback (cap / 5xx / config) → gestagte Röstung
      if (b.fallback) {
        return { host: host, roast: stagedAsRoast(), fallback: true };
      }
      // harte Validierungsfehler (z. B. SSRF/Format) → charmanter error
      return { host: host, roast: { error: b.error || "Diese Adresse kann ich nicht rösten." } };
    }).catch(function () {
      return { host: host, roast: stagedAsRoast(), fallback: true };
    });
  }

  function stagedAsRoast(idx) {
    var s = typeof idx === "number" ? (window.STAGED_ROASTS || [])[idx] : pickStaged();
    return {
      error: null, score: s.score, verdict: s.verdict,
      roasts: s.roasts.slice(), realTip: s.realTip, observations: s.observations.slice(),
    };
  }

  // error-roast: charmant, kein Stacktrace
  function showError(host, msg) {
    els.result.hidden = false;
    els.mascotStage.dataset.mood = "done";
    els.cardUrl.textContent = host || "";
    els.roastCard.dataset.bucket = "0";
    els.scoreNum.textContent = "—";
    els.ringFg.style.strokeDashoffset = String(2 * Math.PI * 52);
    els.scoreLabel.textContent = "nicht erreichbar";
    els.roastList.innerHTML = "";
    var li = document.createElement("li");
    li.className = "roast-line";
    li.textContent = msg || "Deine Seite hat sich vor mir versteckt — verdächtig.";
    els.roastList.appendChild(li);
    els.realTip.textContent = "Spaß beiseite: Prüf, ob die Adresse stimmt und die Seite öffentlich erreichbar ist — dann röste ich gern nach.";
    requestAnimationFrame(function () {
      els.result.classList.add("on");
      els.roastCard.classList.add("reveal");
    });
    els.result.scrollIntoView({ behavior: FAST ? "auto" : "smooth", block: "start" });
  }

  // ---------- Submit handler ----------
  var busy = false;
  function onSubmit(e) {
    if (e) e.preventDefault();
    if (busy) return;
    var raw = els.input.value;
    var url = normalizeUrl(raw);
    els.formHint.textContent = "";
    if (!url || !/\./.test(url.replace(/^https?:\/\//, ""))) {
      els.formHint.textContent = "Gib eine echte Website-Adresse ein, z. B. deine-firma.de";
      els.input.focus();
      return;
    }
    busy = true;
    els.roastBtn.disabled = true;
    els.roastBtn.classList.add("firing");

    // reset previous result
    els.result.classList.remove("on");
    els.roastCard.classList.remove("reveal");
    els.result.hidden = true;

    var host = hostFromUrl(url);
    startRoasting(host);

    var animDone = new Promise(function (res) { setTimeout(res, ANIM_MS); });
    var dataReady = runRoast(url);

    Promise.all([animDone, dataReady]).then(function (vals) {
      var out = vals[1];
      stopRoasting();
      bumpCounter();
      if (out.roast && out.roast.error) {
        showError(out.host, out.roast.error);
      } else {
        showResult(out.host, url, out.roast);
      }
    }).catch(function () {
      stopRoasting();
      showError(host, null);
    }).finally(function () {
      busy = false;
      els.roastBtn.disabled = false;
      els.roastBtn.classList.remove("firing");
    });
  }

  // ---------- Share card (html-to-image) ----------
  function onShare() {
    var card = els.roastCard;
    var done = function (dataUrl) {
      // try Web Share with file, else download
      try {
        fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
          var file = new File([blob], "roast-my-website.png", { type: "image/png" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: "Roast My Website 🔥", text: "Meine Website wurde geröstet 🔥" }).catch(function () {});
          } else {
            triggerDownload(dataUrl);
          }
        }).catch(function () { triggerDownload(dataUrl); });
      } catch (e) { triggerDownload(dataUrl); }
    };
    if (!window.htmlToImage) { return; }
    card.classList.add("snapshot");
    window.htmlToImage.toPng(card, { pixelRatio: 2, backgroundColor: "#0c0a09", cacheBust: true })
      .then(function (dataUrl) { card.classList.remove("snapshot"); done(dataUrl); })
      .catch(function () { card.classList.remove("snapshot"); });
  }
  function triggerDownload(dataUrl) {
    var a = document.createElement("a");
    a.href = dataUrl; a.download = "roast-my-website.png";
    document.body.appendChild(a); a.click(); a.remove();
  }

  function onAgain() {
    els.result.classList.remove("on");
    els.roastCard.classList.remove("reveal");
    setTimeout(function () { els.result.hidden = true; }, FAST ? 0 : 300);
    els.mascotStage.dataset.mood = "idle";
    els.input.value = "";
    window.scrollTo({ top: 0, behavior: FAST ? "auto" : "smooth" });
    els.input.focus();
  }

  // ---------- init ----------
  function init() {
    els = {
      form: $("#roast-form"), input: $("#url-input"), roastBtn: $("#roast-btn"),
      formHint: $("#form-hint"), counterNum: $("#counter-num"),
      mascotStage: $("#mascot-stage"),
      roasting: $("#roasting"), heatFill: $("#heat-fill"), ticker: $("#ticker"),
      roastingTarget: $("#roasting-target"),
      result: $("#result"), roastCard: $("#roast-card"), cardUrl: $("#card-url"),
      ringFg: $("#ring-fg"), scoreNum: $("#score-num"), scoreLabel: $("#score-label"),
      roastList: $("#roast-list"), realTip: $("#real-tip"),
      shareBtn: $("#share-btn"), againBtn: $("#again-btn"),
      history: $("#history"), historyList: $("#history-list"),
    };
    els.form.addEventListener("submit", onSubmit);
    els.shareBtn.addEventListener("click", onShare);
    els.againBtn.addEventListener("click", onAgain);

    loadCounter();
    if (els.counterNum) els.counterNum.textContent = String(roastCount);
    renderHistory();

    // Test/Debug hooks
    window.__wr = {
      normalizeUrl: normalizeUrl,
      verdictFor: verdictFor,
      scoreBucket: scoreBucket,
      runRoast: runRoast,
      showResult: showResult,
      showError: showError,
      submit: onSubmit,
      again: onAgain,
      getLast: function () { return lastResult; },
      isFast: FAST,
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
