// timps-ui.js - stream tabs, restart bar and live/restart badges shared by the video pages.
(function () {
  "use strict";

  var pending = [];
  var onRestarted = null;

  function toast(type, message, ms) {
    if (typeof window.showAlert === "function") window.showAlert(type, message, ms);
    else console.log("[timps-ui]", type + ":", message);
  }

  function initialStream() {
    var m = /[?&]s=([01])\b/.exec(location.search);
    if (m) return +m[1];
    try {
      var v = localStorage.getItem("timps-stream");
      if (v === "0" || v === "1") return +v;
    } catch (e) {}
    return 0;
  }

  // Wire the [data-stream-tab] buttons; onChange(i) runs on user switches.
  function initTabs(onChange) {
    var tabs = document.querySelectorAll("[data-stream-tab]");
    function set(i, fire) {
      Array.prototype.forEach.call(tabs, function (t) {
        var on = +t.getAttribute("data-stream-tab") === i;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", String(on));
      });
      try { localStorage.setItem("timps-stream", String(i)); } catch (e) {}
      try {
        var u = new URL(location.href);
        u.searchParams.set("s", String(i));
        history.replaceState(null, "", u);
      } catch (e) {}
      var pv = document.getElementById("preview");
      if (pv) {
        pv.setAttribute("data-stream", "ch" + i);
        if (fire && window.restartStreamPreview) window.restartStreamPreview();
      }
      if (fire) onChange(i);
    }
    Array.prototype.forEach.call(tabs, function (t) {
      t.addEventListener("click", function () { set(+t.getAttribute("data-stream-tab"), true); });
    });
    var cur = initialStream();
    set(cur, false);
    return cur;
  }

  function setTabSummary(i, text) {
    var el = document.querySelector('[data-stream-tab="' + i + '"] small');
    if (el) el.textContent = text;
  }

  function badge(live) {
    return '<span class="tv-badge ' + (live ? "live" : "rst") + '">' +
      (live ? "live" : "restart") + "</span>";
  }

  function bar() {
    var b = document.getElementById("tv-pending");
    if (b) return b;
    b = document.createElement("div");
    b.id = "tv-pending";
    b.className = "tv-pending";
    b.hidden = true;
    b.innerHTML =
      '<b>Waiting for a streamer restart:</b><span class="tv-keys"></span>' +
      '<button type="button" class="btn btn-sm btn-outline-secondary tv-later">Later</button>' +
      '<button type="button" class="btn btn-sm btn-warning tv-restart">' +
      '<i class="bi bi-arrow-clockwise me-1"></i>Restart streamer</button>';
    document.body.appendChild(b);
    b.querySelector(".tv-later").addEventListener("click", function () { b.hidden = true; });
    b.querySelector(".tv-restart").addEventListener("click", restart);
    return b;
  }

  function markPending(keys) {
    (keys || []).forEach(function (k) { if (pending.indexOf(k) < 0) pending.push(k); });
    if (!pending.length) return;
    var b = bar();
    b.querySelector(".tv-keys").textContent = pending.join(", ");
    b.hidden = false;
  }

  function waitBack(tries) {
    if (!window.timpsApi) return;
    window.timpsApi.get().then(function () {
      toast("success", "Streamer is back.", 3000);
      if (onRestarted) onRestarted();
    }, function () {
      if (tries > 0) setTimeout(function () { waitBack(tries - 1); }, 2000);
    });
  }

  function restart() {
    var b = bar();
    b.querySelector(".tv-restart").disabled = true;
    fetch("/x/restart-prudynt.cgi", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        pending = [];
        b.hidden = true;
        toast("info", "Restarting the streamer…", 4000);
        setTimeout(function () { waitBack(15); }, 4000);
      })
      .catch(function (err) { toast("danger", "Restart failed: " + err.message); })
      .then(function () { b.querySelector(".tv-restart").disabled = false; });
  }

  window.timpsUi = {
    initTabs: initTabs,
    setTabSummary: setTabSummary,
    badge: badge,
    markPending: markPending,
    onRestarted: function (fn) { onRestarted = fn; },
    toast: toast,
  };
})();
