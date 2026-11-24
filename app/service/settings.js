// Settings edited on the phone website and read by the TV.  Node 12 API only.
//
// merge(current, patch) returns complete settings. Only known fields are taken
// from the patch and every value is checked, so what reaches the TV is always
// well formed whichever caller sent it. home stays null until the TV has
// reported its own starting layout.
'use strict';

var APP_ID = /^[A-Za-z0-9._-]{1,100}$/;
var KEY = /^[A-Za-z0-9.:_-]{1,110}$/;
var FILE = /^[A-Za-z0-9._-]+\.jpe?g$/i;
var TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
var BRANDS = ['appletv', 'bein', 'denon'];
var FACES = ['tv', 'glass', 'minimal', 'bigclock'];
var FONTS = ['system', 'inter', 'rounded', 'serif', 'condensed', 'mono'];
var WIDGETS = ['date', 'weather', 'countdown', 'greeting'];
var GRADIENTS = ['midnight', 'dusk', 'ocean', 'forest', 'graphite', 'sunrise'];
var COLOR = /^#[0-9a-f]{6}$/i;
var DAY = /^\d{4}-\d{2}-\d{2}$/;

// Each face keeps its own clock and widgets, like Lock Screens on iPhone.
function faceDefaults(face) {
  return {
    tv: { font: 'inter', weight: 500, color: 'white', widgets: ['date', 'weather'] },
    glass: { font: 'system', weight: 600, color: 'white', widgets: ['date', 'weather'] },
    minimal: { font: 'inter', weight: 300, color: 'white', widgets: ['date'] },
    bigclock: { font: 'rounded', weight: 700, color: 'white', widgets: ['weather', 'greeting'] }
  }[face];
}

function defaults() {
  return {
    name: 'GLOT',
    clock24: false,
    photos: { intervalSec: 45, drift: true, disabled: [] },
    screensaver: { afterMin: 3, videoStopMin: 60, quality: '1080', player: 'tv' },
    night: { enabled: true, from: '20:00', to: '06:00', followSun: true },
    weather: { enabled: true, place: '', latitude: null, longitude: null, unit: 'celsius', week: true },
    guests: { tile: false, showPassword: false },
    advanced: {
      clockSize: 'medium', showBrand: true, glass: 'normal', tileSize: 'normal', appsHint: true,
      photoCredits: true, videoCredits: true, holdMs: 700, backOnHome: 'aerials', hiddenMenu: true,
      addTile: true, pixelShift: true, fpsMeter: false, css: ''
    },
    design: {
      face: 'tv', accent: 'auto', background: 'photos', gradient: 'midnight', captions: 'en', livePreview: true,
      countdown: { label: '', date: '' },
      faces: { tv: faceDefaults('tv'), glass: faceDefaults('glass'), minimal: faceDefaults('minimal'), bigclock: faceDefaults('bigclock') }
    },
    home: null
  };
}

function cleanFace(face, cur, patch) {
  var d = faceDefaults(face);
  var c = Object.assign({}, isObject(cur) ? cur : {}, isObject(patch) ? patch : {});
  var out = {
    font: FONTS.indexOf(c.font) >= 0 ? c.font : d.font,
    weight: integer(c.weight, 100, 900, d.weight),
    color: c.color === 'white' || c.color === 'accent' || COLOR.test(c.color) ? c.color : d.color,
    widgets: d.widgets
  };
  if (Array.isArray(c.widgets)) out.widgets = c.widgets.filter(function (w, i) { return WIDGETS.indexOf(w) >= 0 && c.widgets.indexOf(w) === i; }).slice(0, 3);
  return out;
}

function cleanDesign(cur, patch) {
  var s = defaults().design;
  cur = isObject(cur) ? cur : {};
  patch = isObject(patch) ? patch : {};
  function pickKey(k) { return patch[k] !== undefined ? patch[k] : cur[k]; }
  var face = pickKey('face');
  s.face = FACES.indexOf(face) >= 0 ? face : s.face;
  var accent = pickKey('accent');
  s.accent = accent === 'auto' || COLOR.test(accent) ? accent : s.accent;
  s.background = pickKey('background') === 'gradient' ? 'gradient' : 'photos';
  var g = pickKey('gradient');
  s.gradient = GRADIENTS.indexOf(g) >= 0 ? g : s.gradient;
  var cap = pickKey('captions');
  s.captions = ['en', 'ar', 'off'].indexOf(cap) >= 0 ? cap : s.captions;
  s.livePreview = pickKey('livePreview') !== false;
  var cd = Object.assign({}, isObject(cur.countdown) ? cur.countdown : {}, isObject(patch.countdown) ? patch.countdown : {});
  s.countdown = { label: text(cd.label, 30), date: DAY.test(cd.date) ? cd.date : '' };
  var curFaces = isObject(cur.faces) ? cur.faces : {};
  var patchFaces = isObject(patch.faces) ? patch.faces : {};
  FACES.forEach(function (f) { s.faces[f] = cleanFace(f, curFaces[f], patchFaces[f]); });
  return s;
}

function text(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function integer(v, lo, hi, fallback) {
  var n = Math.round(Number(v));
  return isFinite(n) && typeof v !== 'boolean' && v !== null && v !== '' ? Math.max(lo, Math.min(hi, n)) : fallback;
}
function coordinate(v, limit) {
  var n = typeof v === 'number' ? v : NaN;
  return isFinite(n) && Math.abs(n) <= limit ? n : null;
}
function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function strings(v, re, max) {
  if (!Array.isArray(v)) return [];
  var seen = {};
  return v.filter(function (x) {
    if (typeof x !== 'string' || !re.test(x) || seen[x]) return false;
    seen[x] = true;
    return true;
  }).slice(0, max);
}

function cleanInputs(list) {
  if (!Array.isArray(list)) return [];
  var seen = {};
  var out = [];
  list.forEach(function (x) {
    if (!isObject(x)) return;
    var tv = x.tv === true;
    var port = tv ? 'tv' : Number(x.hdmi);
    if (!tv && [1, 2, 3, 4].indexOf(port) < 0) return;
    if (seen[port]) return;
    seen[port] = true;
    var item = { label: text(x.label, 30) || (tv ? 'Live TV' : 'HDMI ' + port) };
    if (tv) item.tv = true; else item.hdmi = port;
    if (BRANDS.indexOf(x.brand) >= 0) item.brand = x.brand;
    out.push(item);
  });
  return out;
}

function cleanExtra(list) {
  if (!Array.isArray(list)) return [];
  var seen = {};
  var out = [];
  list.forEach(function (x) {
    var id = isObject(x) && Array.isArray(x.ids) ? x.ids[0] : null;
    if (typeof id !== 'string' || !APP_ID.test(id) || seen[id]) return;
    seen[id] = true;
    out.push({ key: 'x:' + id, label: text(x.label, 60) || id, ids: [id], names: [] });
  });
  return out.slice(0, 60);
}

function cleanHome(h) {
  return {
    order: strings(h.order, KEY, 120),
    hidden: strings(h.hidden, KEY, 120),
    extra: cleanExtra(h.extra),
    inputs: cleanInputs(h.inputs),
    inputOrder: strings(h.inputOrder, KEY, 20),
    allOrder: strings(h.allOrder, APP_ID, 400)
  };
}

function merge(current, patch) {
  var s = defaults();
  var cur = isObject(current) ? current : {};
  var p = isObject(patch) ? patch : {};
  function pick(section) {
    return Object.assign({}, isObject(cur[section]) ? cur[section] : {}, isObject(p[section]) ? p[section] : {});
  }
  var name = text(p.name !== undefined ? p.name : cur.name, 40);
  if (name) s.name = name;
  var clock = p.clock24 !== undefined ? p.clock24 : cur.clock24;
  s.clock24 = clock === true;

  var photos = pick('photos');
  s.photos.intervalSec = integer(photos.intervalSec, 5, 3600, s.photos.intervalSec);
  s.photos.drift = photos.drift !== false;
  s.photos.disabled = strings(photos.disabled, FILE, 300);

  var saver = pick('screensaver');
  s.screensaver.afterMin = integer(saver.afterMin, 0, 240, s.screensaver.afterMin);
  s.screensaver.videoStopMin = integer(saver.videoStopMin, 0, 600, s.screensaver.videoStopMin);
  [isObject(cur.screensaver) ? cur.screensaver.quality : null, saver.quality].forEach(function (q) {
    // '4khdr' was an option in 1.6.0. Those files are Dolby Vision profile 5,
    // which Samsung TVs show purple and green, so it now means plain 4K.
    if (q === '4khdr') q = '4k';
    if (['1080', '4k'].indexOf(q) >= 0) s.screensaver.quality = q;
  });
  // 'tv': the TV's own player (sharpest); 'web': page video with crossfades.
  s.screensaver.player = saver.player === 'web' ? 'web' : 'tv';

  var night = pick('night');
  s.night.enabled = night.enabled !== false;
  if (TIME.test(night.from)) s.night.from = night.from;
  if (TIME.test(night.to)) s.night.to = night.to;
  s.night.followSun = night.followSun !== false;

  var wx = pick('weather');
  s.weather.enabled = wx.enabled !== false;
  s.weather.place = text(wx.place, 60);
  s.weather.latitude = coordinate(wx.latitude, 90);
  s.weather.longitude = coordinate(wx.longitude, 180);
  if (s.weather.latitude === null || s.weather.longitude === null) { s.weather.latitude = null; s.weather.longitude = null; }
  s.weather.unit = wx.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  s.weather.week = wx.week !== false;

  var guests = pick('guests');
  s.guests.tile = guests.tile === true;
  s.guests.showPassword = guests.showPassword === true;

  var adv = pick('advanced');
  function oneOf(v, list, fallback) { return list.indexOf(v) >= 0 ? v : fallback; }
  var a = s.advanced;
  a.clockSize = oneOf(adv.clockSize, ['small', 'medium', 'large'], a.clockSize);
  a.showBrand = adv.showBrand !== false;
  a.glass = oneOf(adv.glass, ['clear', 'normal', 'frosted'], a.glass);
  a.tileSize = oneOf(adv.tileSize, ['small', 'normal', 'large'], a.tileSize);
  a.appsHint = adv.appsHint !== false;
  a.photoCredits = adv.photoCredits !== false;
  a.videoCredits = adv.videoCredits !== false;
  a.holdMs = integer(adv.holdMs, 400, 1500, a.holdMs);
  a.backOnHome = oneOf(adv.backOnHome, ['aerials', 'nothing'], a.backOnHome);
  a.hiddenMenu = adv.hiddenMenu !== false;
  a.addTile = adv.addTile !== false;
  a.pixelShift = adv.pixelShift !== false;
  a.fpsMeter = adv.fpsMeter === true;
  // Custom CSS for the TV screen only; it can't run code. Size-limited.
  a.css = typeof adv.css === 'string' ? adv.css.replace(/\u0000/g, '').slice(0, 20000) : '';

  s.design = cleanDesign(cur.design, p.design);

  var home = isObject(p.home) ? p.home : (isObject(cur.home) ? cur.home : null);
  s.home = home ? cleanHome(home) : null;
  return s;
}

// What the TV reports so the website can name things: installed apps, and the
// tiles the Home row can show.
function cleanCatalog(c) {
  c = isObject(c) ? c : {};
  function rows(list, max) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (a) { return isObject(a) && typeof a.id === 'string' && APP_ID.test(a.id); }).slice(0, max);
  }
  return {
    apps: rows(c.apps, 400).map(function (a) { return { id: a.id, name: text(a.name, 60) || a.id }; }),
    dock: rows(c.dock, 120).filter(function (a) { return typeof a.key === 'string' && KEY.test(a.key); })
      .map(function (a) { return { key: a.key, id: a.id, label: text(a.label, 60) || a.id }; })
  };
}

module.exports = { defaults: defaults, merge: merge, cleanCatalog: cleanCatalog };
