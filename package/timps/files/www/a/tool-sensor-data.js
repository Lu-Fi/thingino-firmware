/* tool-sensor-data.js - day/night tuning graph.
 *
 * The series lives in the DAEMON (a ring in timps' events.c, sized by
 * daynight.history_s), not here: the WebUI is plain HTTP on a LAN IP, so
 * navigator.serviceWorker is undefined and a hidden or closed tab collects
 * nothing at all. This page just pages through that ring with a cursor -
 * backfill with ?last=N on load, then follow "next" - so a graph opened after
 * an hour of not looking still shows the hour.
 *
 * daynight.history_s defaults to 0, so a camera nobody watches carries no ring
 * at all. Opening this page is what turns it on, and closing it hands it back -
 * unless "collect in background" is on, which is the whole point of the daemon
 * holding the series in the first place.
 */
(function () {
  const chartCanvas = $("#dataChart");
  if (!chartCanvas || typeof Chart === "undefined") return;

  const POLL_MS = 10000;        // matches the daemon's sample period
  const POLL_HIDDEN_MS = 60000; // still collecting server-side; just look less
  const RETAIN_S = 14400;       // 4 h, what opening the page turns collection on to

  // Best-effort viewer set, so a second tab on this camera does not lose its
  // series when the first one closes. localStorage is per-origin and the origin
  // IS the camera, so nothing here needs to name a host. Entries are
  // heartbeated and pruned, so a tab that crashed expires instead of pinning
  // collection on forever. Other browsers and devices are invisible to this,
  // and deliberately so: a LAN tuning page does not need a distributed viewer
  // count, it needs to not break the two-tabs case.
  const VIEWERS_KEY = "timps.dnhist.viewers";
  const VIEWER_STALE_MS = 45000;

  function viewerBeat(id, alive) {
    let others = 0;
    try {
      const now = Date.now();
      const m = JSON.parse(localStorage.getItem(VIEWERS_KEY) || "{}");
      if (alive) m[id] = now; else delete m[id];
      Object.keys(m).forEach((k) => {
        if (now - m[k] > VIEWER_STALE_MS) delete m[k];
        else if (k !== id) others += 1;
      });
      localStorage.setItem(VIEWERS_KEY, JSON.stringify(m));
    } catch (e) { /* storage off: assume we are the only viewer */ }
    return others;
  }

  function fmtDur(s) {
    if (s >= 3600) return `${Math.round(s / 360) / 10} h`;
    return s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`;
  }

  class SensorDataCollector {
    constructor() {
      this.maxPoints = 300;
      this.samples = [];   // {t, gain, exposure, luma, bright, mode}
      this.chart = null;
      this.isPaused = false;
      this.cursor = null;  // next seq to ask for
      this.head = null;
      this.clock = null;   // {t_now, wall_now} from the newest response
      this.nightThreshold = null;
      this.dayThreshold = null;
      this.timer = null;
      this.retainS = null;   // the daemon's live daynight.history_s
      this.sawRetain = false;
      this.bgCollect = false;
      this.weEnabled = false; // this tab owes the daemon a history_s = 0
      this.acquiring = false;
      this.viewerId = `${Date.now()}.${String(Math.random()).slice(2, 8)}`;
      this.token = "";

      this.metrics = [
        { key: "exposure", label: "Exposure Index", color: "#FF6384" },
        { key: "gain", label: "Total Gain", color: "#36A2EB" },
        { key: "luma", label: "AE Luma", color: "#FFCE56", axis: "y2" },
        { key: "bright", label: "Brightness %", color: "#B8FF4D", axis: "y2" },
      ];

      this.init();
    }

    init() {
      this.setupEventListeners();
      this.initChart();
      this.othersAtLoad = viewerBeat(this.viewerId, true);
      // cached ahead of time: the teardown runs during unload, where there is
      // no room left for the token round trip
      if (window.timpsApi) {
        window.timpsApi.token().then((t) => { this.token = t || ""; });
      }
      this.reload();
      document.addEventListener("visibilitychange", () => this.schedule());
      // pagehide, not visibilitychange: a backgrounded tab must keep collecting
      // (that is what the daemon-side ring is FOR), only a real close or
      // navigation hands it back. No beforeunload listener - it would cost
      // bfcache eligibility and covers nothing pagehide misses.
      window.addEventListener("pagehide", () => this.release());
      window.addEventListener("pageshow", (e) => {
        if (!e.persisted) return;   // restored from bfcache: re-acquire
        viewerBeat(this.viewerId, true);
        this.sawRetain = false;
        this.reload();
      });
    }

    setupEventListeners() {
      const clearBtn = $("#clear-data");
      const pauseBtn = $("#toggle-pause");
      const exportJsonBtn = $("#export-json");
      const exportCsvBtn = $("#export-csv");
      const pointButtons = $$("#max-points button");

      if (clearBtn) {
        clearBtn.addEventListener("click", () => this.clearData());
      }
      if (pauseBtn) {
        pauseBtn.addEventListener("click", (e) => this.togglePause(e));
      }
      if (exportJsonBtn) {
        exportJsonBtn.addEventListener("click", () => this.exportJSON());
      }
      if (exportCsvBtn) {
        exportCsvBtn.addEventListener("click", () => this.exportCSV());
      }
      const bgBox = $("#bg-collect");
      if (bgBox) {
        bgBox.addEventListener("change", (e) => this.setBackground(e.target.checked));
      }
      pointButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          pointButtons.forEach((b) => {
            b.classList.remove("btn-primary", "active");
            b.classList.add("btn-secondary");
          });
          e.target.classList.remove("btn-secondary");
          e.target.classList.add("btn-primary", "active");
          const want = parseInt(e.target.dataset.points, 10) || 300;
          const grew = want > this.maxPoints;
          this.maxPoints = want;
          // a bigger window is a backfill request, not just a trim
          if (grew) this.reload();
          else { this.trimData(); this.render(); }
        });
      });
    }

    initChart() {
      this.chart = new Chart(chartCanvas.getContext("2d"), {
        type: "line",
        data: {
          labels: [],
          datasets: [],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: {
            mode: "index",
            intersect: false,
          },
          plugins: {
            legend: {
              display: true,
              position: "bottom",
              labels: { boxWidth: 12, font: { size: 10 } },
            },
          },
          scales: {
            x: {
              display: true,
              ticks: { maxTicksLimit: 12, autoSkip: true },
              title: {
                display: true,
                text: "Time",
              },
            },
            y: {
              display: true,
              beginAtZero: true,
              title: {
                display: true,
                text: "Gain / exposure index",
              },
            },
            // luma (0-255) and brightness (0-100 %) are three orders of
            // magnitude below a railed gain and would be a flat line on y
            y2: {
              display: true,
              position: "right",
              beginAtZero: true,
              suggestedMax: 255,
              grid: { drawOnChartArea: false },
              title: {
                display: true,
                text: "Luma / %",
              },
            },
            y1: {
              display: false,
              type: "linear",
              min: 0,
              max: 1,
              position: "right",
            },
          },
        },
      });
    }

    /* ---- data ---------------------------------------------------------- */

    schedule() {
      viewerBeat(this.viewerId, true);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.poll(),
                              document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    }

    /* ---- collection on/off --------------------------------------------- */

    // opening the page is the enable: the graph fills by itself, the way it did
    // before the series moved into the daemon.
    acquire() {
      if (this.retainS || this.acquiring || !window.timpsApi) return;
      this.acquiring = true;
      window.timpsApi.set({ daynight: { history_s: RETAIN_S } }).then(
        () => {
          this.acquiring = false;
          this.retainS = RETAIN_S;
          this.weEnabled = true;
          this.syncBgUi();
          this.schedule();
        },
        () => { this.acquiring = false; },
      );
    }

    // Runs during unload, so: no promises, no token fetch, and a text/plain
    // body - a preflight is not guaranteed to be sent at all at this point, and
    // text/plain keeps this a simple cross-origin request that needs none.
    release() {
      const others = viewerBeat(this.viewerId, false);
      if (this.bgCollect || !this.weEnabled || others || !window.timpsApi) return;
      this.weEnabled = false;
      const url = window.timpsApi.base() + "/control"
                + (this.token ? `?token=${encodeURIComponent(this.token)}` : "");
      const body = JSON.stringify({ daynight: { history_s: 0 } });
      try {
        if (navigator.sendBeacon(url, new Blob([body], { type: "text/plain" })))
          return;
      } catch (e) { /* fall through */ }
      try {
        fetch(url, {
          method: "POST", body, keepalive: true,
          headers: { "Content-Type": "text/plain" },
        }).catch(() => {});
      } catch (e) { /* nothing left to try */ }
    }

    // The switch only decides what happens on CLOSE. Turning it off while the
    // page is open must not stop the graph mid-session - it just makes the
    // teardown ours, even if it was the config or another session that started
    // collection.
    setBackground(on) {
      this.bgCollect = on;
      if (on) this.acquire();
      else this.weEnabled = true;
      this.syncBgUi();
    }

    syncBgUi() {
      const box = $("#bg-collect");
      if (box) box.checked = this.bgCollect;
      const note = $("#bg-collect-note");
      if (!note) return;
      if (!this.retainS) note.textContent = "— not recording";
      else if (this.bgCollect)
        note.textContent = `— keeps recording a ${fmtDur(this.retainS)} window after this page is`
                         + " closed, until the camera restarts";
      else
        note.textContent = "— recording for this visit; closing this page stops it";
    }

    // full backfill: ask from the newest maxPoints samples and follow "next"
    // until the daemon says we are level with its head.
    reload() {
      this.samples = [];
      this.cursor = null;
      this.fetchPage({ last: this.maxPoints });
    }

    poll() {
      if (this.cursor === null) this.reload();
      else this.fetchPage({ since: this.cursor });
    }

    fetchPage(opts) {
      if (!window.timpsApi || !window.timpsApi.dnHistory) {
        console.error("timps-api.js too old: no dnHistory()");
        this.updateStreamStatus(false);
        return;
      }
      window.timpsApi.dnHistory(opts).then(
        (d) => this.ingest(d),
        () => { this.updateStreamStatus(false); this.schedule(); },
      );
    }

    ingest(d) {
      this.updateStreamStatus(true);
      this.clock = { t_now: Number(d.t_now), wall_now: Number(d.wall_now) };
      this.head = Number(d.head);
      if (isFinite(Number(d.night_gain))) this.nightThreshold = Number(d.night_gain);
      if (isFinite(Number(d.day_gain))) this.dayThreshold = Number(d.day_gain);

      // the switch tracks the daemon, never a remembered local state: already
      // collecting when we arrived means someone asked for it to survive a
      // closed page - the config, or another session's switch. Unless a sibling
      // tab was already registered, in which case the collection is THAT tab's
      // visit and claiming otherwise would strand it running forever once both
      // are closed. We also never took ownership (weEnabled stays false), so a
      // wrongly-off switch here still cannot tear down someone else's series.
      this.retainS = Number(d.retain_s) || 0;
      if (!this.sawRetain) {
        this.sawRetain = true;
        this.bgCollect = this.retainS > 0 && !this.othersAtLoad;
      }
      if (!this.retainS) this.acquire();
      this.syncBgUi();

      // our cursor fell out of the ring's retained window: the series has a
      // hole, so refetch it whole rather than splicing across the gap
      if (d.lapped && this.samples.length) { this.reload(); return; }

      if (!this.isPaused) {
        (d.samples || []).forEach((r) => {
          this.samples.push({
            t: r[0], gain: r[1], exposure: r[2],
            luma: r[3], bright: r[4], mode: r[5],
          });
        });
        this.trimData();
      }
      this.cursor = Number(d.next);

      // one chart update per response, not per sample - a 600-row backfill
      // would otherwise redraw 600 times
      this.render();

      // still behind the daemon's head: keep paging immediately
      if (this.cursor !== this.head) this.fetchPage({ since: this.cursor });
      else this.schedule();
    }

    trimData() {
      if (this.samples.length > this.maxPoints)
        this.samples.splice(0, this.samples.length - this.maxPoints);
    }

    // samples are stamped with the daemon's MONOTONIC clock; every response
    // carries the (t_now, wall_now) pair to convert against. Deriving labels
    // fresh on each render is what keeps the series intact across the NTP
    // step this camera takes shortly after boot.
    wallOf(s) {
      if (!this.clock) return new Date();
      return new Date((this.clock.wall_now - (this.clock.t_now - s.t)) * 1000);
    }

    // -1 is the daemon's "not measurable"; Chart.js draws a null as a gap
    // rather than a dip to zero
    static val(v) {
      return (typeof v === "number" && v >= 0) ? v : null;
    }

    /* ---- rendering ----------------------------------------------------- */

    render() {
      const S = SensorDataCollector;
      this.chart.data.labels = this.samples.map((s) =>
        this.wallOf(s).toLocaleTimeString());
      this.chart.data.datasets = [];

      this.metrics.forEach((metric) => {
        this.chart.data.datasets.push({
          label: metric.label,
          data: this.samples.map((s) => S.val(s[metric.key])),
          borderColor: metric.color,
          backgroundColor: `${metric.color}20`,
          borderWidth: 2,
          tension: 0.4,
          fill: false,
          pointRadius: 1,
          pointBackgroundColor: metric.color,
          pointBorderColor: metric.color,
          pointBorderWidth: 1,
          yAxisID: metric.axis || "y",
        });
      });

      const n = this.samples.length;
      if (this.nightThreshold !== null && !Number.isNaN(this.nightThreshold)) {
        this.chart.data.datasets.push({
          label: `Night Threshold (${this.nightThreshold})`,
          data: Array(n).fill(this.nightThreshold),
          borderColor: "rgba(255, 0, 0, 0.7)",
          borderWidth: 1,
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0,
        });
      }
      if (this.dayThreshold !== null && !Number.isNaN(this.dayThreshold)) {
        this.chart.data.datasets.push({
          label: `Day Threshold (${this.dayThreshold})`,
          data: Array(n).fill(this.dayThreshold),
          borderColor: "rgba(0, 255, 0, 0.7)",
          borderWidth: 1,
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0,
        });
      }
      if (n) {
        this.chart.data.datasets.push({
          label: "Mode (0=Day, 1=Night)",
          data: this.samples.map((s) => (s.mode >= 0 ? s.mode : null)),
          borderColor: "rgba(128, 128, 128, 0.5)",
          backgroundColor: "rgba(128, 128, 128, 0.1)",
          borderWidth: 1,
          tension: 0,
          fill: false,
          pointRadius: 0,
          yAxisID: "y1",
        });
      }

      this.chart.update("none");
      this.updateStatsDisplay();
    }

    // recomputed over the whole loaded window rather than accumulated: a
    // backfill arrives as a batch, and a trimmed-away sample must stop
    // counting towards min/max/avg
    stats() {
      const S = SensorDataCollector;
      const out = {};
      this.metrics.forEach((metric) => {
        let min = null, max = null, sum = 0, count = 0, latest = null;
        this.samples.forEach((s) => {
          const v = S.val(s[metric.key]);
          if (v === null) return;
          if (min === null || v < min) min = v;
          if (max === null || v > max) max = v;
          sum += v; count += 1; latest = v;
        });
        if (count) out[metric.key] = { latest, min, max, avg: sum / count, count };
      });
      return out;
    }

    updateStatsDisplay() {
      const container = $("#data-stats");
      if (!container) return;
      const stats = this.stats();
      container.innerHTML = "";

      this.metrics.forEach((metric) => {
        const stat = stats[metric.key];
        if (!stat) return;
        const div = document.createElement("div");
        div.className = `stat-card ${metric.key}`;
        div.innerHTML = `
          <div class="stat-label">${metric.label}</div>
          <div class="stat-value">${stat.latest.toFixed(1)}</div>
          <div class="stat-detail">Min: ${stat.min.toFixed(1)} | Max: ${stat.max.toFixed(1)} | Avg: ${stat.avg.toFixed(1)}</div>
        `;
        container.appendChild(div);
      });
    }

    /* ---- controls ------------------------------------------------------ */

    async clearData() {
      const confirmed = await confirm("Clear all data?");
      if (!confirmed) return;
      // only the local view: the daemon's ring keeps its series (the switch
      // below is what decides whether it keeps collecting)
      this.samples = [];
      this.render();
    }

    togglePause(e) {
      this.isPaused = !this.isPaused;
      if (e && e.target) {
        e.target.textContent = this.isPaused ? "Resume" : "Pause";
        e.target.classList.toggle("btn-warning", this.isPaused);
        e.target.classList.toggle("btn-secondary", !this.isPaused);
      }
      // resuming backfills the paused stretch out of the ring
      if (!this.isPaused) this.reload();
    }

    updateStreamStatus(connected) {
      const statusIcon = $("#stream-status");
      if (!statusIcon) return;
      if (connected) {
        statusIcon.classList.remove("disconnected");
        statusIcon.classList.add("connected");
        statusIcon.title = "Connected - the camera is collecting continuously";
      } else {
        statusIcon.classList.remove("connected");
        statusIcon.classList.add("disconnected");
        statusIcon.title = "Disconnected - retrying...";
      }
    }

    /* ---- export -------------------------------------------------------- */

    exportJSON() {
      const payload = {
        exported_at: new Date().toISOString(),
        stats: this.stats(),
        samples: this.samples.map((s) => ({
          time: this.wallOf(s).toISOString(),
          exposure: s.exposure, total_gain: s.gain,
          ae_luma: s.luma, brightness: s.bright, mode: s.mode,
        })),
      };
      this.downloadFile(
        JSON.stringify(payload, null, 2),
        "sensor-data.json",
        "application/json",
      );
    }

    exportCSV() {
      const headers = this.metrics.map((m) => m.label).join(",");
      const rows = this.samples.map((s) => {
        const values = this.metrics
          .map((m) => {
            const v = SensorDataCollector.val(s[m.key]);
            return v === null ? "" : v.toFixed(2);
          })
          .join(",");
        return `"${this.wallOf(s).toISOString()}",${values}`;
      });
      const csv = `Time,${headers}\n${rows.join("\n")}`;
      this.downloadFile(csv, "sensor-data.csv", "text/csv");
    }

    downloadFile(content, filename, type) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  new SensorDataCollector();
})();
