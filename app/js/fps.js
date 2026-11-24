/*
 * GLOT - FPS meter for development.
 *
 * A small panel in the top-left corner: frames per second over the last
 * second, the slowest frame, how many frames were dropped, and a strip of the
 * last ~3 seconds (one bar per frame: green on time, amber one frame late, red
 * two or more). It redraws twice a second on its own layer, so it costs
 * almost nothing itself.
 *
 * On from the phone website (Settings > Advanced > FPS meter), from the hidden
 * menu (Up x3), or with ?fps=1. GH.Fps.stats() gives the numbers to tools.
 */
(function () {
  'use strict';
  var GH = window.GH;
  var FRAME = 1000 / 60;
  var HISTORY = 180;               // frames kept for the strip (~3 s)
  var el = null;
  var text = null;
  var canvas = null;
  var ctx = null;
  var on = false;
  var raf = 0;
  var last = 0;
  var times = [];                  // frame intervals, newest last
  var drawTimer = null;
  var session = { frames: 0, dropped: 0, worst: 0, since: 0 };

  function build() {
    el = document.createElement('div');
    el.id = 'fps-meter';
    text = document.createElement('div');
    text.className = 'fps-text';
    canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 34;
    ctx = canvas.getContext('2d');
    el.appendChild(text);
    el.appendChild(canvas);
    document.body.appendChild(el);
  }

  function tick(now) {
    if (!on) return;
    if (last) {
      var dt = now - last;
      times.push(dt);
      if (times.length > HISTORY) times.shift();
      session.frames += 1;
      var missed = Math.max(0, Math.round(dt / FRAME) - 1);
      session.dropped += missed;
      if (dt > session.worst) session.worst = dt;
    }
    last = now;
    raf = requestAnimationFrame(tick);
  }

  function recent(ms) {
    var sum = 0;
    var n = 0;
    var worst = 0;
    var dropped = 0;
    for (var i = times.length - 1; i >= 0 && sum < ms; i--) {
      sum += times[i];
      n += 1;
      if (times[i] > worst) worst = times[i];
      dropped += Math.max(0, Math.round(times[i] / FRAME) - 1);
    }
    return { fps: sum ? Math.round(n * 1000 / sum) : 0, worst: worst, dropped: dropped };
  }

  function draw() {
    var r = recent(1000);
    el.className = r.fps >= 57 ? 'good' : r.fps >= 45 ? 'ok' : 'bad';
    text.textContent = r.fps + ' fps   worst ' + Math.round(r.worst) + ' ms   dropped ' + r.dropped +
      '   (session ' + session.dropped + ')';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var w = canvas.width / HISTORY;
    var start = HISTORY - times.length;
    for (var i = 0; i < times.length; i++) {
      var late = Math.round(times[i] / FRAME) - 1;
      var h = Math.min(canvas.height, Math.max(3, times[i] / 50 * canvas.height));
      ctx.fillStyle = late <= 0 ? '#34c759' : late === 1 ? '#ffcc00' : '#ff453a';
      ctx.fillRect((start + i) * w, canvas.height - h, Math.max(1, w - 0.3), h);
    }
    // the 60 fps line
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, canvas.height - FRAME / 50 * canvas.height, canvas.width, 1);
  }

  function set(want) {
    want = !!want;
    if (want === on) return;
    on = want;
    if (on) {
      if (!el) build();
      el.hidden = false;
      times = [];
      last = 0;
      session = { frames: 0, dropped: 0, worst: 0, since: Date.now() };
      raf = requestAnimationFrame(tick);
      drawTimer = setInterval(draw, 500);
    } else {
      cancelAnimationFrame(raf);
      clearInterval(drawTimer);
      if (el) el.hidden = true;
    }
  }

  GH.Fps = {
    set: set,
    isOn: function () { return on; },
    stats: function () {
      var r = recent(1000);
      return { on: on, fps: r.fps, worstMs: Math.round(r.worst), dropped: r.dropped,
        session: { frames: session.frames, dropped: session.dropped, worstMs: Math.round(session.worst), seconds: Math.round((Date.now() - session.since) / 1000) } };
    }
  };
  if (GH.query && GH.query.fps === '1') set(true);
}());
