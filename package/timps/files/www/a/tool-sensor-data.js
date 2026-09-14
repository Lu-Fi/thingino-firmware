(function () {
  const chartCanvas = $("#dataChart");
  if (!chartCanvas || typeof Chart === "undefined") return;

  class SensorDataCollector {
    constructor() {
      this.maxPoints = 300;
      this.data = {};
      this.chart = null;
      this.stream = null;
      this.isPaused = false;
      this.nightThreshold = null;
      this.dayThreshold = null;
      this.modeData = [];
      this.stats = {};

      this.metrics = [
        { key: "exposure", label: "Exposure Index", color: "#FF6384" },
        { key: "total_gain", label: "Total Gain", color: "#36A2EB" },
        { key: "ae_luma", label: "AE Luma", color: "#FFCE56", axis: "y2" },
        { key: "daynight_brightness", label: "Brightness %", color: "#B8FF4D", axis: "y2" },
      ];

      this.init();
    }

    init() {
      this.setupEventListeners();
      this.initChart();
      this.startStream();
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
      pointButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          pointButtons.forEach((b) => {
            b.classList.remove("btn-primary", "active");
            b.classList.add("btn-secondary");
          });
          e.target.classList.remove("btn-secondary");
          e.target.classList.add("btn-primary", "active");
          this.maxPoints = parseInt(e.target.dataset.points, 10) || 300;
          this.trimData();
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

    startStream() {
      if (this.stream) return;
      if (!window.timpsApi) {
        console.error("timps-api.js not loaded");
        this.updateStreamStatus(false);
        return;
      }
      // timps pushes "daynight" over its native SSE /events. raw:true asks it
      // to tick at daynight.interval_ms instead of only on a meaningful change
      // - without it a static scene yields exactly the one on-connect snapshot,
      // which is not a series. Reconnects (token refresh + tab visibility) are
      // handled inside timps-api.js.
      this.stream = window.timpsApi.events(
        "daynight",
        (type, d) => {
          if (this.isPaused || !d) return;
          this.updateStreamStatus(true);
          this.nightThreshold = Number(d.night_gain);
          this.dayThreshold = Number(d.day_gain);
          this.addDataPoint({
            time_now: Math.floor(Date.now() / 1000),
            exposure: d.exposure,
            total_gain: d.total_gain,
            ae_luma: d.ae_luma,
            daynight_brightness: d.brightness,
            daynight_mode: Number(d.mode) === 1 ? "night" : "day",
          });
        },
        () => this.updateStreamStatus(false),
        { raw: true },
      );
      this.updateStreamStatus(true);
    }

    addDataPoint(jsonData, updateChart = true) {
      const timestamp = new Date(parseInt(jsonData.time_now, 10) * 1000);
      const timeStr = timestamp.toLocaleTimeString();

      this.chart.data.labels.push(timeStr);

      const currentMode = jsonData.daynight_mode === "night" ? 1 : 0;
      this.modeData.push(currentMode);

      this.metrics.forEach((metric) => {
        if (!this.data[metric.key]) {
          this.data[metric.key] = [];
        }
        // every series stays index-aligned with labels; timps reports -1 for
        // "not measurable", which Chart.js renders as a gap rather than a dip
        const value = parseFloat(jsonData[metric.key]);
        if (Number.isNaN(value) || value < 0) {
          this.data[metric.key].push(null);
        } else {
          this.data[metric.key].push(value);
          this.updateStats(metric.key, value);
        }
      });

      this.trimData();
      if (updateChart) {
        this.updateChart();
      }
    }

    updateStats(metricKey, value) {
      if (!this.stats[metricKey]) {
        this.stats[metricKey] = {
          latest: value,
          min: value,
          max: value,
          avg: value,
          count: 1,
          sum: value,
        };
      } else {
        const stat = this.stats[metricKey];
        stat.latest = value;
        stat.min = Math.min(stat.min, value);
        stat.max = Math.max(stat.max, value);
        stat.count += 1;
        stat.sum += value;
        stat.avg = stat.sum / stat.count;
      }

      this.updateStatsDisplay();
    }

    updateStatsDisplay() {
      const container = $("#data-stats");
      if (!container) return;
      container.innerHTML = "";

      this.metrics.forEach((metric) => {
        const stat = this.stats[metric.key];
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

    updateChart() {
      this.chart.data.datasets = [];

      this.metrics.forEach((metric) => {
        if (!this.data[metric.key]) return;
        this.chart.data.datasets.push({
          label: metric.label,
          data: this.data[metric.key],
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

      if (this.nightThreshold !== null && this.data.total_gain) {
        const labelCount = this.chart.data.labels.length;
        if (!Number.isNaN(this.nightThreshold)) {
          this.chart.data.datasets.push({
            label: `Night Threshold (${this.nightThreshold})`,
            data: Array(labelCount).fill(this.nightThreshold),
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
            data: Array(labelCount).fill(this.dayThreshold),
            borderColor: "rgba(0, 255, 0, 0.7)",
            borderWidth: 1,
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0,
          });
        }
      }

      if (this.modeData.length > 0) {
        this.chart.data.datasets.push({
          label: "Mode (0=Day, 1=Night)",
          data: this.modeData,
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
    }

    trimData() {
      if (this.chart.data.labels.length > this.maxPoints) {
        const excess = this.chart.data.labels.length - this.maxPoints;
        this.chart.data.labels.splice(0, excess);
        this.modeData.splice(0, excess);
        this.metrics.forEach((metric) => {
          if (this.data[metric.key]) {
            this.data[metric.key].splice(0, excess);
          }
        });
      }
    }

    async clearData() {
      const confirmed = await confirm("Clear all data?");
      if (!confirmed) return;
      this.data = {};
      this.modeData = [];
      this.stats = {};
      this.chart.data.labels = [];
      this.chart.data.datasets = [];
      this.chart.update();
      this.updateStatsDisplay();
    }

    togglePause(e) {
      this.isPaused = !this.isPaused;
      if (e && e.target) {
        e.target.textContent = this.isPaused ? "Resume" : "Pause";
        e.target.classList.toggle("btn-warning", this.isPaused);
        e.target.classList.toggle("btn-secondary", !this.isPaused);
      }
    }

    updateStreamStatus(connected) {
      const statusIcon = $("#stream-status");
      if (!statusIcon) return;
      if (connected) {
        statusIcon.classList.remove("disconnected");
        statusIcon.classList.add("connected");
        statusIcon.title = "Connected - Collecting sensor data";
      } else {
        statusIcon.classList.remove("connected");
        statusIcon.classList.add("disconnected");
        statusIcon.title = "Disconnected - Reconnecting...";
      }
    }

    exportJSON() {
      const payload = {
        exported_at: new Date().toISOString(),
        stats: this.stats,
        datapoints: this.data,
        labels: this.chart.data.labels,
      };
      this.downloadFile(
        JSON.stringify(payload, null, 2),
        "sensor-data.json",
        "application/json",
      );
    }

    exportCSV() {
      const headers = this.metrics.map((m) => m.label).join(",");
      const rows = this.chart.data.labels.map((label, idx) => {
        const values = this.metrics
          .map((m) => {
            const series = this.data[m.key];
            const value = series ? series[idx] : undefined;
            return typeof value === "number" ? value.toFixed(2) : "";
          })
          .join(",");
        return `"${label}",${values}`;
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
