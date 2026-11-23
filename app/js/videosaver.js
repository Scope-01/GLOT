/*
 * Glass Home - streaming video for the screensaver.
 *
 * While the screensaver is on, muted clips stream over the photos, one after
 * another. Clips come from the phone website if any were added there, otherwise
 * from config.video.clips. Anything that fails is skipped; if nothing plays the
 * photos simply carry on underneath.
 *
 * Changing scene (Left/Right, or a clip ending) never shows the photos: the
 * next clip loads out of sight behind the one playing and fades in once it is
 * really playing. A TV that can't decode two videos at once is detected and
 * remembered; there the old clip fades to black, then the new one fades in.
 * Every video element is removed on wake, so an app opened next can have the
 * TV's video decoder.
 *
 * Once GLOT has shown an HDMI input in a window (the live card), the TV keeps
 * its video layer tied to that window and every <video> in the page plays to
 * black until the app restarts. The TV's own player (AVPlay) still works, so
 * from then on the screensaver uses it instead: one clip at a time, fading
 * through black, with the page made see-through over it.
 *
 * Preview and tests: ?video=0 turns it off; ?decoders=1 acts as a TV with one
 * video decoder.
 */
(function () {
  'use strict';
  var GH = window.GH;
  var cfg = GH.config.video || {};
  var Q = GH.query || {};
  var host = document.getElementById('bg');
  var creditEl = document.getElementById('video-credit');
  var START_TIMEOUT_MS = 20000;   // a clip that has not started by now is skipped
  var CREDIT_MS = 8000;           // credit is brief: a parked caption can mark an OLED
  var FADE_MS = 1600;             // matches .bg-video's transition
  var QUICK_FADE_MS = 500;        // fading out to black between clips
  var PRELOAD_S = 12;             // start loading the next clip this long before the end
  var ONE_DECODER_KEY = 'gh.video.oneDecoder';

  var running = false;
  var order = [];
  var target = 0;                 // index in order of the clip most recently asked for
  var current = null;             // { v, idx, prepared }
  var pending = null;             // { v, idx, clip, list, i, cross, probe, timer }
  var failures = 0;
  var creditTimer = null;
  var stopTimer = null;
  var dropped = {};
  var levelFails = {};
  var oneDecoder = Q.decoders === '1' || !!(GH.ls && GH.ls.get(ONE_DECODER_KEY));
  var html = document.documentElement;
  var avMode = false;             // this run uses the TV's own player
  var avCur = null;               // { idx, clip, cap }
  var avToken = 0;
  var avPoll = null;

  // Apple's captions: [seconds, English, Arabic]. Each new place shows for a
  // while, then fades, so nothing sits still on an OLED.
  function captionAt(clip, seconds) {
    var caps = clip && clip.caps;
    if (!caps || !caps.length) return null;
    var found = null;
    for (var i = 0; i < caps.length; i++) if (caps[i][0] <= seconds) found = caps[i];
    return found;
  }
  function captionText(cap) {
    if (!cap || cfg.captions === 'off') return '';
    return cfg.captions === 'ar' ? cap[2] : cap[1];
  }

  // Black under the videos and over the photos, once a clip has played.
  var black = document.createElement('div');
  black.className = 'video-black';
  host.appendChild(black);

  function list() {
    var st = GH.data && GH.data.cached ? GH.data.cached() : null;
    if (st && st.videoSaver === false) return [];
    var mine = st && st.videos ? st.videos : [];
    if (mine.length) return mine.map(function (v) { return { url: v.url, credit: v.name || '' }; });
    return cfg.clips || [];
  }

  // Best first for the chosen quality. A level that fails twice in a row is
  // dropped until the next screensaver, so a TV that can't play it stops waiting.
  function sources(clip) {
    var wanted = cfg.quality === '4k' ? ['k4', 'url'] : ['url'];
    var out = [];
    wanted.forEach(function (level) {
      if (clip[level] && (!dropped[level] || level === 'url')) out.push({ level: level, src: clip[level] });
    });
    return out;
  }

  function shuffled(items) {
    var a = items.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function wrap(idx) { return ((idx % order.length) + order.length) % order.length; }

  function showCredit(text) {
    clearTimeout(creditTimer);
    creditEl.textContent = text || '';
    creditEl.classList.toggle('on', !!text);
    if (text) creditTimer = setTimeout(function () { creditEl.classList.remove('on'); }, CREDIT_MS);
  }

  function destroy(v) {
    if (!v) return;
    v.onplaying = v.onended = v.onerror = v.ontimeupdate = null;
    try { v.pause(); } catch (e) { /* already gone */ }
    v.removeAttribute('src');
    try { v.load(); } catch (e) { /* frees the decoder where supported */ }
    if (v.parentNode) v.parentNode.removeChild(v);
  }

  function dropPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    destroy(pending.v);
    pending = null;
  }

  // Fades the playing clip out to black, removes it, then calls done.
  function fadeOutCurrent(done) {
    var c = current;
    current = null;
    if (!c) { done(); return; }
    c.v.onended = c.v.onerror = c.v.ontimeupdate = null;
    c.v.classList.add('quick');
    c.v.classList.remove('show');
    setTimeout(function () { destroy(c.v); if (running) done(); }, QUICK_FADE_MS);
  }

  // Asks for the clip at idx. With cross true the playing clip keeps going
  // until the new one is ready.
  function request(idx, fromKey) {
    if (!running || !order.length) return;
    idx = wrap(idx);
    target = idx;
    var clip = order[idx];
    if (fromKey) showCredit(cfg.captions === 'off' ? '' : (captionText(captionAt(clip, 0)) || clip.credit));
    dropPending();
    if (current && !oneDecoder) { load(clip, idx, sources(clip), 0, true, false); return; }
    fadeOutCurrent(function () { if (target === idx) load(clip, idx, sources(clip), 0, false, false); });
  }

  function load(clip, idx, srcs, i, cross, probe) {
    if (!srcs[i]) { clipFailed(); return; }
    var v = document.createElement('video');
    v.className = 'bg-video';
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.autoplay = true;
    v.preload = 'auto';
    var p = { v: v, idx: idx, clip: clip, list: srcs, i: i, cross: cross, probe: probe, timer: null };
    pending = p;
    v.onplaying = function () { if (pending === p) promote(p); };
    v.onerror = function () { if (pending === p) pendingFailed(p); };
    host.appendChild(v);                  // later in the DOM, so it fades in on top
    v.src = srcs[i].src;
    var played = v.play();
    if (played && played.catch) played.catch(function () { /* onerror or the timeout handles it */ });
    p.timer = setTimeout(function () { if (pending === p) pendingFailed(p); }, START_TIMEOUT_MS);
  }

  function promote(p) {
    clearTimeout(p.timer);
    pending = null;
    if (p.probe && !oneDecoder) {
      // It failed next to another video but plays alone: one decoder.
      oneDecoder = true;
      if (GH.ls) GH.ls.set(ONE_DECODER_KEY, true);
    }
    var old = current;
    current = { v: p.v, idx: p.idx, prepared: false, clip: p.clip, cap: null };
    failures = 0;
    levelFails[p.list[p.i].level] = 0;
    p.v.onended = onEnded;
    p.v.onerror = function () { if (current && current.v === p.v) currentFailed(); };
    p.v.ontimeupdate = maybePrepare;
    black.classList.add('on');
    p.v.classList.add('show');
    var first = captionAt(p.clip, 0);
    current.cap = first;
    showCredit(first ? captionText(first) : (cfg.captions === 'off' ? '' : p.clip.credit));
    if (old) {
      old.v.onended = old.v.onerror = old.v.ontimeupdate = null;
      setTimeout(function () { destroy(old.v); }, FADE_MS + 100);
    }
  }

  function pendingFailed(p) {
    clearTimeout(p.timer);
    destroy(p.v);
    pending = null;
    var level = p.list[p.i].level;
    // Failing beside a playing clip may only mean the TV has one decoder:
    // try the same source again on its own before blaming the clip.
    if (p.cross && current) {
      fadeOutCurrent(function () { if (target === p.idx) load(p.clip, p.idx, p.list, p.i, false, true); });
      return;
    }
    levelFails[level] = (levelFails[level] || 0) + 1;
    if (levelFails[level] >= 2) dropped[level] = true;
    if (p.i + 1 < p.list.length) load(p.clip, p.idx, p.list, p.i + 1, false, false);
    else clipFailed();
  }

  function clipFailed() {
    failures += 1;
    if (failures >= order.length) { stop(); return; }   // nothing playable: photos stay
    request(target + 1, false);
  }

  // The playing clip broke. If another is loading, it takes over from black.
  function currentFailed() {
    var c = current;
    current = null;
    if (c) destroy(c.v);
    if (pending && pending.cross) {
      if (!oneDecoder) { oneDecoder = true; if (GH.ls) GH.ls.set(ONE_DECODER_KEY, true); }
      return;
    }
    if (!pending) request(target + 1, false);
  }

  // Shortly before the end, the next clip starts loading behind this one.
  function maybePrepare() {
    var c = current;
    if (c && c.v === this) {
      var cap = captionAt(c.clip, this.currentTime);
      if (cap && cap !== c.cap) { c.cap = cap; showCredit(captionText(cap)); }
    }
    if (!c || c.prepared || pending || oneDecoder || !isFinite(this.duration)) return;
    if (this.duration - this.currentTime > PRELOAD_S) return;
    c.prepared = true;
    request(c.idx + 1, false);
  }

  function onEnded() {
    if (!running) return;
    if (pending) return;                 // the next clip is loading; this last frame holds
    request(target + 1, false);
  }

  // ---------- the TV's own player (after the live card has been used) ----------
  function avUsable() {
    return !!(window.webapis && webapis.avplay && GH.platform && GH.platform.tvWindowUsed);
  }
  function avClose() {
    try { webapis.avplay.stop(); } catch (e) { /* not playing */ }
    try { webapis.avplay.close(); } catch (e) { /* not open */ }
  }
  function avTime() {
    try { return webapis.avplay.getCurrentTime() / 1000; } catch (e) { return 0; }
  }

  // Fades to black over whatever plays, then loads the clip at idx.
  function avRequest(idx, fromKey) {
    if (!running || !order.length) return;
    idx = wrap(idx);
    target = idx;
    var clip = order[idx];
    if (fromKey) showCredit(cfg.captions === 'off' ? '' : (captionText(captionAt(clip, 0)) || clip.credit));
    var token = ++avToken;
    clearInterval(avPoll);
    var wasPlaying = !!avCur;
    avCur = null;
    black.classList.add('on');
    setTimeout(function () {
      if (token === avToken && running) avLoad(clip, idx, sources(clip), 0, token);
    }, wasPlaying ? 850 : 0);
  }

  function avLoad(clip, idx, srcs, i, token) {
    if (!srcs[i]) { avFailed(token); return; }
    avClose();
    var A = webapis.avplay;
    var started = false;
    var settled = false;
    function next() {
      if (settled || token !== avToken || !running) return;
      settled = true;
      clearTimeout(timer);
      avClose();
      avLoad(clip, idx, srcs, i + 1, token);
    }
    var timer = setTimeout(next, START_TIMEOUT_MS);
    try {
      A.open(srcs[i].src);
      A.setDisplayRect(0, 0, 1920, 1080);
      A.setListener({
        onstreamcompleted: function () { if (token === avToken && running) avRequest(target + 1, false); },
        onerror: function () {
          if (token !== avToken || !running) return;
          if (started) avRequest(target + 1, false); else next();
        }
      });
      A.prepareAsync(function () {
        if (token !== avToken || !running || settled) return;
        settled = true;
        clearTimeout(timer);
        try { A.play(); } catch (e) { settled = false; next(); return; }
        started = true;
        failures = 0;
        avCur = { idx: idx, clip: clip, cap: captionAt(clip, 0) };
        html.classList.add('av-live');
        black.classList.remove('on');           // the page opens up over the clip
        showCredit(avCur.cap ? captionText(avCur.cap) : (cfg.captions === 'off' ? '' : clip.credit));
        avPoll = setInterval(function () {
          if (!avCur || token !== avToken) return;
          var cap = captionAt(avCur.clip, avTime());
          if (cap && cap !== avCur.cap) { avCur.cap = cap; showCredit(captionText(cap)); }
        }, 1000);
      }, next);
    } catch (e) { next(); }
  }

  function avFailed(token) {
    if (token !== avToken) return;
    failures += 1;
    if (failures >= order.length) { stop(); return; }
    avRequest(target + 1, false);
  }

  function stop() {
    if (avMode) {
      avToken += 1;
      clearInterval(avPoll);
      avClose();
      avCur = null;
      html.classList.remove('av-live');
      avMode = false;
    }
    running = false;
    clearTimeout(stopTimer);
    dropPending();
    if (current) { destroy(current.v); current = null; }
    black.classList.remove('on');
    showCredit('');
  }

  function start() {
    if (running || cfg.enabled === false || Q.video === '0') return;
    var clips = list();
    if (!clips.length) return;
    running = true;
    failures = 0;
    dropped = {};
    levelFails = {};
    order = shuffled(clips);
    avMode = avUsable();
    if (avMode) avRequest(0, false); else request(0, false);
    // Leaving the TV on should not stream forever; the photos take over.
    var mins = cfg.stopAfterMin || 0;
    clearTimeout(stopTimer);
    if (mins) stopTimer = setTimeout(stop, mins * 60000);
  }

  // Left and Right on the remote: the scene before or after the one asked for
  // last, so quick presses skip ahead without waiting for each to load.
  function step(dir) {
    if (!running || !order.length) return;
    failures = 0;
    if (avMode) avRequest(target + (dir < 0 ? -1 : 1), true);
    else request(target + (dir < 0 ? -1 : 1), true);
  }

  // Leaving GLOT (an app opens) frees the player and the decoder.
  document.addEventListener('visibilitychange', function () { if (document.hidden && running) stop(); });

  // A button press in the screensaver brings back the current place's caption.
  function showCaptionNow() {
    var clip = avMode ? (avCur && avCur.clip) : (current && current.v && current.clip);
    if (!running || !clip) return false;
    var cap = captionAt(clip, avMode ? avTime() : current.v.currentTime);
    var text = cap ? captionText(cap) : '';
    if (!text && cfg.captions !== 'off') text = clip.credit;
    if (!text) return false;
    showCredit(text);
    return true;
  }

  GH.VideoSaver = {
    showCaption: showCaptionNow,
    start: start,
    stop: stop,
    step: step,
    isRunning: function () { return running; },
    // For tests: what is on screen and loading.
    debug: function () {
      return { av: avMode, oneDecoder: oneDecoder, target: target, current: current && current.idx, pending: pending && pending.idx,
        videos: host.querySelectorAll('video').length, black: black.classList.contains('on') };
    }
  };
}());
