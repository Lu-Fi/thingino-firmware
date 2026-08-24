/* PTZ joystick for the preview page.
 *
 * Two transports, chosen at page load:
 *
 *   CGI   - one fetch() to /x/json-motor.cgi per command. Always available.
 *   WS    - one WebSocket to motors-daemon, opened once when the panel
 *           appears. Only when the firmware was built with
 *           BR2_PACKAGE_THINGINO_MOTORS_WS, which reaches the browser as
 *           window.thinginoUIConfig.device.motorsWs (thingino-webui's
 *           assemble_plugins.py turns each plugin manifest's featureFlags
 *           into that object in the generated /a/plugins.js).
 *
 * The build flag is necessary but never sufficient: the daemon can still have
 * motors.ws_enabled = false, the token file can be unreadable, the page can
 * be served over https where a ws:// socket is blocked as mixed content. So
 * everything below treats "is the socket open right now" as the real
 * question, and the CGI path stays wired up underneath at all times. When the
 * flag is off, nothing here does anything it did not do before - no token
 * fetch, no socket, and the same setInterval hold loop as always.
 */

function runMotorCmd(args) {
  return fetch(`/x/json-motor.cgi?${args}`)
    .then((res) => res.json())
    .then(({ message }) => {
      const { xpos, ypos } = message || {};
      if (xpos !== undefined && ypos !== undefined) {
        console.log("Position:" + xpos + "," + ypos);
      }
      return message;
    });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------------------------------------------- *
 * WebSocket transport
 *
 * Token handling follows the shape timps already uses on this device
 * (a/timps-api.js + x/timps-token.cgi): a memoised fetch of a small CGI that
 * reads a root-only per-boot token file and hands back {token, port}. It goes
 * in the query string rather than a header because the browser's WebSocket
 * constructor cannot set request headers on the opening handshake - the same
 * limitation that forces timps's EventSource to do it - and motors-daemon
 * accepts ?token= for exactly that reason.
 * ---------------------------------------------------------------------- */

const MOTOR_WS_TOKEN_URL = "/x/json-motor-token.cgi";
const MOTOR_WS_CONNECT_TIMEOUT_MS = 4000;
/* Give up on the socket after this many consecutive failed attempts and stay
 * on the CGI path for the rest of the page's life. A camera whose daemon is
 * genuinely without a listener must not be probed once per button press. */
const MOTOR_WS_MAX_ATTEMPTS = 3;

const motorWs = (function () {
  let socket = null;
  let connecting = null;
  let attempts = 0;
  let seq = 1;
  const limits = { x: 0, y: 0 };

  function buildFlagSet() {
    const cfg = window.thinginoUIConfig || {};
    return !!(cfg.device && cfg.device.motorsWs === true);
  }

  function usable() {
    if (!buildFlagSet()) return false;
    if (attempts >= MOTOR_WS_MAX_ATTEMPTS) return false;
    /* A ws:// socket from an https:// page is blocked as mixed content, and
     * this listener is plain ws:// by design. Better to notice that here than
     * to let every connect attempt fail opaquely. */
    if (location.protocol === "https:") return false;
    return true;
  }

  function onMessage(ev) {
    let frame;
    try {
      frame = JSON.parse(ev.data);
    } catch (err) {
      return;
    }
    if (frame.type === "hello" || frame.type === "status") {
      /* The daemon's own view of the travel limits. Preferred over the
       * configured steps_pan/steps_tilt for hold-to-move because it is what
       * motor_ctl_relative() actually clamps against; 0 means "unknown",
       * which is the signal to keep using fixed-size steps instead. */
      if (typeof frame.x_max === "number") limits.x = frame.x_max;
      if (typeof frame.y_max === "number") limits.y = frame.y_max;
      if (typeof frame.x === "number" && typeof frame.y === "number") {
        console.log("Position:" + frame.x + "," + frame.y);
      }
    }
  }

  function openSocket(info) {
    const port = parseInt(info.port, 10) || 8089;
    const url =
      "ws://" +
      location.hostname +
      ":" +
      port +
      "/ws?token=" +
      encodeURIComponent(info.token);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch (err) {
          /* already gone */
        }
        reject(new Error("connect timeout"));
      }, MOTOR_WS_CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(timer);
        socket = ws;
        attempts = 0;
        /* Ask for position pushes. The daemon polls the driver server-side
         * and only emits a frame when something changed, so an idle panel
         * costs one heartbeat every 5s rather than a request per tick. */
        try {
          ws.send(JSON.stringify({ cmd: "subscribe", interval_ms: 200 }));
        } catch (err) {
          /* the send below will report it */
        }
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("socket error"));
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
      };
      ws.onmessage = onMessage;
    });
  }

  function connect() {
    if (!usable()) return Promise.resolve(null);
    if (socket && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(socket);
    }
    if (connecting) return connecting;

    attempts += 1;
    connecting = fetch(MOTOR_WS_TOKEN_URL, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((info) => {
        if (!info || info.enabled === false || !info.token) {
          throw new Error("listener not available");
        }
        return openSocket(info);
      })
      .catch((err) => {
        console.warn(
          "motors: WebSocket control unavailable, using the CGI path",
          err,
        );
        socket = null;
        return null;
      })
      .then((ws) => {
        connecting = null;
        return ws;
      });

    return connecting;
  }

  /* Synchronous, and deliberately so: every caller is on a pointer event and
   * has a CGI fallback ready. Returns false rather than queueing, so a
   * half-open socket can never swallow a stop. */
  function trySend(obj) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      obj.id = seq++;
      socket.send(JSON.stringify(obj));
      return true;
    } catch (err) {
      console.warn("motors: WebSocket send failed", err);
      return false;
    }
  }

  return {
    connect,
    trySend,
    isOpen: () => !!socket && socket.readyState === WebSocket.OPEN,
    limits,
    enabledAtBuild: buildFlagSet,
  };
})();

function normalizePreviewControlMode(value) {
  return value === "continuous" ? "continuous" : "step";
}

function getPreviewControlMode() {
  const motorParams = window.motorParams || {};
  return normalizePreviewControlMode(motorParams.preview_control_mode);
}

async function ensureMotorParams() {
  if (window.motorParams) {
    return window.motorParams;
  }
  try {
    const response = await fetch("/x/json-motor-params.cgi");
    const motorParams = await response.json();
    window.motorParams = motorParams;
    return motorParams;
  } catch (error) {
    console.error("Failed to load motor parameters:", error);
    window.motorParams = {
      steps_pan: 0,
      steps_tilt: 0,
      pos_0_x: 0,
      pos_0_y: 0,
      preview_control_mode: "step",
    };
    return window.motorParams;
  }
}

/* Sign of the requested travel on each axis, from the joystick's data-dir
 * ("ul", "cr", "dc", ...). Shared by step mode and hold mode so the two can
 * never disagree about which way "up" is. */
function motorDirSigns(dir) {
  return {
    x: dir.includes("l") ? -1 : dir.includes("r") ? 1 : 0,
    y: dir.includes("d") ? -1 : dir.includes("u") ? 1 : 0,
  };
}

async function moveMotor(dir, steps = 100, d = "g") {
  // Use motor parameters loaded from backend
  const motorParams = window.motorParams || {
    steps_pan: 0,
    steps_tilt: 0,
    pos_0_x: 0,
    pos_0_y: 0,
  };
  const x_max = motorParams.steps_pan;
  const y_max = motorParams.steps_tilt;
  const x0 = Number(motorParams.pos_0_x);
  const y0 = Number(motorParams.pos_0_y);
  const step = x_max / steps;
  if (dir === "homing") {
    /* Homing stays on the CGI regardless of transport: it is a one-shot
     * recalibration, not a gesture, and the sleep-then-reposition sequence
     * below has no latency budget worth optimising. */
    await runMotorCmd("d=r");
    if (Number.isFinite(x0) && Number.isFinite(y0)) {
      await sleep(800);
      await runMotorCmd("d=x&x=" + x0 + "&y=" + y0);
    }
  } else if (dir === "cc") {
    const cx = x_max / 2;
    const cy = y_max / 2;
    if (!motorWs.trySend({ cmd: "move", mode: "abs", x: cx, y: cy })) {
      runMotorCmd("d=x&x=" + cx + "&y=" + cy);
    }
  } else {
    const sign = motorDirSigns(dir);
    const x = sign.x * step;
    const y = sign.y * step;
    if (!motorWs.trySend({ cmd: "move", mode: "rel", x: x, y: y })) {
      runMotorCmd("d=g&x=" + x + "&y=" + y);
    }
  }
}

// Initialize motor controls when DOM is ready
document.addEventListener("DOMContentLoaded", async function () {
  const uiConfig = window.thinginoUIConfig || {};
  const hasMotors = uiConfig.device && uiConfig.device.motors === true;

  if (!hasMotors) {
    return;
  }
  await ensureMotorParams();

  const motorOverlay = $("#motor-overlay");
  if (motorOverlay) {
    motorOverlay.style.display = "";
  }

  /* Open the socket while the user is still looking at the page, so the first
   * button press finds it ready instead of paying for a token fetch plus a
   * handshake. Not awaited: a slow or absent listener must not delay binding
   * the controls, and every send site falls back on its own. */
  motorWs.connect();

  let timer;
  const stepMode = getPreviewControlMode() === "step";

  function bindStepControls() {
    $$(".jst a.s").forEach((el) => {
      el.onclick = (ev) => {
        if (ev.detail === 1) {
          timer = setTimeout(() => {
            moveMotor(ev.target.dataset.dir, 100);
          }, 200);
        }
      };
      el.ondblclick = (ev) => {
        if (ev.detail === 2) {
          clearTimeout(timer);
          moveMotor(ev.target.dataset.dir, 10);
        }
      };
    });
  }

  function bindContinuousControls() {
    let holdInterval = null;
    let wsHolding = false;
    const intervalMs = 90;

    /* Hold-to-move over the socket.
     *
     * One command down, one stop up - no repetition at all. The delta is the
     * full reported travel of the axis: motor_ctl_relative() clamps the
     * TARGET to the limit and recomputes the delta from there, so asking for
     * all of it means "go until the far end", and its 24-step edge deadband
     * turns a hold that is already at the limit into a no-op rather than an
     * oscillation. Nothing here needs a magic constant, and a camera that
     * reports no limit (x_max 0) is handled by falling back to nudges below.
     */
    const startWsHold = (dir) => {
      const sign = motorDirSigns(dir);
      const params = window.motorParams || {};
      const xTravel = motorWs.limits.x || Number(params.steps_pan) || 0;
      const yTravel = motorWs.limits.y || Number(params.steps_tilt) || 0;
      if ((sign.x && !xTravel) || (sign.y && !yTravel)) return false;

      if (
        !motorWs.trySend({
          cmd: "move",
          mode: "rel",
          x: sign.x * xTravel,
          y: sign.y * yTravel,
        })
      ) {
        return false;
      }
      wsHolding = true;
      return true;
    };

    /* The pre-WebSocket hold: re-issue a small nudge every 90ms and stop
     * issuing them on release. Left exactly as it was, deliberately. It does
     * not send an explicit stop, and does not need one - each nudge is
     * steps_pan/100 (40 steps, ~50ms of motion), so ceasing to send them IS
     * the stop, and a spurious stop would only add a hard halt the old
     * behaviour never had. */
    const stopCgiMove = () => {
      if (holdInterval) {
        clearInterval(holdInterval);
        holdInterval = null;
      }
    };

    const startCgiMove = (dir) => {
      stopCgiMove();
      moveMotor(dir, 100);
      holdInterval = setInterval(() => {
        moveMotor(dir, 100);
      }, intervalMs);
    };

    const startContinuousMove = (dir) => {
      if (!dir) return;
      stopContinuousMove();
      if (motorWs.isOpen() && startWsHold(dir)) return;
      startCgiMove(dir);
    };

    /* Release. Bound to pointerup AND pointercancel AND pointerleave AND
     * lostpointercapture: with a real move in flight, a release event that
     * never arrives leaves the camera panning to its limit, so every way a
     * press can end has to land here. Idempotent - a stop with nothing moving
     * is free. */
    function stopContinuousMove() {
      stopCgiMove();
      if (wsHolding) {
        wsHolding = false;
        if (!motorWs.trySend({ cmd: "stop" })) {
          /* Socket died mid-gesture. The motors are still moving toward the
           * limit, so this one has to go out over the CGI. */
          runMotorCmd("d=s");
        }
      }
    }

    $$(".jst a.s").forEach((el) => {
      const stopHandler = () => stopContinuousMove();
      el.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        if (el.setPointerCapture && ev.pointerId !== undefined) {
          el.setPointerCapture(ev.pointerId);
        }
        startContinuousMove(el.dataset.dir);
      });
      el.addEventListener("pointerup", stopHandler);
      el.addEventListener("pointerleave", stopHandler);
      el.addEventListener("pointercancel", stopHandler);
      el.addEventListener("lostpointercapture", stopHandler);
      el.addEventListener("contextmenu", (ev) => ev.preventDefault());
    });

    /* A tab that goes away mid-hold gets no pointer event at all. The daemon
     * would notice eventually (the connection goes stale after 60s and is
     * closed) but the camera would keep moving until then. */
    window.addEventListener("blur", stopContinuousMove);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopContinuousMove();
    });
  }

  if (stepMode) {
    bindStepControls();
  } else {
    bindContinuousControls();
  }

  $(".jst a.b").onclick = (ev) => {
    if (ev.detail === 1) {
      timer = setTimeout(() => {
        moveMotor("cc");
      }, 200);
    }
  };

  $(".jst a.b").ondblclick = (ev) => {
    clearTimeout(timer);
    moveMotor("homing");
  };

  /* Initial position. Over the socket this arrives unprompted as the "hello"
   * frame the daemon sends on connect, so only the CGI path has to ask. */
  if (!motorWs.enabledAtBuild()) {
    runMotorCmd("d=j");
  }
});
