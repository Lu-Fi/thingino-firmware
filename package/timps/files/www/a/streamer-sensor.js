// streamer-sensor.js - Sensor IQ File page helper.
(function () {
  "use strict";

  if (!document.body || document.body.id !== "page-streamer-sensor") return;

  function toast(type, message, ms) {
    if (typeof window.showAlert === "function") window.showAlert(type, message, ms);
    else console.log("[streamer-sensor]", type + ":", message);
  }

  function init() {
    var saveBtn = document.getElementById("save-prudynt-config");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        toast(
          "success",
          "Sensor settings are saved live to the streamer configuration; restart the streamer to re-initialise the sensor.",
          5000,
        );
      });
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
