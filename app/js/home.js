/*
 * Glass Home - home screen.
 *
 * Remote keys (no registration needed): Left/Right move along the dock (no
 * wrap), OK opens, holding OK for 0.7 s opens a small menu (Move left, Move
 * right, Remove or Hide, Cancel), Back closes menus and does nothing at the
 * top level. While the app is hidden (another app in front) every timer and
 * animation is paused.
 */
(function () {
  'use strict';
  var GH = window.GH;
  var cfg = GH.config;
  var P = GH.platform;
  var D = GH.data;
  var Q = GH.query;
  var ls = GH.ls;
  var $ = function (id) { return document.getElementById(id); };

  // Dock geometry. Tiles are 156 px; with more than 9 items they shrink to no
  // less than 140 px, and past that the row scrolls (edges fade).
  var TILE_MAX = 156;                // Advanced > Tile size changes these
  var TILE_MIN = 140;
  var TILE_SIZES = { small: [132, 120], normal: [156, 140], large: [184, 160] };
  var backOnHome = 'aerials';
  var hiddenMenuOn = true;
  var addTileOn = true;
  var guestTileOn = false;
  var guestsSettings = { tile: false };
  var layoutChangedGuests = false;
  var PADX = 28;                     // visual glass padding left/right
  var PADY = 26;
  var EDGE = 16;                     // room inside the clip for the enlarged tile
  var MAX_ROW = 1920 - 2 * (92 + PADX);   // the Apple TV face widens this
  var ASPECT = 1;                          // tile width / height: 1.6 on the Apple TV face
  var DOCK_BOTTOM = 150;                   // per face, set in applyDesign
  var TILE = TILE_MAX;
  var GAP = 28;
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8 };
  var YT_MODES = ['payload', 'uri', 'both'];
  var YT_MODE_NAMES = { payload: 'Smart Hub payload', uri: 'watch URL', both: 'payload + URL' };

  var stage = $('stage');
  var dock = $('dock');
  var viewport = $('dock-viewport');
  var row = $('dock-row');
  var label = $('label');
  var menu = $('menu');
  var panel = $('panel');
  var scrim = $('scrim');

  // Older-TV switches (config.js). ?photoService=0 tries the first in preview.
  var photoService = cfg.photoService !== false && Q.photoService !== '0';
  var smartHubLaunch = cfg.smartHubLaunch === true;

  // Dock apps: config.js plus anything added from the All apps screen.
  var extraApps = ls.get('gh.extraApps') || [];
  var defs = cfg.apps.concat(extraApps);
  var defByKey = {};
  defs.forEach(function (d) { defByKey[d.key] = d; });

  var apps = {};
  var shortcuts = [];
  var items = [];
  var tileEls = {};
  var focus = 0;
  var focusKey = null;              // the tile the viewer chose; survives dock rebuilds
  var offset = 0;
  var mode = 'dock';
  var menuItems = [];
  var menuFocus = 0;
  var panelButtons = [];
  var panelFocus = 0;
  var panelRowFocus = 0;
  var confirmNewPw = 0;
  var waitEnterRelease = false;
  var releaseTimer = null;
  var enterDown = false;
  var longTimer = null;
  var longFired = false;
  var backdrop = null;
  var bundled = [];
  var serviceUp = null;
  var serviceError = null;
  var ensuring = false;
  var clockTimer = null;
  var pollTimer = null;
  var retryTimer = null;
  var storage = null;
  var hidden = ls.get('gh.hidden') || [];
  var appOrder = ls.get('gh.appOrder') || [];
  var inputOrder = ls.get('gh.inputOrder') || [];
  var allOrder = ls.get('gh.allOrder') || [];
  var disabledPhotos = [];
  var settingsSig = null;
  var homeSig = null;
  var catalogSig = null;
  var wantDrift = true;
  var upPresses = [];
  var serviceRestartTried = false;
  var ytMode = ls.get('gh.ytMode') || cfg.youtubeMode;
  if (YT_MODES.indexOf(ytMode) < 0) ytMode = 'payload';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function div(cls, text) {
    var e = document.createElement('div');
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- desktop preview: fit the 1920x1080 stage to the window ----------
  function fitStage() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (w === 1920 && h === 1080) { stage.style.transform = ''; return; }
    var s = Math.min(w / 1920, h / 1080);
    stage.style.transform = 'translate(' + Math.round((w - 1920 * s) / 2) + 'px, ' + Math.round((h - 1080 * s) / 2) + 'px) scale(' + s + ')';
  }

  // ---------- toast ----------
  var toastTimer = null;
  function toast(text, ms) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || 3200);
  }

  // ---------- clock: "3:45 pm" and "Tuesday 21 October" ----------
  var timeFmt = null;
  var dateFmt = null;
  function setClockFormat(h24) {
    try {
      timeFmt = new Intl.DateTimeFormat(cfg.locale || undefined, { hour: 'numeric', minute: '2-digit', hour12: !h24 });
    } catch (e) { /* very old engine: keep what there is */ }
    renderClock();
  }
  try {
    timeFmt = new Intl.DateTimeFormat(cfg.locale || undefined, { hour: 'numeric', minute: '2-digit' });
    dateFmt = new Intl.DateTimeFormat(cfg.locale || undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  } catch (e) { /* very old engine: fallback below */ }

  function renderClock() {
    var now = new Date();
    var main = '';
    var period = '';
    var dateText = '';
    if (timeFmt && timeFmt.formatToParts) {
      timeFmt.formatToParts(now).forEach(function (p) {
        if (p.type === 'dayPeriod') period = p.value.replace(/\./g, '').toLowerCase();
        else if (p.type === 'hour' || p.type === 'minute' || (p.type === 'literal' && p.value.indexOf(':') >= 0)) main += p.value;
      });
      var parts = {};
      dateFmt.formatToParts(now).forEach(function (p) { parts[p.type] = p.value; });
      dateText = [parts.weekday, parts.day, parts.month].join(' ');
    } else {
      var h = now.getHours();
      main = ((h % 12) || 12) + ':' + ('0' + now.getMinutes()).slice(-2);
      period = h < 12 ? 'am' : 'pm';
      dateText = now.toDateString();
    }
    renderWidgets(now);
    if (GH.fitClock) GH.fitClock();
    var t = $('time');
    t.textContent = main.trim();
    if (period) { var s = document.createElement('span'); s.className = 'ampm'; s.textContent = period; t.appendChild(s); }
    $('date').textContent = dateText;
  }

  // ---------- dock model ----------
  function orderedAppKeys() {
    var keys = [];
    appOrder.forEach(function (k) { if (defByKey[k] && keys.indexOf(k) < 0) keys.push(k); });
    defs.forEach(function (d) { if (keys.indexOf(d.key) < 0) keys.push(d.key); });
    return keys;
  }

  // HDMI inputs from config.js, in the order chosen with Move left/right;
  // inputs not moved yet follow, in config order. (?inputs=1 shows two sample
  // HDMI inputs and Live TV in preview.)
  var inputDefs = cfg.preview && Q.inputs === '1'
    ? [{ hdmi: 2, label: 'Games console' }, { hdmi: 3, label: 'Blu-ray' }, { tv: true, label: 'Live TV' }]
    : (cfg.inputs || []);
  function inputKey(inp) { return inp.tv ? 'in:tv' : 'in:' + inp.hdmi; }
  function orderedInputs() {
    // Ranked from the unsorted list: older engines sort in place, so indexOf
    // on the array being sorted can move under the comparator.
    function rank(inp) {
      var i = inputOrder.indexOf(inputKey(inp));
      return i < 0 ? inputOrder.length + inputDefs.indexOf(inp) : i;
    }
    return inputDefs.slice().sort(function (a, b) { return rank(a) - rank(b); });
  }

  function buildItems() {
    var list = [];
    orderedAppKeys().forEach(function (k) {
      var a = apps[k];
      // Hidden apps come back from +, so without the photo service (no +)
      // nothing stays hidden.
      if (!a || (photoService && hidden.indexOf(k) >= 0)) return;
      list.push({ kind: 'app', key: 'app:' + k, appKey: k, label: defByKey[k].label, id: a.id,
        storeId: defByKey[k].storeId,
        icon: defByKey[k].icon === false ? null : (defByKey[k].icon || P.iconUrl(a.iconPath)) });
    });
    orderedInputs().forEach(function (inp) {
      var k = inputKey(inp);
      if (photoService && hidden.indexOf(k) >= 0) return;    // as for apps
      list.push({ kind: 'input', key: k, appKey: k, label: inp.label, hdmi: inp.hdmi, tv: !!inp.tv, icon: inp.icon || null, brand: inp.brand || null });
    });
    if (!photoService) return list;
    shortcuts.forEach(function (s) {
      list.push({
        kind: s.type === 'youtube' ? 'youtube' : 'web', key: 'sc:' + s.id, scId: s.id, label: s.name, url: s.url,
        videoId: s.videoId, playlistId: s.playlistId, start: s.start,
        icon: s.icon ? D.media(s.icon) : null, iconW: s.iconW || 0
      });
    });
    if (guestTileOn) list.push({ kind: 'guest', key: 'guest', label: 'Guests' });
    if (addTileOn) list.push({ kind: 'add', key: 'add', label: 'Add photos and shortcuts' });
    return list;
  }

  function signature(it) {
    return [it.kind, it.label, it.icon || '', it.videoId || '', it.iconW || 0].join('|');
  }

  function hueFor(seed) {
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    var hues = [196, 172, 214, 252, 328, 18, 38, 146];
    return hues[h % hues.length];
  }

  function hostOf(url) {
    var m = /^[a-z]+:\/\/(?:www\.)?([^\/?#:]+)/i.exec(url || '');
    return m ? m[1].toLowerCase() : '';
  }

  function monogram(face, it) {
    face.textContent = '';
    var hue = hueFor(hostOf(it.url) || it.label || '');
    face.style.background = 'linear-gradient(150deg, hsl(' + hue + ', 52%, 44%) 0%, hsl(' + ((hue + 28) % 360) + ', 58%, 22%) 100%)';
    var letter = String(it.label || hostOf(it.url) || '?').trim().charAt(0).toUpperCase();
    face.appendChild(div('monogram', letter));
  }

  // Looks at a site icon's corners and brightness so a transparent dark logo
  // gets a light plate and a transparent light logo stays on glass.
  function plateFor(img, face) {
    try {
      var c = document.createElement('canvas');
      c.width = 24; c.height = 24;
      var x = c.getContext('2d');
      x.drawImage(img, 0, 0, 24, 24);
      var d = x.getImageData(0, 0, 24, 24).data;
      var corners = [0, 23 * 4, 23 * 24 * 4, (23 * 24 + 23) * 4];
      var transparent = corners.some(function (i) { return d[i + 3] < 200; });
      if (!transparent) return;
      var sum = 0;
      var n = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n += 1;
      }
      face.classList.add(n && sum / n < 110 ? 'plate-light' : 'plate-glass');
    } catch (e) { /* cross-origin or decode issue: leave as is */ }
  }

  function youTubeThumb(img, videoId, onFail) {
    var sizes = ['maxresdefault', 'hq720', 'sddefault', 'hqdefault'];
    var i = 0;
    function next() {
      if (i >= sizes.length) { onFail(); return; }
      img.src = 'https://i.ytimg.com/vi/' + videoId + '/' + sizes[i++] + '.jpg';
    }
    img.onerror = next;
    img.onload = function () { if (img.naturalWidth <= 120) next(); };
    next();
  }

  function plusGlyph() {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 48 48');
    s.setAttribute('class', 'plus');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M24 10v28M10 24h28');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '3.2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('fill', 'none');
    s.appendChild(p);
    return s;
  }

  function wifiGlyph() {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 48 48');
    s.setAttribute('class', 'plus');
    ['M8 19a23 23 0 0 1 32 0', 'M14 25.5a14.5 14.5 0 0 1 20 0', 'M20 32a6 6 0 0 1 8 0'].forEach(function (d) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '3.2');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('fill', 'none');
      s.appendChild(p);
    });
    var dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', '24'); dot.setAttribute('cy', '37.5'); dot.setAttribute('r', '2.6'); dot.setAttribute('fill', 'currentColor');
    s.appendChild(dot);
    return s;
  }

  function brandFace(face, b) {
    face.classList.add('branded');
    face.style.background = b.bg;
    if (b.text) {
      var word = div('brand-word', b.text);
      face.appendChild(word);
      if (b.sub) face.appendChild(div('brand-sub', b.sub));
      return;
    }
    var m = new Image();
    m.alt = '';
    m.className = 'brand-mark';
    var pad = b.pad == null ? 24 : b.pad;
    m.style.width = (100 - 2 * pad) + '%';
    m.style.height = (100 - 2 * pad) + '%';
    m.src = 'img/marks/' + b.mark + '.svg';
    face.appendChild(m);
  }

  // Square icons with solid corners fill the tile. Anything else (transparent
  // or an odd shape) sits inset on a plain plate, light if the logo is dark, so
  // no tile shows the photos through its logo. If the TV will not let the app
  // read the icon's pixels, the dark plate stays.
  function fitAppIcon(img, face) {
    var w = img.naturalWidth;
    var h = img.naturalHeight;
    if (!w || !h) return;
    try {
      var c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      var x = c.getContext('2d');
      x.drawImage(img, 0, 0, 32, 32);
      var d = x.getImageData(0, 0, 32, 32).data;
      var corners = [0, 31 * 4, 31 * 32 * 4, (31 * 32 + 31) * 4];
      var solid = corners.every(function (i) { return d[i + 3] > 240; });
      if (solid && Math.abs(w / h - 1) < 0.08) {
        img.classList.remove('pad');
        img.classList.add('full');
        face.classList.remove('plate-dark');
        return;
      }
      if (solid) return;                       // opaque but not square: inset on dark
      var sum = 0;
      var n = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n += 1;
      }
      if (n && sum / n < 70) {
        face.classList.remove('plate-dark');
        face.classList.add('plate-light');
      }
    } catch (e) { /* pixels not readable: keep the dark plate */ }
  }

  function makeTile(it) {
    var el = div('tile tile-' + it.kind);
    el.appendChild(div('glow'));
    var face = div('face');
    el.appendChild(face);
    var img;
    if (it.kind === 'app') {
      var appBrand = GH.brandForApp(it.label, it.id);
      if (appBrand) {
        brandFace(face, appBrand);
      } else if (it.icon) {
        img = new Image();
        img.className = 'app-icon pad';
        img.alt = '';
        face.classList.add('plate-dark');      // until the icon has been looked at
        img.onload = function () { fitAppIcon(img, face); };
        img.onerror = function () { face.textContent = ''; face.appendChild(div('name-fallback', it.label)); };
        img.src = it.icon;
        face.appendChild(img);
      } else {
        face.classList.add('plate-dark');
        face.appendChild(div('name-fallback', it.label));
      }
    } else if (it.kind === 'web') {
      if (it.icon) {
        img = new Image();
        img.alt = '';
        img.crossOrigin = 'anonymous';
        img.className = it.iconW && it.iconW < 120 ? 'site-icon small' : 'site-icon';
        img.onload = function () { plateFor(img, face); };
        img.onerror = function () { monogram(face, it); };
        img.src = it.icon;
        face.appendChild(img);
      } else {
        monogram(face, it);
      }
    } else if (it.kind === 'youtube') {
      img = new Image();
      img.alt = '';
      img.className = 'thumb';
      face.appendChild(img);
      var fail = function () { face.classList.add('no-thumb'); img.remove(); face.insertBefore(div('name-fallback', it.label), face.firstChild); };
      if (it.icon) {
        img.onerror = function () { if (it.videoId) youTubeThumb(img, it.videoId, fail); else fail(); };
        img.src = it.icon;
      } else if (it.videoId) {
        youTubeThumb(img, it.videoId, fail);
      } else {
        fail();
      }
      face.appendChild(div('play'));
    } else if (it.kind === 'input') {
      var inputBrand = it.brand ? GH.brandByKey(it.brand) : null;
      if (inputBrand) {
        brandFace(face, inputBrand);
      } else if (it.icon) {
        img = new Image();
        img.className = 'input-icon';
        img.alt = '';
        img.onerror = function () { img.remove(); face.insertBefore(div('name-fallback', it.label), face.firstChild); };
        img.src = it.icon;
        face.appendChild(img);
      } else {
        face.appendChild(div('name-fallback', it.label));
      }
      if (!it.tv) face.appendChild(div('input-port', 'HDMI ' + it.hdmi));   // no port caption on Live TV
    } else if (it.kind === 'guest') {
      face.appendChild(wifiGlyph());
    } else {
      face.appendChild(plusGlyph());
    }
    face.appendChild(div('sheen'));
    return el;
  }

  function rebuildDock(keepKey) {
    var wanted = keepKey || focusKey;
    items = buildItems();
    var seen = {};
    var els = items.map(function (it) {
      var sig = signature(it);
      var cur = tileEls[it.key];
      if (!cur || cur.sig !== sig) {
        cur = { el: makeTile(it), sig: sig };
        tileEls[it.key] = cur;
      }
      seen[it.key] = true;
      return cur.el;
    });
    Object.keys(tileEls).forEach(function (k) { if (!seen[k]) delete tileEls[k]; });
    // Touch the DOM only when the row really changed: moving an element
    // restarts its CSS animations (the focus sheen would replay on every sync).
    var same = row.children.length === els.length;
    for (var c = 0; same && c < els.length; c++) same = row.children[c] === els[c];
    if (!same) {
      var frag = document.createDocumentFragment();
      els.forEach(function (el) { frag.appendChild(el); });
      row.textContent = '';
      row.appendChild(frag);
    }
    var idx = -1;
    for (var i = 0; i < items.length; i++) if (items[i].key === wanted) { idx = i; break; }
    setFocus(idx >= 0 ? idx : clamp(focus, 0, items.length - 1), true);
  }

  function sizeFor(n) {
    var bigGap = ASPECT > 1 ? 40 : 28;
    var gap = ASPECT > 1 ? 34 : 24;
    if (n * TILE_MAX * ASPECT + (n - 1) * bigGap <= MAX_ROW) return { tile: TILE_MAX, gap: bigGap };
    var tile = Math.floor((MAX_ROW - (n - 1) * gap) / (n * ASPECT));
    return { tile: Math.max(TILE_MIN, Math.min(TILE_MAX, tile)), gap: gap };
  }

  function applySize(n) {
    var sz = sizeFor(n);
    if (sz.tile === TILE && sz.gap === GAP && dock.style.getPropertyValue('--tile')) return;
    TILE = sz.tile;
    GAP = sz.gap;
    dock.style.setProperty('--tile', TILE + 'px');
    dock.style.setProperty('--gap', GAP + 'px');
    dock.style.setProperty('--tile-radius', Math.round(TILE * (ASPECT > 1 ? 0.13 : 0.192)) + 'px');
    dock.style.setProperty('--aspect', String(ASPECT));
  }

  function dockHeight() { return TILE + 2 * PADY; }

  function layoutDock() {
    var n = items.length;
    applySize(n);
    var TW = Math.round(TILE * ASPECT);
    var rowW = n * TW + (n - 1) * GAP;
    var viewW = Math.min(rowW, MAX_ROW);
    viewport.style.width = (viewW + 2 * EDGE) + 'px';
    var x = focus * (TW + GAP);
    var scrolling = rowW > MAX_ROW;
    if (!scrolling) offset = 0;
    else {
      var margin = TW * 0.75;
      if (x - offset < margin) offset = x - margin;
      if (x + TW - offset > viewW - margin) offset = x + TW - viewW + margin;
      offset = clamp(offset, 0, rowW - viewW);
    }
    row.style.transform = 'translate3d(' + (-offset) + 'px, 0, 0)';
    dock.classList.toggle('scrolling', scrolling);
    dock.classList.toggle('fade-left', scrolling && offset > 1);
    dock.classList.toggle('fade-right', scrolling && offset < rowW - viewW - 1);
    var dockW = viewW + 2 * PADX;
    var cx = (1920 - dockW) / 2 + PADX + x - offset + TW / 2;
    // centred under the tile, but never off the screen (long video titles)
    var lw = label.offsetWidth || 0;
    var left = clamp(cx - lw / 2, 72, 1920 - 72 - lw);
    label.style.transform = 'translate3d(' + Math.round(left) + 'px, 0, 0)';
    return cx;
  }

  function setFocus(i, quiet) {
    if (!items.length) return;
    i = clamp(i, 0, items.length - 1);
    focus = i;
    items.forEach(function (it, idx) {
      var t = tileEls[it.key];
      if (t) t.el.classList.toggle('focused', idx === focus);
    });
    var text = items[focus].label;
    if (label.textContent !== text) label.textContent = text;
    if (mode === 'dock') label.classList.add('on');
    layoutDock();
    updateShelf(items[focus]);
    if (!quiet) {
      focusKey = items[focus].key;
      ls.set('gh.focus', focusKey);
    }
  }

  // ---------- opening things ----------
  // smartHubLaunch (older TVs): the photos and dock are hidden while an app
  // starts, to free graphics memory (on a 2018 TV Netflix and Prime Video fail
  // to start while they hold it). They come back when Glass Home is on screen
  // again, if the launch fails, or after 8 s if the app never appears.
  var launchGuard = null;
  function setLaunching(on) {
    clearTimeout(launchGuard);
    document.documentElement.classList.toggle('launching', on);
    if (!on) return;
    if (backdrop) backdrop.pause();
    launchGuard = setTimeout(function () {
      if (!document.hidden) { setLaunching(false); if (backdrop) backdrop.resume(); }
    }, 8000);
  }

  function activate(it) {
    if (!it) return;
    hideLive();
    if (it.kind === 'add') { openPanel(); return; }
    if (it.kind === 'guest') { openGuests(); return; }
    startUsage(it);
    var p;
    var viaSmartHub = it.kind === 'app' && smartHubLaunch;
    if (viaSmartHub && !cfg.preview) setLaunching(true);
    if (it.kind === 'app') p = P.launchApp(it.id, viaSmartHub ? it.storeId : null);
    else if (it.kind === 'input') p = P.switchInput(it.tv ? 'TV' : it.hdmi);
    else if (it.kind === 'web') p = P.openUrl(it.url);
    else p = P.openYouTube(it, ytMode);
    p.then(function (how) {
      if (String(how).indexOf('preview:') === 0) toast('Preview: would open ' + it.label);
      else if (how === 'youtube-home') toast('YouTube opened, but not at this video');
      else if (how === 'browser-home') toast('The browser opened without the address');
    }, function (e) {
      if (viaSmartHub) { setLaunching(false); if (backdrop && !document.hidden) backdrop.resume(); }
      toast('Couldn’t open ' + it.label + (e && e.message ? ' (' + e.message + ')' : ''), 4500);
    });
  }

  // ---------- long-press menu ----------
  function groupOf(it) {
    if (it.kind === 'app' || it.kind === 'input') return items.filter(function (x) { return x.kind === it.kind; });
    return items.filter(function (x) { return x.kind === 'web' || x.kind === 'youtube'; });
  }

  function openMenu() {
    hideLive();
    var it = items[focus];
    if (!it || it.kind === 'add') return;
    var group = groupOf(it);
    var gi = group.indexOf(it);
    menuItems = [
      { label: 'Move left', disabled: gi <= 0, run: function () { moveItem(it, -1); } },
      { label: 'Move right', disabled: gi >= group.length - 1, run: function () { moveItem(it, 1); } },
      it.kind === 'web' || it.kind === 'youtube' ? { label: 'Remove', run: function () { removeShortcut(it); } }
        : photoService ? { label: 'Hide', run: function () { hideApp(it); } }
        : null,                           // apps and inputs: no + to bring them back
      { label: 'Cancel', run: function () {} }
    ].filter(Boolean);
    menuFocus = 0;
    while (menuItems[menuFocus].disabled) menuFocus += 1;
    menu.textContent = '';
    menu.appendChild(div('menu-title', it.label));
    menuItems.forEach(function (m) {
      var e = div('menu-item' + (m.disabled ? ' disabled' : ''), m.label);
      m.el = e;
      menu.appendChild(e);
    });
    renderMenuFocus();
    var cx = layoutDock();
    var w = menu.offsetWidth || 340;
    menu.style.left = Math.round(clamp(cx - w / 2, 48, 1920 - 48 - w)) + 'px';
    menu.style.bottom = (DOCK_BOTTOM + dockHeight() + 18) + 'px';
    mode = 'menu';
    menu.classList.add('open');
    dock.classList.add('dimmed');
  }

  function renderMenuFocus() {
    menuItems.forEach(function (m, i) { m.el.classList.toggle('focused', i === menuFocus); });
  }

  function closeMenu() {
    menu.classList.remove('open');
    dock.classList.remove('dimmed');
    mode = menuReturn || 'dock';
    menuReturn = null;
  }

  // ---------- All apps: a screen below Home, Down from the dock slides to it ----------
  var AA_COLS = 6;
  var AA_ROW_H = 262;
  var AA_VISIBLE_ROWS = 3;
  var allGrid = $('allapps-grid');
  var allApps = ls.get('gh.allapps.v1') || [];
  var allEls = [];
  var allFocus = 0;
  var allOffset = 0;
  var menuReturn = null;

  function dockDefFor(id) {
    for (var i = 0; i < defs.length; i++) {
      if (apps[defs[i].key] && apps[defs[i].key].id === id) return defs[i];
    }
    return null;
  }

  function renderAllApps() {
    var frag = document.createDocumentFragment();
    allEls = allApps.map(function (a) {
      var def = dockDefFor(a.id);
      var it = { kind: 'app', label: a.name, id: a.id, icon: def && def.icon === false ? null : P.iconUrl(a.iconPath) };
      var cell = div('aa-cell');
      var tile = makeTile(it);
      cell.appendChild(tile);
      cell.appendChild(div('aa-name', a.name));
      frag.appendChild(cell);
      return { cell: cell, tile: tile, app: a };
    });
    allGrid.textContent = '';
    allGrid.appendChild(frag);
    $('allapps-count').textContent = allApps.length ? allApps.length + ' apps' : '';
    setAllFocus(clamp(allFocus, 0, Math.max(0, allEls.length - 1)));
  }

  function setAllFocus(i) {
    if (!allEls.length) return;
    allFocus = clamp(i, 0, allEls.length - 1);
    allEls.forEach(function (x, idx) {
      x.tile.classList.toggle('focused', idx === allFocus);
      x.cell.classList.toggle('focused', idx === allFocus);
    });
    var r = Math.floor(allFocus / AA_COLS);
    if (r < allOffset) allOffset = r;
    if (r > allOffset + AA_VISIBLE_ROWS - 1) allOffset = r - AA_VISIBLE_ROWS + 1;
    allGrid.style.transform = 'translate3d(0, ' + (-allOffset * AA_ROW_H) + 'px, 0)';
  }

  // The order chosen by the viewer; apps installed later follow, A to Z.
  function orderAll(list) {
    function rank(a, i) {
      var r = allOrder.indexOf(a.id);
      return r < 0 ? allOrder.length + i : r;
    }
    return list.map(function (a, i) { return { a: a, r: rank(a, i) }; })
      .sort(function (x, y) { return x.r - y.r; })
      .map(function (x) { return x.a; });
  }

  function loadAllApps() {
    return P.listApps().then(function (list) {
      if (mode === 'apps-move') return;
      list = orderAll(list);
      var same = JSON.stringify(list) === JSON.stringify(allApps);
      allApps = list;
      ls.set('gh.allapps.v1', list);
      if (!same || !allEls.length) renderAllApps();
      reportCatalog();
    }, function (e) {
      if (mode === 'apps' && !allApps.length) toast('Couldn’t list the apps' + (e && e.message ? ' (' + e.message + ')' : ''), 4500);
    });
  }

  function openAllApps() {
    hideLive();
    mode = 'apps';
    if (!allEls.length) renderAllApps();
    document.documentElement.classList.add('apps');
    $('allapps').classList.add('open');
    label.classList.remove('on');
    loadAllApps();
  }

  function closeAllApps() {
    document.documentElement.classList.remove('apps');
    $('allapps').classList.remove('open');
    label.classList.add('on');
    mode = 'dock';
    setFocus(focus, true);
    lastShelfKey = null;
    updateShelf(items[focus]);
  }

  // The remote's Home button reaches an already running app as an appcontrol
  // event: always land on the dock, awake, whatever was showing.
  window.addEventListener('appcontrol', function () {
    if (mode === 'apps-move') finishMove(false);
    if (mode === 'apps') closeAllApps();
    if (GH.wakeAmbient && document.documentElement.classList.contains('ambient')) GH.wakeAmbient();
  });

  function openAllAppsMenu() {
    var x = allEls[allFocus];
    if (!x) return;
    var a = x.app;
    var def = dockDefFor(a.id);
    var onDock = def && hidden.indexOf(def.key) < 0;
    menuItems = [
      { label: 'Move', run: startMove },
      onDock ? { label: 'Remove from Home', run: function () { removeFromDock(def, a); } }
        : { label: 'Add to Home', run: function () { addToDock(def, a); } },
      { label: 'Cancel', run: function () {} }
    ];
    menuFocus = 0;
    menu.textContent = '';
    menu.appendChild(div('menu-title', a.name));
    menuItems.forEach(function (m) {
      m.el = div('menu-item', m.label);
      menu.appendChild(m.el);
    });
    renderMenuFocus();
    var w = menu.offsetWidth || 340;
    menu.style.left = Math.round((1920 - w) / 2) + 'px';
    menu.style.bottom = '400px';
    menuReturn = 'apps';
    mode = 'menu';
    menu.classList.add('open');
  }

  // ---------- hidden menu: Up three times quickly on the Home row ----------
  var HIDDEN_PRESSES = 3;
  var HIDDEN_WINDOW_MS = 1500;

  function noteUpPress() {
    if (!hiddenMenuOn) return;
    var now = Date.now();
    upPresses = upPresses.filter(function (t) { return now - t < HIDDEN_WINDOW_MS; });
    upPresses.push(now);
    if (upPresses.length >= HIDDEN_PRESSES) {
      upPresses = [];
      openHiddenMenu();
    }
  }

  function gb(bytes) { return (bytes / 1073741824).toFixed(1) + ' GB'; }

  function memoryLine() {
    var m = P.memory();
    return m ? gb(m.available) + ' free of ' + gb(m.total) : '';
  }

  function openHiddenMenu() {
    menuItems = [
      { label: 'Samsung Home', run: function () {
        P.openSamsungHome().then(function (how) {
          if (String(how).indexOf('preview:') === 0) toast('Preview: would open Samsung Home');
        }, function (e) { toast('Couldn\u2019t open Samsung Home' + (e && e.message ? ' (' + e.message + ')' : ''), 4500); });
      } },
      { label: 'Clean RAM', run: cleanRam },
      { label: 'Photos, website and QR code', run: function () { if (photoService) openPanel(); } },
      { label: 'Guests: Wi-Fi and photo drop', run: function () { if (photoService) openGuests(); } },
      { label: 'Restart this screen', run: function () { location.reload(); } },
      { label: 'Restart background service', run: restartServiceNow },
      { label: 'Startup times', run: showBootTimes },
      { label: 'Cancel', run: function () {} }
    ];
    menuFocus = 0;
    menu.textContent = '';
    menu.appendChild(div('menu-title', memoryLine() || 'Hidden menu'));
    menuItems.forEach(function (m) {
      m.el = div('menu-item', m.label);
      menu.appendChild(m.el);
    });
    renderMenuFocus();
    var w = menu.offsetWidth || 340;
    menu.style.left = Math.round((1920 - w) / 2) + 'px';
    menu.style.bottom = '300px';
    menuReturn = 'dock';
    mode = 'menu';
    menu.classList.add('open');
    dock.classList.add('dimmed');
  }

  // Closes apps left running in the background. There's no way for an app to
  // clear the TV's memory directly, so this is what frees it.
  function cleanRam() {
    var before = P.memory();
    toast('Closing background apps\u2026', 60000);
    D.closeApps().then(function (r) {
      if (!r.reachable) { toast('The TV\u2019s app service didn\u2019t answer, so nothing was closed.', 5000); return; }
      var after = P.memory();
      var parts = [];
      parts.push(r.closed.length ? 'Closed ' + r.closed.join(', ') : 'No background apps were running');
      if (r.failed.length) parts.push('couldn\u2019t close ' + r.failed.join(', '));
      if (before && after) parts.push('free memory ' + gb(before.available) + ' \u2192 ' + gb(after.available));
      toast(parts.join('  \u00b7  '), 6000);
    }, function () { toast('Couldn\u2019t reach the background service.', 4500); });
  }

  function restartServiceNow() {
    toast('Restarting the background service\u2026', 8000);
    D.restartService().then(function (ok) {
      if (!ok) { toast('It can\u2019t restart itself yet. Unplug the TV for 60 seconds.', 5000); return; }
      setTimeout(function () {
        ensureService();
        toast('Background service restarted');
      }, 2500);
    });
  }

  function showBootTimes() {
    D.info().then(function (i) {
      var b = i && i.boot;
      if (!b) { toast('Startup times aren\u2019t available.', 4000); return; }
      function sec(v) { return v === null || v === undefined ? '?' : v + ' s'; }
      toast('After power-on  \u00b7  service ' + sec(b.service) + '  \u00b7  app loaded ' + sec(b.appLoaded) + '  \u00b7  on screen ' + sec(b.appVisible), 9000);
    });
  }

  GH.nextPhoto = function () {
    if (!backdrop || backdrop.busy) return;
    clearTimeout(backdrop.timer);
    backdrop.timer = null;
    backdrop.advance();
  };

  // ---------- rearranging All apps: arrows carry the tile, OK keeps, Back undoes ----------
  var moveBefore = null;

  function reflowAllApps() {
    allEls.forEach(function (x) { allGrid.appendChild(x.cell); });
    allApps = allEls.map(function (x) { return x.app; });
  }

  function startMove() {
    var x = allEls[allFocus];
    if (!x) return;
    moveBefore = allEls.slice();
    mode = 'apps-move';
    x.cell.classList.add('moving');
    $('allapps-count').textContent = 'Arrows move it  ·  OK keeps it here  ·  Back cancels';
  }

  function moveTileTo(j) {
    j = clamp(j, 0, allEls.length - 1);
    if (j === allFocus) return;
    var x = allEls.splice(allFocus, 1)[0];
    allEls.splice(j, 0, x);
    reflowAllApps();
    setAllFocus(j);
  }

  function finishMove(keep) {
    var x = allEls[allFocus];
    if (x) x.cell.classList.remove('moving');
    if (keep) {
      allOrder = allApps.map(function (a) { return a.id; });
      ls.set('gh.allapps.v1', allApps);
      saveHome();
    } else if (moveBefore) {
      var id = x && x.app.id;
      allEls = moveBefore;
      reflowAllApps();
      for (var i = 0; i < allEls.length; i++) if (allEls[i].app.id === id) { allFocus = i; break; }
      setAllFocus(allFocus);
    }
    moveBefore = null;
    mode = 'apps';
    $('allapps-count').textContent = allApps.length ? allApps.length + ' apps' : '';
  }

  // ---------- settings from the phone website ----------
  function homeState() {
    return { order: appOrder, hidden: hidden, extra: extraApps, inputs: inputDefs, inputOrder: inputOrder, allOrder: allOrder };
  }

  // Any layout change made on the TV goes to the service, so the website shows it.
  function saveHome() {
    var h = homeState();
    homeSig = JSON.stringify(h);
    ls.set('gh.allOrder', allOrder);
    if (photoService) D.saveSettings({ home: h }).catch(function () { /* resent with the next change */ });
  }

  // Returns true if the app list changed, so apps need looking up again.
  function adoptHome(h) {
    var sig = JSON.stringify(h);
    if (sig === homeSig) return false;
    homeSig = sig;
    var extraChanged = JSON.stringify(h.extra) !== JSON.stringify(extraApps);
    appOrder = h.order;
    hidden = h.hidden;
    inputOrder = h.inputOrder;
    inputDefs = h.inputs;
    allOrder = h.allOrder;
    extraApps = h.extra;
    defs = cfg.apps.concat(extraApps);
    defByKey = {};
    defs.forEach(function (d) { defByKey[d.key] = d; });
    ls.set('gh.hidden', hidden);
    ls.set('gh.appOrder', appOrder);
    ls.set('gh.inputOrder', inputOrder);
    ls.set('gh.extraApps', extraApps);
    ls.set('gh.allOrder', allOrder);
    return extraChanged;
  }

  // ---------- faces (Design tab on the website) ----------
  var design = null;
  var FACES = ['tv', 'glass', 'minimal', 'bigclock'];
  var FONT_FAMILIES = {
    system: 'var(--font)', inter: '"GH Inter", var(--font)', rounded: '"GH Rounded", var(--font)',
    serif: '"GH Serif", Georgia, serif', condensed: '"GH Condensed", var(--font)', mono: '"GH Mono", monospace'
  };
  var GRADIENTS = {
    midnight: 'radial-gradient(120% 110% at 20% 0%, #1c2740 0%, #0b1020 55%, #04060c 100%)',
    dusk: 'linear-gradient(160deg, #3b1f4a 0%, #7a3b52 45%, #e0875a 100%)',
    ocean: 'linear-gradient(165deg, #0b3a5b 0%, #0e5e78 45%, #46b3b9 100%)',
    forest: 'linear-gradient(165deg, #0f2a1f 0%, #1f4a33 50%, #5f8a4c 100%)',
    graphite: 'linear-gradient(170deg, #2b2e33 0%, #17191c 60%, #0b0c0e 100%)',
    sunrise: 'linear-gradient(165deg, #f6c177 0%, #e07a5f 50%, #3d405b 100%)'
  };
  var autoAccent = null;

  function applyDesign(d) {
    var root = document.documentElement;
    var prevFace = design && design.face;
    var prevBg = design && design.background;
    design = d;
    FACES.forEach(function (f) { root.classList.toggle('face-' + f, f === d.face); });
    var f = d.faces[d.face];
    root.style.setProperty('--clock-font', FONT_FAMILIES[f.font] || FONT_FAMILIES.system);
    root.style.setProperty('--clock-weight', String(f.weight));
    var accent = d.accent === 'auto' ? (autoAccent || '#ffffff') : d.accent;
    setAccent(accent);
    root.style.setProperty('--clock-color', f.color === 'white' ? '#fff' : f.color === 'accent' ? accent : f.color);
    // Widgets: shown in the face's order; the date sits above the time on Big Clock.
    var order = f.widgets;
    ['date', 'weather', 'countdown', 'greeting'].forEach(function (w) {
      var el = $(w === 'date' ? 'date' : w === 'weather' ? 'weather' : 'wd-' + w);
      var i = order.indexOf(w);
      el.classList.toggle('hidden-wd', i < 0);
      if (w !== 'date' && w !== 'weather') el.classList.toggle('on', i >= 0);
      el.style.order = String(w === 'date' && d.face === 'bigclock' ? 0 : 20 + Math.max(0, i));
    });
    $('time').style.order = '10';
    root.classList.toggle('bg-gradient', d.background === 'gradient');
    root.style.setProperty('--bg-gradient', GRADIENTS[d.gradient] || GRADIENTS.midnight);
    if (prevBg !== d.background && backdrop) updatePhotos();
    cfg.video.captions = d.captions;
    if (!d.livePreview) hideLive();
    var aspect = d.face === 'tv' ? 1.6 : 1;
    var maxRow = d.face === 'tv' ? 1920 - 2 * 92 : 1920 - 2 * (92 + PADX);
    if (aspect !== ASPECT || maxRow !== MAX_ROW || prevFace !== d.face) {
      ASPECT = aspect;
      MAX_ROW = maxRow;
      DOCK_BOTTOM = d.face === 'tv' ? 118 : d.face === 'minimal' ? 110 : 150;
      TILE = 0;
      rebuildDock();
      lastShelfKey = null;
      updateShelf(items[focus]);
    }
    renderWidgets(new Date());
    GH.fitClock();
  }

  function setAccent(color) {
    var root = document.documentElement;
    root.style.setProperty('--accent', color);
    root.style.setProperty('--accent-glow', color.length === 7 ? color + '55' : 'rgba(255,255,255,0.22)');
  }

  // The most colourful part of the photo on screen, softened, for the accent.
  function sampleAccent() {
    if (!design || design.accent !== 'auto' || !backdrop || backdrop.front < 0) return;
    var img = backdrop.layers[backdrop.front].querySelector('img');
    if (!img || !img.naturalWidth) return;
    try {
      var c = document.createElement('canvas');
      c.width = 24; c.height = 14;
      var x = c.getContext('2d');
      x.drawImage(img, 0, 0, 24, 14);
      var d = x.getImageData(0, 0, 24, 14).data;
      var best = null;
      var bestScore = -1;
      for (var i = 0; i < d.length; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var sat = max ? (max - min) / max : 0;
        var score = sat * (max / 255) * (max > 60 ? 1 : 0.2);
        if (score > bestScore) { bestScore = score; best = [r, g, b]; }
      }
      if (!best || bestScore < 0.12) { autoAccent = '#ffffff'; }
      else {
        // Lift towards white so it reads as a light accent on dark glass.
        var hex = '#' + best.map(function (v) { var u = Math.round(v + (255 - v) * 0.35); return ('0' + u.toString(16)).slice(-2); }).join('');
        autoAccent = hex;
      }
      setAccent(autoAccent);
      if (design.faces[design.face].color === 'accent') document.documentElement.style.setProperty('--clock-color', autoAccent);
    } catch (e) { /* that photo can't be read here: keep the accent */ }
  }

  function renderWidgets(now) {
    if (!design) return;
    var h = now.getHours();
    $('wd-greeting').textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
    var cd = design.countdown;
    var el = $('wd-countdown');
    var text = '';
    if (cd && cd.date) {
      var p = cd.date.split('-');
      var target = new Date(+p[0], +p[1] - 1, +p[2]);
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var days = Math.round((target - today) / 86400000);
      var name = cd.label || 'Countdown';
      if (days > 1) text = name + '  ·  ' + days + ' days';
      else if (days === 1) text = name + '  ·  tomorrow';
      else if (days === 0) text = name + ' is today';
    }
    el.textContent = text;
    if (!text) el.classList.remove('on');
    else if (design.faces[design.face].widgets.indexOf('countdown') >= 0) el.classList.add('on');
  }

  // ---------- Top Shelf (Apple TV face) ----------
  var lastShelfKey = null;

  function shelfKind(it) {
    if (it.kind === 'app') return 'App';
    if (it.kind === 'input') return it.tv ? 'Live TV' : 'HDMI ' + it.hdmi;
    if (it.kind === 'youtube') return 'YouTube';
    if (it.kind === 'web') return hostOf(it.url) || 'Website';
    if (it.kind === 'guest') return 'Guests';
    return 'Add';
  }

  function updateShelf(it) {
    scheduleLive(it);
    if (!it || !design || design.face !== 'tv' || mode !== 'dock') return;
    if (it.key === lastShelfKey) return;
    lastShelfKey = it.key;
    var text = $('shelf-text');
    var media = $('shelf-media');
    text.classList.add('swap');
    media.classList.remove('on');
    setTimeout(function () {
      if (lastShelfKey !== it.key) return;
      $('shelf-kind').textContent = shelfKind(it);
      $('shelf-title').textContent = it.kind === 'add' ? 'Photos and shortcuts' : it.label;
      text.classList.remove('swap');
      media.textContent = '';
      var big = null;
      if (it.kind === 'youtube' && it.videoId) {
        big = new Image();
        big.className = 'big';
        big.src = 'https://i.ytimg.com/vi/' + it.videoId + '/maxresdefault.jpg';
      } else if (tileEls[it.key] && it.kind !== 'input') {
        big = tileEls[it.key].el.querySelector('.face').cloneNode(true);
      }
      if (big) { media.appendChild(big); media.classList.add('on'); }
    }, 180);
  }

  // ---------- live HDMI preview, Netflix style ----------
  // Resting on an HDMI tile grows it into a 16:9 card, and the input plays in
  // it. The TV draws the picture under the page, so the page cuts a hole there.
  var liveKey = null;
  var liveTimer = null;
  var liveStep = 0;                 // bumps on every open/close, so late callbacks can tell
  var liveOn = false;
  var liveTile = null;              // the tile's rect the card grew from
  var LIVE_W = 640;
  var LIVE_H = 360;
  var LIVE_DWELL_MS = 700;

  function stageRect(el) {
    var s = stage.getBoundingClientRect();
    var scale = s.width / 1920 || 1;
    var r = el.getBoundingClientRect();
    return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
  }

  function placeCard(r) {
    var card = $('live-card');
    card.style.left = Math.round(r.x) + 'px';
    card.style.top = Math.round(r.y) + 'px';
    card.style.width = Math.round(r.w) + 'px';
    card.style.height = Math.round(r.h) + 'px';
  }

  function scheduleLive(it) {
    var key = it && it.key;
    if (key && key === liveKey) return;           // same tile: leave it playing
    hideLive();
    if (!it || it.kind !== 'input' || it.tv || !design || !design.livePreview || mode !== 'dock') return;
    liveKey = key;
    var step = liveStep;
    liveTimer = setTimeout(function () { if (step === liveStep) openLive(it); }, LIVE_DWELL_MS);
  }

  function openLive(it) {
    var root = document.documentElement;
    if (liveKey !== it.key || mode !== 'dock' || document.hidden || root.classList.contains('ambient') || !tileEls[it.key]) return;
    var step = liveStep;
    var card = $('live-card');
    liveTile = stageRect(tileEls[it.key].el);
    var cx = liveTile.x + liveTile.w / 2;
    var target = {
      x: clamp(cx - LIVE_W / 2, 60, 1920 - 60 - LIVE_W),
      y: clamp(liveTile.y + liveTile.h + 16 - LIVE_H, 60, 1080 - 60 - LIVE_H),
      w: LIVE_W, h: LIVE_H
    };
    $('lc-title').textContent = it.label + '  ·  HDMI ' + it.hdmi;
    card.classList.add('instant');
    placeCard(liveTile);
    card.classList.add('on', 'loading');
    requestAnimationFrame(function () {
      card.classList.remove('instant');
      requestAnimationFrame(function () {
        if (step !== liveStep) return;
        placeCard(target);
        setTimeout(function () {
          if (step !== liveStep) return;
          P.showInputPreview(it.hdmi, [target.x, target.y, target.w, target.h]).then(function (how) {
            if (step !== liveStep) { P.hideInputPreview(); return; }
            liveOn = true;
            stage.style.setProperty('--hole-x', target.x + 'px');
            stage.style.setProperty('--hole-y', target.y + 'px');
            stage.style.setProperty('--hole-w', target.w + 'px');
            stage.style.setProperty('--hole-h', target.h + 'px');
            root.classList.toggle('live-fake', how === 'preview');
            root.classList.add('live-hole');
            card.classList.remove('loading');
          }, function () {
            if (step === liveStep) $('lc-wait').textContent = 'No picture from HDMI ' + it.hdmi;
          });
        }, 360);
      });
    });
    $('lc-wait').textContent = 'HDMI ' + it.hdmi;
  }

  function hideLive() {
    liveStep += 1;
    clearTimeout(liveTimer);
    liveTimer = null;
    liveKey = null;
    var root = document.documentElement;
    var card = $('live-card');
    root.classList.remove('live-hole');
    root.classList.remove('live-fake');
    if (liveOn) { liveOn = false; P.hideInputPreview(); }
    if (card.classList.contains('on')) {
      if (liveTile) placeCard(liveTile);
      card.classList.remove('on');
      card.classList.remove('loading');
    }
  }
  GH.hideLive = hideLive;

  // ---------- keep the clock clear of the tiles and the Top Shelf ----------
  var clockBase = 1;
  function fitClock() {
    if (mode === 'apps' || mode === 'apps-move') return;
    var clock = $('clock');
    var z = clockBase;
    clock.style.zoom = String(z);
    for (var pass = 0; pass < 2; pass++) {
      var c = stageRect(clock);
      var limit = stageRect(dock).y - 28;
      if (design && design.face === 'tv') limit = Math.min(limit, 196);   // above the Top Shelf artwork
      var bottom = c.y + c.h;
      if (bottom <= limit || c.h <= 0) break;
      z = Math.max(0.45, z * (limit - c.y) / (bottom - c.y));
      clock.style.zoom = String(z);
    }
  }
  GH.fitClock = function () { setTimeout(fitClock, 30); };
  // Advanced settings from the phone website.
  function applyAdvanced(a) {
    var root = document.documentElement;
    clockBase = { small: 0.75, medium: 1, large: 1.3 }[a.clockSize] || 1;
    ['glass-clear', 'glass-frosted'].forEach(function (c) { root.classList.remove(c); });
    if (a.glass !== 'normal') root.classList.add('glass-' + a.glass);
    root.classList.toggle('no-brand', !a.showBrand);
    root.classList.toggle('no-apps-hint', !a.appsHint);
    root.classList.toggle('no-photo-credit', !a.photoCredits);
    root.classList.toggle('no-video-credit', !a.videoCredits);
    cfg.longPressMs = a.holdMs;
    if (guestsSettings.tile !== guestTileOn) { guestTileOn = guestsSettings.tile; layoutChangedGuests = true; }
    backOnHome = a.backOnHome;
    hiddenMenuOn = a.hiddenMenu;
    var size = TILE_SIZES[a.tileSize] || TILE_SIZES.normal;
    var layoutChanged = size[0] !== TILE_MAX || a.addTile !== addTileOn || layoutChangedGuests;
    layoutChangedGuests = false;
    TILE_MAX = size[0];
    TILE_MIN = size[1];
    addTileOn = a.addTile;
    var style = $('user-css');
    if (!style) {
      style = document.createElement('style');
      style.id = 'user-css';
      document.head.appendChild(style);
    }
    if (style.textContent !== a.css) style.textContent = a.css;
    if (layoutChanged) { TILE = 0; rebuildDock(); }
    GH.fitClock();
  }

  function stillNow() {
    return Q.still === '1' || !wantDrift || document.documentElement.classList.contains('lite');
  }

  function applySettings(s) {
    if (!s) return;
    var sig = JSON.stringify(s);
    if (sig === settingsSig) return;
    settingsSig = sig;
    $('brand-name').textContent = s.name;
    document.title = s.name;
    setClockFormat(s.clock24);
    disabledPhotos = s.photos.disabled;
    wantDrift = s.photos.drift;
    if (backdrop) { backdrop.setTiming(s.photos.intervalSec * 1000, stillNow()); updatePhotos(); }
    cfg.video.stopAfterMin = s.screensaver.videoStopMin;
    cfg.video.quality = s.screensaver.quality;
    if (GH.setAmbient) GH.setAmbient({ afterMs: s.screensaver.afterMin * 60000, nightEnabled: s.night.enabled, nightFrom: s.night.from, nightTo: s.night.to });
    if (GH.Weather) GH.Weather.configure(s.weather);
    guestsSettings = s.guests || guestsSettings;
    if (s.advanced) applyAdvanced(s.advanced);
    if (s.design) applyDesign(s.design);
    if (s.home) {
      var extraChanged = adoptHome(s.home);
      if (extraChanged) resolveApps();
      else rebuildDock();
      if (mode !== 'apps-move') { allApps = orderAll(allApps); renderAllApps(); }
    }
  }

  // Tells the website what is installed and which tiles exist. Sent only on change.
  function reportCatalog() {
    if (!photoService || !allApps.length) return;
    var dock = defs.filter(function (d) { return apps[d.key]; }).map(function (d) {
      return { key: d.key, id: apps[d.key].id, label: d.label };
    });
    var catalog = { apps: allApps.map(function (a) { return { id: a.id, name: a.name }; }), dock: dock };
    var sig = JSON.stringify(catalog);
    if (sig === catalogSig) return;
    catalogSig = sig;
    D.saveCatalog(catalog).catch(function () { catalogSig = null; });
  }

  function addToDock(def, a) {
    if (def) {
      hidden = hidden.filter(function (k) { return k !== def.key; });
      ls.set('gh.hidden', hidden);
    } else {
      def = { key: 'x:' + a.id, label: a.name, ids: [a.id], names: [] };
      extraApps.push(def);
      ls.set('gh.extraApps', extraApps);
      defs.push(def);
      defByKey[def.key] = def;
      apps[def.key] = { id: a.id, name: a.name, iconPath: a.iconPath };
    }
    rebuildDock();
    saveHome();
    reportCatalog();
    toast(a.name + ' added to Home');
  }

  function removeFromDock(def, a) {
    if (def.key.indexOf('x:') === 0) {
      extraApps = extraApps.filter(function (d) { return d.key !== def.key; });
      ls.set('gh.extraApps', extraApps);
      defs = defs.filter(function (d) { return d.key !== def.key; });
      delete defByKey[def.key];
      delete apps[def.key];
    } else {
      if (hidden.indexOf(def.key) < 0) hidden.push(def.key);
      ls.set('gh.hidden', hidden);
    }
    rebuildDock();
    saveHome();
    toast(a.name + ' removed from Home');
  }

  function moveItem(it, dir) {
    var group = groupOf(it);
    var gi = group.indexOf(it);
    var gj = gi + dir;
    if (gj < 0 || gj >= group.length) return;
    if (it.kind === 'app') {
      var keys = group.map(function (x) { return x.appKey; });
      var t = keys[gi]; keys[gi] = keys[gj]; keys[gj] = t;
      var full = orderedAppKeys().filter(function (k) { return keys.indexOf(k) < 0; });
      appOrder = keys.concat(full);
      ls.set('gh.appOrder', appOrder);
      rebuildDock(it.key);
      saveHome();
      return;
    }
    if (it.kind === 'input') {
      var ins = group.map(function (x) { return x.key; });
      var u = ins[gi]; ins[gi] = ins[gj]; ins[gj] = u;
      inputOrder = ins;
      ls.set('gh.inputOrder', inputOrder);
      rebuildDock(it.key);
      saveHome();
      return;
    }
    var ids = shortcuts.map(function (s) { return s.id; });
    var a = ids.indexOf(it.scId);
    var b = a + dir;
    var before = shortcuts.slice();
    var tmp = shortcuts[a]; shortcuts[a] = shortcuts[b]; shortcuts[b] = tmp;
    rebuildDock(it.key);
    D.orderShortcuts(shortcuts.map(function (s) { return s.id; })).catch(function () {
      shortcuts = before;
      rebuildDock(it.key);
      toast('Couldn’t save the new order. Is the photo service running?');
    });
  }

  function hideApp(it) {
    if (hidden.indexOf(it.appKey) < 0) hidden.push(it.appKey);
    ls.set('gh.hidden', hidden);
    rebuildDock();
    saveHome();
    toast(it.label + ' hidden. Show it again from + on the dock.');
  }

  function removeShortcut(it) {
    D.removeShortcut(it.scId).then(function () {
      shortcuts = shortcuts.filter(function (s) { return s.id !== it.scId; });
      rebuildDock();
      toast(it.label + ' removed');
    }, function () { toast('Couldn’t remove it. Is the photo service running?'); });
  }

  // ---------- + panel ----------
  function storageText() {
    if (!storage || !storage.available) return '';
    return (storage.available / 1e9).toFixed(1) + ' GB free on the TV';
  }

  function renderPanel() {
    var st = D.cached();
    var lan = st && st.lan;
    var url = lan && lan.url;
    $('panel-url').textContent = url || (serviceUp === false ? 'Not running yet' : 'Starting…');
    var pw = D.passwordView();
    $('panel-pw').textContent = pw.text || '—';
    $('panel-pw-note').textContent = pw.note || '';
    var users = (st && st.photos ? st.photos.length : 0);
    var scs = shortcuts.length;
    var bits = [bundled.length + ' nature photos', users + (users === 1 ? ' of your photos' : ' of yours'), scs + (scs === 1 ? ' shortcut' : ' shortcuts')];
    var free = storageText();
    if (free) bits.push(free);
    $('panel-stats').textContent = bits.join('  ·  ');

    panelButtons = [];
    panelButtons.push({ id: 'newpw', label: confirmNewPw ? 'Press OK again to confirm' : 'New password', cls: confirmNewPw ? 'armed' : '' });
    if (hidden.length) panelButtons.push({ id: 'unhide', label: 'Show hidden apps (' + hidden.length + ')' });
    panelButtons.push({ id: 'close', label: 'Done' });
    panelButtons.push({ id: 'ytmode', label: 'YouTube links: ' + YT_MODE_NAMES[ytMode], small: true });
    panelFocus = clamp(panelFocus, 0, panelButtons.length - 1);
    panelRowFocus = clamp(panelRowFocus, 0, panelButtons.length - 2);

    var wrap = $('panel-buttons');
    wrap.textContent = '';
    var diag = $('panel-diag');
    diag.textContent = '';
    var svc = st && st.service;
    var line;
    if (serviceUp && svc) {
      line = 'Photo website running · ' + svc.node + ' (' + svc.engine + ') · port ' + svc.port +
        ' · data: ' + (svc.dataKind === 'app-data' ? 'app storage' : svc.dataKind) +
        (svc.pbkdf2 ? ' · sign-in check ' + svc.pbkdf2.ms + ' ms' : '');
    } else if (serviceUp === false) {
      line = 'Photo website not running' + (serviceError ? ' (' + serviceError + ')' : '') + ' · retrying';
    } else {
      line = 'Checking the photo website…';
    }
    panelButtons.forEach(function (b, i) {
      var e = div('pbtn' + (b.small ? ' small' : '') + (b.cls ? ' ' + b.cls : '') + (i === panelFocus ? ' focused' : ''), b.label);
      b.el = e;
      if (b.small) diag.appendChild(e);
      else wrap.appendChild(e);
    });
    diag.appendChild(div('diag-text', line));
  }

  function renderPanelFocus() {
    panelButtons.forEach(function (b, i) { if (b.el) b.el.classList.toggle('focused', i === panelFocus); });
  }

  // ---------- screen time ----------
  var openUsage = null;            // { id } of the app opened last, until GLOT is back
  function startUsage(it) {
    if (!photoService || ['app', 'input', 'web', 'youtube'].indexOf(it.kind) < 0) return;
    var id = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    openUsage = { id: id, hidden: false };
    D.logUsage({ id: id, key: it.key || ('app:' + it.id), label: it.label, kind: it.kind });
  }
  function endUsage() {
    if (!openUsage || !openUsage.hidden) return;
    D.logUsage({ id: openUsage.id, end: Date.now() });
    openUsage = null;
  }

  // ---------- Guests screen: Wi-Fi and photo-drop QR codes ----------
  var guestTimer = null;
  var guestShown = { wifi: null, drop: null };

  function updateGuests() {
    if (mode !== 'guests' || document.hidden) return;
    D.wifi().then(function (w) {
      if (mode !== 'guests') return;
      var has = !!(w && w.ssid);
      $('g-wifi').classList.toggle('off', !has);
      $('g-wifi-name').textContent = has ? w.ssid : 'Add your Wi-Fi on the website: Settings, Guest Wi-Fi';
      $('g-wifi-pw').textContent = has && w.password ? 'Password: ' + w.password : '';
      if (has && w.qr !== guestShown.wifi) { drawQrOn($('g-wifi-qr'), w.qr); guestShown.wifi = w.qr; }
    });
    D.drop().then(function (d) {
      if (mode !== 'guests' || !d || !d.url) return;
      var url = d.url.replace(/\/+$/, '') + '/drop#d=' + d.token;
      if (url !== guestShown.drop) { drawQrOn($('g-drop-qr'), url); guestShown.drop = url; }
      if (guestShown.added !== undefined && d.added > guestShown.added) toast((d.added - guestShown.added === 1 ? 'A photo was' : (d.added - guestShown.added) + ' photos were') + ' added');
      guestShown.added = d.added;
    });
  }

  function openGuests() {
    hideLive();
    mode = 'guests';
    guestShown = { wifi: null, drop: null, added: undefined };
    scrim.classList.add('open');
    $('guests').classList.add('open');
    dock.classList.add('away');
    label.classList.remove('on');
    updateGuests();
    clearInterval(guestTimer);
    guestTimer = setInterval(updateGuests, 4000);
  }

  function closeGuests() {
    clearInterval(guestTimer);
    guestTimer = null;
    D.dropWithdraw();
    scrim.classList.remove('open');
    $('guests').classList.remove('open');
    dock.classList.remove('away');
    label.classList.add('on');
    mode = 'dock';
    setTimeout(function () { lastShelfKey = null; updateShelf(items[focus]); }, 50);
  }

  // ---------- sign-in QR code on the + panel ----------
  var qrTimer = null;
  var qrShown = null;
  var qrUses = null;

  function drawQr(text) { drawQrOn($('qr-canvas'), text); }

  function drawQrOn(canvas, text) {
    var code = window.qrcode(0, 'M');
    code.addData(text);
    code.make();
    var n = code.getModuleCount();
    var quiet = 4;
    var cell = Math.floor(canvas.width / (n + quiet * 2));
    var start = Math.floor((canvas.width - n * cell) / 2);
    var x = canvas.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, canvas.width, canvas.height);
    x.fillStyle = '#000';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) if (code.isDark(r, c)) x.fillRect(start + c * cell, start + r * cell, cell, cell);
    }
  }

  function updateQr() {
    if (document.hidden || mode !== 'panel') return;
    D.qr().then(function (q) {
      if (mode !== 'panel') return;
      var box = $('panel-qr');
      if (!q || !q.url) { box.classList.remove('on'); qrShown = null; return; }
      if (qrUses !== null && q.uses > qrUses) toast('Signed in on your phone');
      qrUses = q.uses;
      if (q.token === qrShown) return;
      try {
        drawQr(q.url.replace(/\/+$/, '') + '/#qr=' + q.token);
        qrShown = q.token;
        box.classList.add('on');
      } catch (e) { box.classList.remove('on'); }
    });
  }

  function startQr() {
    clearInterval(qrTimer);
    qrShown = null;
    qrUses = null;
    if (!photoService) return;
    updateQr();
    qrTimer = setInterval(updateQr, 4000);
  }

  function stopQr() {
    clearInterval(qrTimer);
    qrTimer = null;
    qrShown = null;
    $('panel-qr').classList.remove('on');
    if (photoService) D.qrWithdraw();
  }

  function openPanel() {
    hideLive();
    mode = 'panel';
    startQr();
    confirmNewPw = 0;
    panelFocus = 0;
    renderPanel();
    scrim.classList.add('open');
    panel.classList.add('open');
    dock.classList.add('away');
    label.classList.remove('on');
    refresh().then(function () { if (mode === 'panel') renderPanel(); });
    P.storage().then(function (s) { storage = s; if (mode === 'panel') renderPanel(); });
  }

  function closePanel() {
    stopQr();
    setTimeout(function () { lastShelfKey = null; updateShelf(items[focus]); }, 50);
    scrim.classList.remove('open');
    panel.classList.remove('open');
    dock.classList.remove('away');
    label.classList.add('on');
    mode = 'dock';
    confirmNewPw = 0;
  }

  function panelAction(b) {
    if (!b) return;
    if (b.id === 'close') { closePanel(); return; }
    if (b.id === 'unhide') {
      hidden = [];
      ls.set('gh.hidden', hidden);
      rebuildDock();
      saveHome();
      panelFocus = 0;
      renderPanel();
      toast('All apps are back on the dock');
      return;
    }
    if (b.id === 'ytmode') {
      ytMode = YT_MODES[(YT_MODES.indexOf(ytMode) + 1) % YT_MODES.length];
      ls.set('gh.ytMode', ytMode);
      renderPanel();
      return;
    }
    if (b.id === 'newpw') {
      if (!confirmNewPw) {
        confirmNewPw = setTimeout(function () { confirmNewPw = 0; if (mode === 'panel') renderPanel(); }, 4000);
        renderPanel();
        return;
      }
      clearTimeout(confirmNewPw);
      confirmNewPw = 0;
      D.newPassword().then(function () {
        renderPanel();
        toast('New password made. Phones and computers need to sign in again.', 4500);
      }, function () {
        renderPanel();
        toast('Couldn’t change the password: the photo website isn’t running.', 4500);
      });
    }
  }

  // ---------- keys ----------
  function onKeyDown(e) {
    var k = e.keyCode;
    if (k === KEY.BACK || k === KEY.ESC || (k === KEY.BACKSPACE && cfg.preview)) {
      e.preventDefault();
      if (mode === 'menu') closeMenu();
      else if (mode === 'panel') closePanel();
      else if (mode === 'guests') closeGuests();
      else if (mode === 'apps-move') finishMove(false);
      else if (mode === 'apps') closeAllApps();
      else if (!e.repeat && GH.enterAmbient && backOnHome === 'aerials') GH.enterAmbient();   // Home: straight to the aerials
      return;
    }
    if ([KEY.LEFT, KEY.RIGHT, KEY.UP, KEY.DOWN, KEY.ENTER].indexOf(k) < 0) return;
    e.preventDefault();
    if (mode === 'menu') {
      if (k === KEY.ENTER) {
        if (waitEnterRelease || e.repeat) return;   // OK still held from the long press
        var m = menuItems[menuFocus];
        closeMenu();
        if (m && !m.disabled) m.run();
        return;
      }
      if (k === KEY.UP || k === KEY.DOWN) {
        var d = k === KEY.UP ? -1 : 1;
        var j = menuFocus + d;
        while (j >= 0 && j < menuItems.length && menuItems[j].disabled) j += d;
        if (j >= 0 && j < menuItems.length) { menuFocus = j; renderMenuFocus(); }
      }
      return;
    }
    if (mode === 'guests') { if (k === KEY.ENTER && !e.repeat) closeGuests(); return; }
    if (mode === 'panel') {
      if (k === KEY.ENTER) { if (!e.repeat) panelAction(panelButtons[panelFocus]); return; }
      // Buttons sit in one row; the small YouTube switch is alone below it.
      var small = panelButtons.length - 1;
      if (panelFocus === small) {
        if (k === KEY.UP) panelFocus = panelRowFocus;
      } else if (k === KEY.DOWN) {
        panelRowFocus = panelFocus;
        panelFocus = small;
      } else if (k === KEY.LEFT) {
        panelFocus = Math.max(0, panelFocus - 1);
      } else if (k === KEY.RIGHT) {
        panelFocus = Math.min(small - 1, panelFocus + 1);
      }
      renderPanelFocus();
      return;
    }
    if (mode === 'apps-move') {
      if (k === KEY.ENTER) { if (!e.repeat) finishMove(true); }
      else if (k === KEY.LEFT) moveTileTo(allFocus - 1);
      else if (k === KEY.RIGHT) moveTileTo(allFocus + 1);
      else if (k === KEY.UP) { if (allFocus >= AA_COLS) moveTileTo(allFocus - AA_COLS); }
      else if (k === KEY.DOWN) {
        if (Math.floor(allFocus / AA_COLS) < Math.floor((allEls.length - 1) / AA_COLS)) moveTileTo(allFocus + AA_COLS);
      }
      return;
    }
    if (mode === 'apps' && k !== KEY.ENTER) {
      if (k === KEY.LEFT) { if (allFocus % AA_COLS > 0) setAllFocus(allFocus - 1); }
      else if (k === KEY.RIGHT) { if (allFocus % AA_COLS < AA_COLS - 1) setAllFocus(allFocus + 1); }
      else if (k === KEY.UP) {
        if (allFocus < AA_COLS) closeAllApps();
        else setAllFocus(allFocus - AA_COLS);
      } else if (k === KEY.DOWN) {
        // Only move if there is a row below; a short last row catches focus at its end.
        var lastRow = Math.floor((allEls.length - 1) / AA_COLS);
        if (Math.floor(allFocus / AA_COLS) < lastRow) setAllFocus(allFocus + AA_COLS);
      }
      return;
    }
    if (k === KEY.UP) { if (!e.repeat) noteUpPress(); return; }
    if (k === KEY.LEFT) setFocus(focus - 1);
    else if (k === KEY.RIGHT) setFocus(focus + 1);
    else if (k === KEY.DOWN) { if (!e.repeat) openAllApps(); }
    else if (k === KEY.ENTER) {
      if (enterDown) return;                    // auto-repeat while held
      enterDown = true;
      longFired = false;
      clearTimeout(longTimer);
      longTimer = setTimeout(function () {
        longTimer = null;
        if (!enterDown || (mode !== 'dock' && mode !== 'apps')) return;
        longFired = true;
        waitEnterRelease = true;
        if (mode === 'apps') openAllAppsMenu();
        else openMenu();
        // Normally the key-up clears this; the timer only covers a lost key-up.
        clearTimeout(releaseTimer);
        releaseTimer = setTimeout(function () { waitEnterRelease = false; }, 2500);
      }, cfg.longPressMs);
    }
  }

  function onKeyUp(e) {
    if (e.keyCode !== KEY.ENTER) return;
    waitEnterRelease = false;
    clearTimeout(releaseTimer);
    if (!enterDown) return;
    enterDown = false;
    if (longTimer) {
      clearTimeout(longTimer);
      longTimer = null;
      if (!longFired && mode === 'dock') activate(items[focus]);
      else if (!longFired && mode === 'apps' && allEls[allFocus]) {
        var chosen = allEls[allFocus].app;
        activate({ kind: 'app', id: chosen.id, label: chosen.name });
      }
    }
    longFired = false;
  }

  // ---------- photos ----------
  function shortLicence(l) {
    var s = String(l || '');
    if (/^CC0/i.test(s) || /public domain dedication/i.test(s)) return 'CC0';
    var m = /(CC BY(?:-[A-Z]{2})*\s*\d\.\d)/i.exec(s);
    if (m) return m[1].toUpperCase();
    if (/public domain/i.test(s)) return 'Public domain';
    return s;
  }

  function loadManifest() {
    function parse(r, base) {
      var list = r.data;
      if (list && !Array.isArray(list)) list = list.photos || list.items || list.wallpapers || null;
      if (!Array.isArray(list)) return null;
      return list.map(function (w) {
        var file = w.file || w.src || w.path;
        if (!file) return null;
        return {
          key: 'w:' + file,
          url: base + file,
          credit: [w.title, w.author, w.licence_short || shortLicence(w.licence || w.license)].filter(Boolean).join(' · '),
          user: false
        };
      }).filter(Boolean);
    }
    return GH.request('GET', 'wallpapers/manifest.json', undefined, 4000).then(function (r) {
      var list = parse(r, 'wallpapers/');
      if (list && list.length) return list;
      return GH.request('GET', '/preview-assets/manifest.json', undefined, 3000).then(function (r2) {
        return parse(r2, '/preview-assets/') || [];
      });
    }).then(function (list) { bundled = list; });
  }

  // Photos uploaded since the TV last looked are shown next ("fresh"); the
  // first sync after install only records what exists.
  function updatePhotos() {
    var st = photoService ? D.cached() : null;
    var list = st && st.photos ? st.photos : [];
    var known = ls.get('gh.bg.known');
    var knownSet = {};
    (known || []).forEach(function (id) { knownSet[id] = true; });
    var user = list.map(function (p) {
      return { key: 'u:' + p.id, url: D.media(p.url), credit: '', user: true, fresh: !!known && !knownSet[p.id] };
    });
    if (st && st.photos) ls.set('gh.bg.known', list.map(function (p) { return p.id; }));
    var defaults = bundled.filter(function (w) { return disabledPhotos.indexOf(w.key.slice(2)) < 0; });
    backdrop.setPhotos(design && design.background === 'gradient' ? [] : defaults.concat(user));
  }

  var creditTimer = null;
  function showCredit(it) {
    var c = $('credit');
    c.classList.remove('on');
    clearTimeout(creditTimer);
    creditTimer = setTimeout(function () {
      c.textContent = it.credit || '';
      if (it.credit) c.classList.add('on');
    }, 500);
    setTimeout(sampleAccent, 400);
  }

  // ---------- service ----------
  function refresh() {
    if (!photoService) return Promise.resolve({ online: false });
    return D.refresh().then(function (r) {
      serviceUp = r.online;
      if (r.changed) {
        shortcuts = (r.state && r.state.shortcuts) || [];
        applySettings(r.state && r.state.settings);
        rebuildDock();
        if (backdrop) updatePhotos();
        // A new service has no layout yet: it starts from what is on screen.
        if (r.state && r.state.settings && !r.state.settings.home) saveHome();
      }
      if (r.online) reportCatalog();
      if (mode === 'panel') renderPanel();
      return r;
    });
  }

  function waitHealthy(tries) {
    return D.health(2000).then(function (ok) {
      if (ok || tries <= 1) return ok;
      return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(function () { return waitHealthy(tries - 1); });
    });
  }

  // Makes sure the photo service runs (it does not survive a reboot under a
  // public certificate, and the platform may reclaim it), then syncs.
  function ensureService() {
    if (ensuring || !photoService) return;
    ensuring = true;
    clearTimeout(retryTimer);
    D.info().then(function (info) {
      var ok = !!info;
      // After an update the old service keeps running: ask it to restart, once.
      if (info && info.version !== cfg.serviceVersion && !serviceRestartTried) {
        serviceRestartTried = true;
        D.restartService().then(function (done) { if (done) setTimeout(ensureService, 2500); });
      }
      if (ok || !P.isTV) return ok;
      return P.startService().then(function () { serviceError = null; }, function (e) {
        serviceError = (e && (e.message || e.name)) || 'launch failed';
      }).then(function () { return waitHealthy(40); });
    }).then(function (ok) {
      ensuring = false;
      serviceUp = !!ok;
      if (ok) { reportBootOnce(); return refresh(); }
      if (mode === 'panel') renderPanel();
      if (!document.hidden) retryTimer = setTimeout(ensureService, 30000);
    });
  }

  // When the screen first appeared, in seconds since power-on (see Startup times).
  var bootReported = false;
  function reportBootOnce() {
    if (bootReported) return;
    D.reportBoot(!document.hidden);
    if (!document.hidden) bootReported = true;
  }

  function resolveApps() {
    return P.resolveApps(defs).then(function (found) {
      apps = found;
      if (found.youtube) P.setYouTubeId(found.youtube.id);
      ls.set('gh.apps.v1', { at: Date.now(), apps: found });
      rebuildDock();
      reportCatalog();
    });
  }

  // ---------- multitasking ----------
  function onVisibility() {
    if (document.hidden) {
      hideLive();
      if (openUsage) openUsage.hidden = true;
      document.documentElement.classList.add('paused');
      clearInterval(clockTimer);
      clearInterval(pollTimer);
      clearTimeout(retryTimer);
      clearTimeout(longTimer);
      enterDown = false;
      $('toast').classList.remove('on');
      if (backdrop) backdrop.pause();
      return;
    }
    document.documentElement.classList.remove('paused');
    endUsage();
    setLaunching(false);
    renderClock();
    clearInterval(clockTimer);
    clearInterval(pollTimer);
    clockTimer = setInterval(renderClock, cfg.clockEveryMs);
    pollTimer = setInterval(refresh, cfg.pollEveryMs);
    if (backdrop) backdrop.resume();
    ensureService();
    resolveApps();
    frameProbe(2500);
  }

  // ---------- performance guard ----------
  // If the TV can't keep things smooth (a heavy app still holding memory, say),
  // drop the glass blur and the drift until it can. Checked at start and every
  // time this screen comes back, so it recovers by itself.
  function setLite(on) {
    document.documentElement.classList.toggle('lite', on);
    if (backdrop) backdrop.setTiming(backdrop.opts.interval, stillNow());
  }

  var probing = false;
  var liteUntil = 0;
  function frameProbe(delay) {
    if (Q.lite === '1') { setLite(true); return; }
    if (!window.requestAnimationFrame || Q.still === '1' || cfg.preview || probing) return;
    probing = true;
    var times = [];
    var last = 0;
    var end = 0;
    function tick(t) {
      if (last) times.push(t - last);
      last = t;
      if (Date.now() < end && !document.hidden) { requestAnimationFrame(tick); return; }
      probing = false;
      if (times.length < 20) return;
      times.sort(function (a, b) { return a - b; });
      var median = times[Math.floor(times.length / 2)];
      // Once lite, stay lite for a while: switching the glass on and off is the flicker.
      if (median > 26) { setLite(true); liteUntil = Date.now() + 20 * 60 * 1000; }
      else if (median < 18 && Date.now() > liteUntil) setLite(false);
    }
    setTimeout(function () {
      if (document.hidden) { probing = false; return; }
      end = Date.now() + 3000;
      requestAnimationFrame(tick);
    }, delay);
  }

  // ---------- start ----------
  function loadMock() {
    if (!cfg.preview) return Promise.resolve();
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = '/dev/mock.js';
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
      setTimeout(resolve, 2000);
    });
  }

  function init() {
    if (Q.still === '1') document.documentElement.classList.add('still');
    fitStage();
    window.addEventListener('resize', fitStage);
    renderClock();
    clockTimer = setInterval(renderClock, cfg.clockEveryMs);

    var cachedApps = ls.get('gh.apps.v1');
    if (cachedApps && cachedApps.apps) apps = cachedApps.apps;
    var st = photoService ? D.cached() : null;
    shortcuts = (st && st.shortcuts) || [];
    focusKey = ls.get('gh.focus');
    if (st && st.settings && st.settings.home) adoptHome(st.settings.home);
    rebuildDock();

    backdrop = new GH.Backdrop($('bg-a'), $('bg-b'), {
      interval: cfg.photoIntervalMs, fade: cfg.fadeMs, scale: cfg.kenBurnsScale,
      still: Q.still === '1', onShow: showCredit
    });
    if (st && st.settings) applySettings(st.settings);
    loadManifest().then(function () {
      updatePhotos();
      var first = Q.bg ? (/^\d+$/.test(Q.bg) && bundled[+Q.bg] ? bundled[+Q.bg].key : 'w:' + Q.bg) : null;
      backdrop.start(first);
    });

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('visibilitychange', onVisibility);

    loadMock().then(resolveApps).then(function () {
      loadAllApps();
      if (Q.focus && /^\d+$/.test(Q.focus)) setFocus(+Q.focus);
      ensureService();
      if (Q.panel === '1' && photoService) setTimeout(openPanel, 300);
      if (Q.menu === '1') setTimeout(openMenu, 300);
    });
    pollTimer = setInterval(refresh, cfg.pollEveryMs);
    frameProbe(4000);
  }

  init();
}());
