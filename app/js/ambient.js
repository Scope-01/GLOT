/*
 * Glass Home - screensaver and evening dimming.
 *
 * Screensaver: after config.ambient.afterMs without a button press, the dock,
 * clock, weather, logo and photo credit fade out and only the
 * photos drift (html.ambient). The first button press only brings them back;
 * it is not passed on, so waking the screen never opens an app by accident.
 * Not while the + panel or a menu is open.
 *
 * Evening dimming: between config.night.from and config.night.to (TV clock)
 * a dark layer dims the photos (html.night); the dock and text stay bright.
 *
 * Preview and tests: ?idle=<ms> shortens the screensaver delay; ?night=1 or
 * ?night=0 forces dimming on or off.
 */
(function () {
  'use strict';
  var GH = window.GH || {};
  var cfg = GH.config || {};
  var Q = GH.query || {};
  var html = document.documentElement;
  var amb = cfg.ambient || {};
  var night = cfg.night || {};
  var idleMs = /^\d+$/.test(Q.idle || '') ? +Q.idle : (amb.afterMs || 3 * 60 * 1000);
  var timer = null;
  var swallowKey = null;
  var enteredAt = 0;
  var WAKE_GUARD_MS = 600;
  // Play/Pause, Play, Pause, Info, subtitles, yellow
  var CAPTION_KEYS = [10252, 415, 19, 457, 10221, 405];
  // The TV only sends these media keys to apps that ask for them.
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'Info', 'Caption', 'ColorF2Yellow'].forEach(function (k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* not on this remote */ }
      });
    }
  } catch (e) { /* preview */ }

  function isOpen(id) {
    var e = document.getElementById(id);
    return !!(e && e.classList.contains('open'));
  }

  function arm() {
    clearTimeout(timer);
    if (amb.enabled === false) return;
    timer = setTimeout(enter, idleMs);
  }

  function enter() {
    if (document.hidden) return;
    if (isOpen('panel') || isOpen('menu') || isOpen('allapps')) { arm(); return; }
    if (GH.hideLive) GH.hideLive();
    html.classList.add('ambient');
    enteredAt = Date.now();
    if (GH.VideoSaver) {
      // The TV must not be left on an HDMI input, or the video plays to black.
      var free = GH.platform && GH.platform.releaseInputPreview ? GH.platform.releaseInputPreview() : Promise.resolve();
      free.then(function () { if (html.classList.contains('ambient')) GH.VideoSaver.start(); });
    }
  }
  GH.enterAmbient = enter;   // Back on the home screen goes straight to the screensaver

  function wake() {
    html.classList.remove('ambient');
    if (GH.VideoSaver) GH.VideoSaver.stop();
    arm();
  }
  GH.wakeAmbient = wake;     // the remote's Home button while Glass Home is already open

  // Window capture runs before the home screen's own (document) key handler.
  window.addEventListener('keydown', function (e) {
    if (html.classList.contains('ambient')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      // The press that opened it may still be held and repeating.
      if (e.repeat || Date.now() - enteredAt < WAKE_GUARD_MS) return;
      // Play/Pause, Info, subtitles or yellow: show the caption again.
      if (CAPTION_KEYS.indexOf(e.keyCode) >= 0) {
        if (GH.VideoSaver && GH.VideoSaver.isRunning()) { GH.VideoSaver.showCaption(); return; }
      }
      // Left and Right change the scene; every other button comes back to Home.
      if (e.keyCode === 37 || e.keyCode === 39) {
        if (GH.VideoSaver && GH.VideoSaver.isRunning()) GH.VideoSaver.step(e.keyCode === 37 ? -1 : 1);
        else if (GH.nextPhoto) GH.nextPhoto();
        return;
      }
      swallowKey = e.keyCode;
      wake();
      return;
    }
    arm();
  }, true);
  window.addEventListener('keyup', function (e) {
    if (swallowKey !== null && e.keyCode === swallowKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      swallowKey = null;
    }
  }, true);

  // Settings from the phone website. afterMs 0: only Back opens the screensaver.
  GH.setAmbient = function (o) {
    amb.enabled = o.afterMs > 0;
    amb.afterMs = o.afterMs;
    if (!/^\d+$/.test(Q.idle || '') && o.afterMs > 0) idleMs = o.afterMs;
    if (!html.classList.contains('ambient')) { clearTimeout(timer); arm(); }
    night.enabled = o.nightEnabled;
    night.from = o.nightFrom;
    night.to = o.nightTo;
    night.followSun = o.followSun !== false;
    night.latitude = o.latitude;
    night.longitude = o.longitude;
    nightCheck();
  };

  // ---------- following the sun ----------
  // Sunrise and sunset (minutes after local midnight) for the weather place,
  // worked out on the TV (NOAA's approximation, good to a few minutes).
  function sunTimes(date, lat, lon) {
    var rad = Math.PI / 180;
    var day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
    var g = 2 * Math.PI / 365 * (day - 1);
    var eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
    if (cosH > 1) return { always: 'night' };
    if (cosH < -1) return { always: 'day' };
    var ha = Math.acos(cosH) / rad;
    var offset = -date.getTimezoneOffset();
    function local(utcMin) { return ((utcMin + offset) % 1440 + 1440) % 1440; }
    return { rise: local(720 - 4 * (lon + ha) - eqt), set: local(720 - 4 * (lon - ha) - eqt) };
  }
  GH.sunTimes = sunTimes;   // for tests

  function between(m, from, to) { return from > to ? (m >= from || m < to) : (m >= from && m < to); }

  // ---------- evening dimming ----------
  function minutes(hhmm) {
    var p = String(hhmm || '').split(':');
    return (+p[0] || 0) * 60 + (+p[1] || 0);
  }
  // With a weather place and "Follow the sun" on, Home dims from sunset to
  // sunrise and wears its lighter daytime glass while the sun is well up.
  // Without a place, the From/Until times are used and Home stays dark.
  function nightCheck() {
    var now = new Date();
    var m = now.getHours() * 60 + now.getMinutes();
    var sun = null;
    if (night.followSun !== false && typeof night.latitude === 'number' && typeof night.longitude === 'number') {
      sun = sunTimes(now, night.latitude, night.longitude);
    }
    var on;
    if (Q.night === '1') on = true;
    else if (Q.night === '0' || night.enabled === false) on = false;
    else if (sun && sun.always) on = sun.always === 'night';
    else if (sun) on = between(m, sun.set, sun.rise);
    else on = between(m, minutes(night.from || '20:00'), minutes(night.to || '06:00'));
    html.classList.toggle('night', on);
    var day = false;
    if (Q.daylight === '1') day = true;
    else if (Q.daylight !== '0' && sun) day = sun.always ? sun.always === 'day' : between(m, sun.rise + 30, sun.set - 30);
    html.classList.toggle('daylight', day);
  }

  // ---------- OLED care: Home's text and widgets drift a few pixels ----------
  // A slow walk round a small square, one step every few minutes, so nothing
  // sits on exactly the same pixels all day. Too small to notice.
  var SHIFT_STEPS = [[0, 0], [3, 2], [6, 0], [3, -3], [0, -5], [-3, -3], [-6, 0], [-3, 3], [0, 5], [3, 3]];
  var SHIFT_EVERY_MS = 4 * 60000;
  var shiftIdx = 0;
  var shiftTimer = null;
  function shiftStep() {
    shiftIdx = (shiftIdx + 1) % SHIFT_STEPS.length;
    html.style.setProperty('--shift-x', SHIFT_STEPS[shiftIdx][0] + 'px');
    html.style.setProperty('--shift-y', SHIFT_STEPS[shiftIdx][1] + 'px');
  }
  GH.setPixelShift = function (on) {
    clearInterval(shiftTimer);
    shiftTimer = null;
    html.classList.toggle('pixel-shift', !!on);
    if (on) shiftTimer = setInterval(shiftStep, Q.shiftMs ? +Q.shiftMs : SHIFT_EVERY_MS);
  };
  GH.setPixelShift(true);

  var nightTimer = null;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(timer);
      clearInterval(nightTimer);
      if (GH.VideoSaver) GH.VideoSaver.stop();   // free the decoder for the next app
      return;
    }
    nightCheck();
    clearInterval(nightTimer);
    nightTimer = setInterval(nightCheck, 60000);
    wake();
  });

  nightCheck();
  nightTimer = setInterval(nightCheck, 60000);
  arm();
}());
