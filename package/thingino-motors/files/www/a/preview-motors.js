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
  let frameListener = null;
  let pushIntervalMs = 0;
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
    }
    /* Hand every frame on, errors included. The joystick needs the errors as
     * much as the status: an "unknown_cmd" is how a page talking to a daemon
     * older than the vector command finds out, and this fleet updates the
     * WebUI and the daemon in the same image but not necessarily on the same
     * day. */
    if (frameListener) frameListener(frame);
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
        /* Position pushes are subscribed to only when something on the page
         * is going to draw them - see subscribe() below. This used to be
         * unconditional, which meant the daemon polled MOTOR_GET_STATUS
         * several times a second for the whole life of every preview page so
         * that onMessage() could console.log the result. The travel limits
         * that step and continuous mode need do NOT depend on it: the daemon
         * sends them unprompted in the "hello" frame. */
        if (pushIntervalMs) {
          try {
            ws.send(
              JSON.stringify({
                cmd: "subscribe",
                interval_ms: pushIntervalMs,
              }),
            );
          } catch (err) {
            /* the send below will report it */
          }
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
   * has a CGI fallback ready. Returns 0 rather than queueing, so a half-open
   * socket can never swallow a stop.
   *
   * On success it returns the id it stamped on the message, which every
   * existing caller may keep treating as a plain boolean - seq starts at 1
   * and only grows, so a sent message never reports a falsy id. The joystick
   * needs the actual number, to match an error frame back to the command
   * that caused it. */
  function trySend(obj) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return 0;
    try {
      obj.id = seq++;
      socket.send(JSON.stringify(obj));
      return obj.id;
    } catch (err) {
      console.warn("motors: WebSocket send failed", err);
      return 0;
    }
  }

  return {
    connect,
    trySend,
    isOpen: () => !!socket && socket.readyState === WebSocket.OPEN,
    limits,
    enabledAtBuild: buildFlagSet,
    setFrameListener: (fn) => {
      frameListener = fn;
    },
    /* Turn position pushes on, once there is something to draw them with.
     * Safe to call before or after the socket opens: whichever happens
     * second sends the subscribe. */
    subscribe: (intervalMs) => {
      pushIntervalMs = intervalMs;
      trySend({ cmd: "subscribe", interval_ms: intervalMs });
    },
  };
})();

function normalizePreviewControlMode(value) {
  return value === "continuous" || value === "joystick" ? value : "step";
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
  const controlMode = getPreviewControlMode();

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

  /* Live pan/tilt readout, fed by the status pushes the socket already
   * subscribes to.
   *
   * Those pushes predate this change and drove nothing but a console.log.
   * The joystick is what finally justifies them: with the arrows the video IS
   * the feedback, because the control sits where you are already looking and
   * every press is a bounded nudge. A stick is held off to one side and runs
   * the camera toward a limit the picture gives no warning of - "how much
   * travel is left" is the one thing the video cannot show. So it is wired up
   * here, and shown in joystick mode only; step and continuous mode render
   * and behave exactly as before.
   *
   * Cadence stays at the 200ms the socket already asks for. Faster would buy
   * a smoother bar at the cost of one more MOTOR_GET_STATUS ioctl per frame
   * on a 64MB MIPS camera, to redraw a number a human reads maybe twice per
   * gesture; the CSS transition on the bars does that job for free, and the
   * daemon still sends nothing at all while the camera is parked. */
  function bindPositionReadout() {
    const wrap = $("#motor-pos");
    const barX = $("#motor-pos-x");
    const barY = $("#motor-pos-y");
    const text = $("#motor-pos-text");
    if (!wrap) return null;

    motorWs.subscribe(200);

    return function render(frame) {
      if (typeof frame.x !== "number" || typeof frame.y !== "number") return;
      const xMax = frame.x_max || motorWs.limits.x;
      const yMax = frame.y_max || motorWs.limits.y;
      if (barX) barX.style.width = xMax ? (frame.x / xMax) * 100 + "%" : "0";
      // Tilt's bar is vertical (see preview-motors.css), filled via height
      // rather than width - the only difference from the pan bar's fill.
      if (barY) barY.style.height = yMax ? (frame.y / yMax) * 100 + "%" : "0";
      if (text) text.textContent = frame.x + " / " + frame.y;
    };
  }

  /* Virtual analog stick.
   *
   * The gesture is a drag, not a press: the handle's displacement from the
   * centre of the ring is the whole command, direction and magnitude at once.
   * What goes on the wire is that displacement as a per-mille deflection -
   * neither a distance nor a speed - because the daemon is the only side that
   * knows the travel limits, the configured speed cap, and (see
   * motor_ctl_vector) whether this kernel can drive the two axes at different
   * speeds at all. Sending a raw speed from here would mean guessing all
   * three.
   */
  function bindJoystickControls() {
    const stick = $("#motor-stick");
    const handle = $("#motor-stick-handle");
    if (!stick || !handle) {
      /* The overlay markup comes from this plugin's own manifest, so this
       * should not happen - but falling back beats leaving a camera with no
       * PTZ control at all because one asset was stale. */
      bindContinuousControls();
      return;
    }

    $("#motor").classList.add("stick-mode");

    /* The CSS gives the ring an up-to-450px size, but the actual preview box
     * can be far shorter than it is wide, especially on a phone in portrait
     * - a ring sized only from viewport width would still poke out above and
     * below the video. Measure the real preview box instead of guessing from
     * vw/vh media queries, which cannot know the stream's aspect ratio, and
     * drive the ring through a CSS variable so all the sizing logic lives
     * here rather than being split between JS and a breakpoint.
     *
     * Two different markups to support: timps ships its own preview.html
     * (native MSE/fMP4 player) with a fixed-aspect-ratio ".ms-video-wrap";
     * prudynt/raptor use thingino-webui's stock preview.html, an "#frame"
     * div sized by an img-fluid <img>'s intrinsic aspect ratio. Both are the
     * positioned ancestor #motor-overlay actually centres against. */
    // Pan's bar plus the combined "x / y" text sit below the ring, both
    // outside the circle - not covered by shrinking the ring itself. This is
    // the vertical space they need below centre; sizeStick() below reserves
    // it on both sides of centre (simpler than tracking that it is really
    // only needed on one side) so the pan bar can never end up clipped by
    // the frame's own overflow:hidden the way a fixed-pixel offset was.
    const POS_READOUT_RESERVE = 40;
    function sizeStick() {
      const frame = $(".ms-video-wrap") || $("#frame");
      if (!frame) return;
      const box = frame.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const availHeight = box.height - 2 * POS_READOUT_RESERVE;
      // Headroom so the ring sits inside the video, not flush with its
      // edges, at roughly 85% of whichever side is shorter.
      const fit = Math.min(box.width, availHeight) * 0.85;
      const size = Math.max(132, Math.min(450, fit));
      stick.style.setProperty("--motor-stick-size", size.toFixed(0) + "px");
    }
    sizeStick();
    window.addEventListener("resize", sizeStick);
    // On the img-fluid markup the box only reaches its real aspect ratio
    // once the first frame has actually loaded - before that #frame can
    // still be showing the placeholder's own (different) proportions. The
    // timps markup has no such element; querying a nonexistent #preview is
    // a harmless no-op, since .ms-video-wrap's aspect-ratio is fixed by CSS
    // and already correct from sizeStick()'s first call above.
    const previewImg = $("#preview");
    if (previewImg) previewImg.addEventListener("load", sizeStick);

    /* Matches the CGI hold loop's 90ms, which is this codebase's existing
     * answer to "how often may a held PTZ gesture talk to the camera": ~11
     * messages/s, the exact figure motor-ws.c's rate limiter (25/s) is
     * documented against. No reason to invent a second number - and over the
     * socket a message that does not change direction costs the daemon one
     * ioctl, not a move. */
    const SEND_INTERVAL_MS = 90;
    /* Dead zone as a fraction of the ring radius. The daemon enforces a
     * smaller one of its own as a backstop; this is the one that is actually
     * felt, and it has to be wide enough that resting a fingertip on the
     * handle does not creep the camera. */
    const DEAD_ZONE = 0.12;

    let dragging = false;
    let radius = 1;
    let centre = { x: 0, y: 0 };
    let vector = { x: 0, y: 0 };
    let overSocket = false;
    let vectorRejected = false;
    let lastVectorId = 0;
    let lastSentAt = 0;
    let flushTimer = null;
    let cgiInterval = null;

    motorWs.setFrameListener((frame) => {
      if (renderPosition && (frame.type === "status" || frame.type === "hello"))
        renderPosition(frame);
      /* A daemon that predates the vector command answers unknown_cmd. Give
       * up on the socket for this control - permanently, not per press, so a
       * user dragging for ten seconds does not send a hundred rejects - and
       * finish the gesture on the CGI. */
      if (
        frame.type === "error" &&
        frame.id === lastVectorId &&
        (frame.code === "unknown_cmd" || frame.code === "no_limits")
      ) {
        console.warn("motors: daemon rejected the vector command", frame.code);
        vectorRejected = true;
        if (dragging && overSocket) {
          motorWs.trySend({ cmd: "stop" });
          overSocket = false;
          startCgiNudges();
        }
      }
    });

    /* CGI fallback. That path has no speed field at all, so proportionality
     * has to come out of the size of each nudge instead: the same 90ms tick
     * as the classic hold, with the step scaled by how far the stick is
     * pushed. Visibly stepped near the centre, where the nudges get small -
     * but a coarse joystick beats a mode that silently does nothing on a
     * camera whose listener is off. */
    function startCgiNudges() {
      stopCgiNudges();
      const params = window.motorParams || {};
      const stepX = Number(params.steps_pan) / 100 || 0;
      const stepY = Number(params.steps_tilt) / 100 || 0;
      cgiInterval = setInterval(() => {
        const x = Math.round((stepX * vector.x) / 1000);
        const y = Math.round((stepY * vector.y) / 1000);
        if (x || y) runMotorCmd("d=g&x=" + x + "&y=" + y);
      }, SEND_INTERVAL_MS);
    }

    function stopCgiNudges() {
      if (cgiInterval) {
        clearInterval(cgiInterval);
        cgiInterval = null;
      }
    }

    function sendVector() {
      lastSentAt = performance.now();
      lastVectorId = motorWs.trySend({
        cmd: "vector",
        x: vector.x,
        y: vector.y,
      });
      if (!lastVectorId) {
        /* Socket died mid-drag with the camera still running toward a limit.
         * Switch transports rather than abandon the gesture. */
        overSocket = false;
        runMotorCmd("d=s");
        startCgiNudges();
      }
    }

    /* Throttle with a trailing edge. A leading-only throttle drops the last
     * sample of every gesture that ends between two windows - and the last
     * sample of a joystick drag is the one that says how fast to keep going,
     * so the camera would hold whatever speed it had 90ms before the user
     * stopped moving. */
    function queueVector() {
      const wait = SEND_INTERVAL_MS - (performance.now() - lastSentAt);
      if (wait <= 0) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        sendVector();
        return;
      }
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          /* overSocket as well as dragging: the transport can have switched
           * to the CGI since this was queued, and sending then would trip
           * sendVector()'s own failure path a second time. */
          if (dragging && overSocket) sendVector();
        }, wait);
      }
    }

    function updateFromPointer(ev) {
      let dx = ev.clientX - centre.x;
      let dy = ev.clientY - centre.y;
      const dist = Math.hypot(dx, dy);

      /* Clamp to the ring. Without it the handle follows the pointer off the
       * overlay and the deflection has no upper bound to be a fraction of. */
      if (dist > radius) {
        dx = (dx / dist) * radius;
        dy = (dy / dist) * radius;
      }

      handle.style.transform = "translate(" + dx + "px," + dy + "px)";

      const norm = Math.min(dist, radius) / radius;
      if (norm < DEAD_ZONE) {
        vector = { x: 0, y: 0 };
        return;
      }
      /* Rescale so the useful throw starts at the dead-zone edge rather than
       * jumping straight to 12% deflection the moment it is crossed. */
      const scale = ((norm - DEAD_ZONE) / (1 - DEAD_ZONE)) * 1000;
      vector = {
        x: Math.round((dx / (dist || 1)) * scale),
        /* Screen y grows downward, the motors' logical y grows upward - the
         * same convention motorDirSigns() encodes for the arrows. */
        y: Math.round((-dy / (dist || 1)) * scale),
      };
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      stick.classList.remove("dragging");
      handle.style.transform = "";
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      vector = { x: 0, y: 0 };
      stopCgiNudges();
      if (overSocket) {
        overSocket = false;
        if (!motorWs.trySend({ cmd: "stop" })) runMotorCmd("d=s");
      }
    }

    stick.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      const box = stick.getBoundingClientRect();
      /* Geometry read from the element, so the ring's size stays a CSS
       * decision and a responsive layout cannot desynchronise the two. */
      radius = box.width / 2;
      centre = { x: box.left + radius, y: box.top + box.height / 2 };
      dragging = true;
      stick.classList.add("dragging");
      /* Capture keeps the pointermove/pointerup stream on this element once
       * the drag leaves the ring - without it a fast flick ends on the video
       * underneath and the release never arrives, which with a real move in
       * flight means the camera pans to its limit.
       *
       * Guarded because setPointerCapture throws NotFoundError for a pointer
       * id the browser does not consider active, and an exception here would
       * skip everything below it: the gesture would then track the handle
       * across the screen while never sending a single command. Found exactly
       * that way, driving this control from a script. Capture is a safety
       * net, not a precondition - losing it is worth a degraded drag, not a
       * dead one. */
      try {
        if (stick.setPointerCapture && ev.pointerId !== undefined) {
          stick.setPointerCapture(ev.pointerId);
        }
      } catch (err) {
        /* no capture; the window blur/visibilitychange handlers below still
         * catch the runaway case */
      }
      overSocket = motorWs.isOpen() && !vectorRejected;
      updateFromPointer(ev);
      if (overSocket) sendVector();
      else startCgiNudges();
    });

    stick.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      ev.preventDefault();
      updateFromPointer(ev);
      if (overSocket) queueVector();
    });

    /* Same net as the arrows: with a real move in flight, a release event
     * that never arrives leaves the camera panning to its limit, so every way
     * a drag can end has to land here. */
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) =>
      stick.addEventListener(name, endDrag),
    );
    stick.addEventListener("contextmenu", (ev) => ev.preventDefault());

    window.addEventListener("blur", endDrag);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) endDrag();
    });
  }

  const renderPosition =
    controlMode === "joystick" ? bindPositionReadout() : null;

  if (controlMode === "joystick") {
    bindJoystickControls();
  } else if (controlMode === "continuous") {
    bindContinuousControls();
  } else {
    bindStepControls();
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
