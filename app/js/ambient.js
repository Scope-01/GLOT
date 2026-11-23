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
    if (GH.VideoSaver) GH.VideoSaver.start();
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
    nightCheck();
  };

  // ---------- evening dimming ----------
  function minutes(hhmm) {
    var p = String(hhmm || '').split(':');
    return (+p[0] || 0) * 60 + (+p[1] || 0);
  }
  function nightCheck() {
    var on;
    if (Q.night === '1') on = true;
    else if (Q.night === '0' || night.enabled === false) on = false;
    else {
      var now = new Date();
      var m = now.getHours() * 60 + now.getMinutes();
      var from = minutes(night.from || '20:00');
      var to = minutes(night.to || '06:00');
      on = from > to ? (m >= from || m < to) : (m >= from && m < to);
    }
    html.classList.toggle('night', on);
  }

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
