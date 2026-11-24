#!/usr/bin/env node
// GLOT - UI test and screenshots (Node 22, headless Chrome / Brave / Edge).
//
// Starts its own dev runner with demo content on 127.0.0.1, drives the TV app
// with remote-style key presses (including a held OK) and the phone website
// with taps, checks what happens, and writes screenshots to ../preview/.
//
// The dock it expects is app/js/config.js as shipped: four apps (Nuvio,
// Stremio, YouTube, Spotify), three HDMI inputs (Apple TV, beIN Sports,
// Denon), then the demo shortcuts and +.
//
//   node dev/ui-test.js            checks + screenshots
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'preview');
const PORT = 18290;
const UI = 18291;
const K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 27 };
const PW = /^[a-z]+-[a-z]+-[a-z]+-\d\d$/;

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  (' + JSON.stringify(detail) + ')' : '')); }
}

// Console errors that are expected: the favicon, and js/aerials.js, which is
// made locally by scripts/fetch-aerials.ps1 and is not in the repository.
function realErrors(page, extra) {
  return page.errors.filter((e) => !/favicon\.ico/.test(e) && !/status of 404[^]*\/js\/aerials\.js/.test(e) && !(extra && extra.test(e)));
}

function startRunner() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'run.js'), '--demo', '--quiet', '--port', String(PORT), '--ui-port', String(UI)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const t = setTimeout(() => reject(new Error('runner did not start')), 60000);
    child.on('message', (m) => { if (m && m.ready) { clearTimeout(t); resolve(child); } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error('runner exited ' + c)); });
  });
}

async function waitFor(page, expr, ms) {
  const until = Date.now() + ms;
  let v;
  do {
    v = await page.eval(expr);
    if (v) return v;
    await sleep(250);
  } while (Date.now() < until);
  return v;
}

async function tvState(p) {
  return p.eval(`(() => {
    const tiles = [...document.querySelectorAll('#dock-row .tile')];
    const f = document.querySelector('#dock-row .tile.focused');
    const html = document.documentElement.classList;
    return {
      count: tiles.length,
      focus: tiles.indexOf(f),
      label: document.getElementById('label').textContent,
      menuOpen: document.getElementById('menu').classList.contains('open'),
      menuTitle: (document.querySelector('#menu .menu-title') || {}).textContent || '',
      menuItems: [...document.querySelectorAll('#menu .menu-item')].map(e => e.textContent + (e.classList.contains('focused') ? '*' : '') + (e.classList.contains('disabled') ? '(x)' : '')),
      panelOpen: document.getElementById('panel').classList.contains('open'),
      appsOpen: document.getElementById('allapps').classList.contains('open'),
      ambient: html.contains('ambient'),
      toast: document.getElementById('toast').classList.contains('on') ? document.getElementById('toast').textContent : '',
      shelf: document.getElementById('shelf-kind').textContent + ' / ' + document.getElementById('shelf-title').textContent
    };
  })()`);
}

const kinds = (p) => p.eval(`[...document.querySelectorAll('#dock-row .tile')].map((t) => t.className.replace('tile tile-', '').split(' ')[0])`);
const localState = (p) => p.eval(`fetch('http://127.0.0.1:${PORT}/local/state?k=' + encodeURIComponent(window.GH_LOCAL_KEY)).then(r => r.json())`);

// Test images for the upload check, made in the browser so no image tool is
// needed: a portrait JPEG (a 720x1080 crop) and a PNG at most 1600 px wide.
async function makeTestImages(browser, dir) {
  const p = await browser.newPage({ width: 800, height: 600 });
  await p.goto('http://127.0.0.1:' + UI + '/index.html?preview=1&still=1&photoService=0', 500);
  const out = await p.eval(`(async () => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const a = await load('/wallpapers/nature-02.jpg');
    const c1 = document.createElement('canvas');
    c1.width = 720; c1.height = 1080;
    const sx = Math.max(0, (a.naturalWidth - 720) / 2);
    c1.getContext('2d').drawImage(a, sx, 0, 720, Math.min(1080, a.naturalHeight), 0, 0, 720, 1080);
    const b = await load('/wallpapers/nature-03.jpg');
    const s = Math.min(1, 1600 / Math.max(b.naturalWidth, b.naturalHeight));
    const c2 = document.createElement('canvas');
    c2.width = Math.round(b.naturalWidth * s); c2.height = Math.round(b.naturalHeight * s);
    c2.getContext('2d').drawImage(b, 0, 0, c2.width, c2.height);
    return { jpg: c1.toDataURL('image/jpeg', 0.9), png: c2.toDataURL('image/png') };
  })()`);
  await p.close();
  const portrait = path.join(dir, 'ui-portrait.jpg');
  const png = path.join(dir, 'ui-landscape.png');
  fs.writeFileSync(portrait, Buffer.from(out.jpg.split(',')[1], 'base64'));
  fs.writeFileSync(png, Buffer.from(out.png.split(',')[1], 'base64'));
  return [portrait, png];
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const runner = await startRunner();
  const browser = await launch();
  try {
    // ---------------- TV app ----------------
    console.log('TV app');
    const tv = await browser.newPage({ width: 1920, height: 1080 });
    // video=0: the screensaver shows the photos, not Apple's aerials (network).
    const base = 'http://127.0.0.1:' + UI + '/index.html?preview=1&video=0&api=' + encodeURIComponent('http://127.0.0.1:' + PORT);
    await tv.goto(base + '&bg=nature-06.jpg', 4500);
    let s = await tvState(tv);
    check('dock has 4 apps + 3 HDMI inputs + 3 shortcuts + "+"', s.count === 11, s.count);
    check('first tile (Nuvio) focused at start', s.focus === 0 && s.label === 'Nuvio', s);
    const order = await kinds(tv);
    check('apps first, then inputs, then shortcuts, then +', JSON.stringify(order) === JSON.stringify(['app', 'app', 'app', 'app', 'input', 'input', 'input', 'web', 'web', 'youtube', 'add']), order);
    check('the Apple TV face is the default', await tv.eval(`document.documentElement.classList.contains('face-tv') && getComputedStyle(document.getElementById('shelf')).display !== 'none'`));
    check('Apple TV face: wide tiles', (await tv.eval(`document.getElementById('dock').style.getPropertyValue('--aspect')`)) === '1.6');
    check('Top Shelf shows the focused app', s.shelf === 'App / Nuvio', s.shelf);
    await tv.shot(path.join(OUT, 'tv-home.png'));

    await tv.key(K.LEFT);
    s = await tvState(tv);
    check('Left at the first tile does not wrap', s.focus === 0, s.focus);
    for (let i = 0; i < 7; i++) await tv.key(K.RIGHT);
    await sleep(400);
    s = await tvState(tv);
    check('Right x7 focuses the first shortcut (Wikipedia)', s.focus === 7 && s.label === 'Wikipedia', s);
    check('Top Shelf follows focus (site and name)', s.shelf === 'en.wikipedia.org / Wikipedia', s.shelf);
    await tv.shot(path.join(OUT, 'tv-focus.png'));

    await tv.key(K.ENTER, { hold: 900 });
    s = await tvState(tv);
    check('holding OK for 0.9 s opens the menu', s.menuOpen, s);
    check('menu: Move left disabled, Move right focused, Remove, Cancel', JSON.stringify(s.menuItems) === JSON.stringify(['Move left(x)', 'Move right*', 'Remove', 'Cancel']), s.menuItems);
    await sleep(300);
    await tv.shot(path.join(OUT, 'tv-menu.png'));
    await tv.key(K.BACK);
    s = await tvState(tv);
    check('Back closes the menu', !s.menuOpen && !s.ambient, s);

    // Move right through the menu, then check the service saved the order.
    await tv.key(K.ENTER, { hold: 900 });
    await tv.key(K.ENTER);                 // "Move right" is focused
    await sleep(600);
    s = await tvState(tv);
    check('Move right keeps focus on the moved tile', s.label === 'Wikipedia' && s.focus === 8, s);
    const scOrder = (await localState(tv)).shortcuts.map((x) => x.name);
    check('new shortcut order saved in the service', scOrder[0] === 'Map' && scOrder[1] === 'Wikipedia', scOrder);
    await tv.key(K.ENTER, { hold: 900 });
    await tv.key(K.ENTER);                 // Move left is now the first enabled item
    await sleep(600);
    s = await tvState(tv);
    check('Move left puts it back', s.label === 'Wikipedia' && s.focus === 7, s);

    // An HDMI tile grows into a card playing its live picture (Netflix style); OK switches to it.
    await tv.key(K.LEFT);                  // Denon, HDMI 4
    const live = await waitFor(tv, `document.documentElement.classList.contains('live-hole') && document.getElementById('live-card').classList.contains('on') && document.getElementById('lc-title').textContent`, 3000);
    s = await tvState(tv);
    check('resting on an HDMI tile grows it into a live card', /Denon/.test(live || '') && /HDMI 4/.test(live || '') && s.shelf === 'HDMI 4 / Denon', { live, shelf: s.shelf });
    await tv.shot(path.join(OUT, 'tv-live.png'));
    await tv.key(K.ENTER);
    await sleep(400);
    s = await tvState(tv);
    check('OK on Denon switches to HDMI 4 (preview toast)', /would open Denon/.test(s.toast), s.toast);
    check('opening something stops the live picture', !!(await waitFor(tv, `!(document.documentElement.classList.contains('live-hole') || document.getElementById('live-card').classList.contains('on'))`, 1500)));

    // Hide an app, then bring it back from the + panel.
    for (let i = 0; i < 3; i++) await tv.key(K.LEFT);   // Spotify, last of the apps
    await tv.key(K.ENTER, { hold: 900 });
    s = await tvState(tv);
    check('app menu: Move left, Move right disabled, Hide, Cancel', s.menuTitle === 'Spotify' && JSON.stringify(s.menuItems) === JSON.stringify(['Move left*', 'Move right(x)', 'Hide', 'Cancel']), s);
    await tv.key(K.DOWN);                  // skips the disabled item: Hide
    await tv.key(K.ENTER);
    await sleep(400);
    s = await tvState(tv);
    check('Hide removes the app from the dock', s.count === 10, s.count);

    // Go to the + tile (last) and open the panel.
    for (let i = 0; i < 12; i++) await tv.key(K.RIGHT);
    await sleep(400);
    s = await tvState(tv);
    check('Right at the last tile stops on +', s.label === 'Add photos and shortcuts' && s.shelf === 'Add / Photos and shortcuts', s);
    await tv.key(K.ENTER);
    await sleep(900);
    s = await tvState(tv);
    check('OK on + opens the panel', s.panelOpen, s);
    const panel = await tv.eval(`({ url: document.getElementById('panel-url').textContent, pw: document.getElementById('panel-pw').textContent, stats: document.getElementById('panel-stats').textContent, buttons: [...document.querySelectorAll('#panel .pbtn')].map(b => b.textContent) })`);
    check('panel shows the address', /^http:\/\/127\.0\.0\.1:18290$/.test(panel.url), panel.url);
    check('panel shows a generated password', PW.test(panel.pw), panel.pw);
    check('panel offers Show hidden apps (1)', panel.buttons.indexOf('Show hidden apps (1)') >= 0, panel.buttons);
    check('panel shows the sign-in QR code', await waitFor(tv, `document.getElementById('panel-qr').classList.contains('on')`, 3000));
    await tv.key(K.RIGHT);
    await tv.key(K.ENTER);                 // Show hidden apps
    await sleep(400);
    s = await tvState(tv);
    check('hidden app restored', s.count === 11, s.count);
    await tv.key(K.LEFT);
    await sleep(300);
    await tv.shot(path.join(OUT, 'tv-panel.png'));

    // New password from the TV: two presses, and the panel shows the new one.
    const before = panel.pw;
    await tv.key(K.ENTER);
    const armed = await tv.eval(`document.querySelector('#panel .pbtn.focused').textContent`);
    check('New password asks for a second OK', /again/.test(armed), armed);
    await tv.key(K.ENTER);
    await sleep(1200);
    const after = await tv.eval(`document.getElementById('panel-pw').textContent`);
    check('New password shows a different password', after !== before && PW.test(after), [before, after]);
    const stored = await tv.eval(`Object.keys(localStorage).filter((k) => [${JSON.stringify(before)}, ${JSON.stringify(after)}].some((pw) => (localStorage.getItem(k) || '').indexOf(pw) >= 0))`);
    check('the password is not written to localStorage', stored.length === 0, stored);
    // YouTube link mode switch (bottom row)
    await tv.key(K.DOWN);
    await tv.key(K.ENTER);
    const ytm = await tv.eval(`document.querySelector('#panel .pbtn.small').textContent`);
    check('YouTube link mode switch cycles', /payload \+ URL/.test(ytm), ytm);
    await tv.key(K.ENTER);
    await tv.key(K.ENTER);                 // back to watch URL (the default)
    await tv.key(K.BACK);
    await sleep(400);
    s = await tvState(tv);
    check('Back closes the panel', !s.panelOpen && !s.ambient, s);
    check('closing the panel withdraws the QR code', !(await tv.eval(`document.getElementById('panel-qr').classList.contains('on')`)));

    // Back on Home goes straight to the aerial screensaver; the next press only wakes it.
    const focusBefore = s.focus;
    await tv.key(K.BACK);
    s = await tvState(tv);
    check('Back on Home opens the screensaver', s.ambient && !s.panelOpen && !s.menuOpen, s);
    await sleep(800);                      // past the guard for a still-held Back
    await tv.key(K.ENTER);
    await sleep(400);
    s = await tvState(tv);
    check('OK in the screensaver only wakes the screen', !s.ambient && s.focus === focusBefore && !s.panelOpen && !/would open/.test(s.toast), s);

    // Hidden menu: Up three times quickly on the Home row.
    await tv.key(K.UP);
    await tv.key(K.UP);
    s = await tvState(tv);
    check('Up twice does not open the hidden menu', !s.menuOpen, s);
    await sleep(1700);                     // the presses must be within 1.5 s
    await tv.key(K.UP);
    s = await tvState(tv);
    check('a slow third Up does not open it either', !s.menuOpen, s);
    await tv.key(K.UP);
    await tv.key(K.UP);
    s = await tvState(tv);
    check('Up x3 opens the hidden menu', s.menuOpen && JSON.stringify(s.menuItems) === JSON.stringify(['Samsung Home*', 'Clean RAM', 'Photos, website and QR code', 'Guests: Wi-Fi and photo drop', 'Restart this screen', 'Restart background service', 'Startup times', 'Cancel']), s);
    await sleep(300);
    await tv.shot(path.join(OUT, 'tv-hidden-menu.png'));
    await tv.key(K.ENTER);                 // Samsung Home
    await sleep(500);
    s = await tvState(tv);
    check('hidden menu: Samsung Home opens it (preview toast)', !s.menuOpen && /would open Samsung Home/.test(s.toast), s);
    await tv.key(K.UP); await tv.key(K.UP); await tv.key(K.UP);
    await tv.key(K.DOWN); await tv.key(K.DOWN);   // Photos, website and QR code
    await tv.key(K.ENTER);
    await sleep(700);
    s = await tvState(tv);
    check('hidden menu: "Photos, website and QR code" opens the panel', s.panelOpen, s);
    await tv.key(K.BACK);
    await sleep(300);

    // All apps: Down from the dock; hold OK on an app to Move it.
    await tv.key(K.DOWN);
    await sleep(800);
    s = await tvState(tv);
    const cells = () => tv.eval(`[...document.querySelectorAll('#allapps-grid .aa-name')].map(e => e.textContent)`);
    const names0 = await cells();
    check('Down opens All apps', s.appsOpen && names0.length >= 10 && /apps$/.test(await tv.eval(`document.getElementById('allapps-count').textContent`)), { open: s.appsOpen, n: names0.length });
    await tv.shot(path.join(OUT, 'tv-all-apps.png'));
    await tv.key(K.ENTER, { hold: 900 });
    s = await tvState(tv);
    check('All apps menu: Move, Add/Remove from Home, Cancel', s.menuOpen && s.menuTitle === names0[0] && s.menuItems.length === 3 && s.menuItems[0] === 'Move*' && /^(Add to|Remove from) Home$/.test(s.menuItems[1]) && s.menuItems[2] === 'Cancel', s);
    await tv.key(K.ENTER);                 // Move
    await sleep(200);
    check('Move: the tile is picked up', /Arrows move it/.test(await tv.eval(`document.getElementById('allapps-count').textContent`)) && await tv.eval(`!!document.querySelector('#allapps-grid .aa-cell.moving')`));
    await tv.key(K.RIGHT);
    let names1 = await cells();
    check('Move: Right carries the app one place on', names1[0] === names0[1] && names1[1] === names0[0], names1.slice(0, 3));
    await tv.key(K.ENTER);                 // keep it there
    await sleep(500);
    check('Move: OK puts it down', !(await tv.eval(`!!document.querySelector('#allapps-grid .aa-cell.moving')`)));
    const home = (await localState(tv)).settings.home;
    const ids0 = await tv.eval(`JSON.parse(localStorage.getItem('gh.allapps.v1') || '[]').map(a => a.name)`);
    check('Move: the new order is kept (TV and service)', ids0[0] === names0[1] && ids0[1] === names0[0] && home && home.allOrder.length === names0.length, { ids: ids0.slice(0, 3), allOrder: home && home.allOrder.length });
    // A second move, cancelled with Back, changes nothing.
    await tv.key(K.ENTER, { hold: 900 });
    await tv.key(K.ENTER);
    await tv.key(K.RIGHT);
    await tv.key(K.BACK);
    await sleep(200);
    names1 = await cells();
    check('Move: Back puts it back where it was', names1[0] === names0[1] && names1[1] === names0[0] && (await tvState(tv)).appsOpen, names1.slice(0, 3));
    // Put the first two back, so later runs start from the same order.
    await tv.key(K.ENTER, { hold: 900 });
    await tv.key(K.ENTER);
    await tv.key(K.RIGHT);
    await tv.key(K.ENTER);
    await sleep(300);
    await tv.key(K.UP);                    // Up on the top row returns to Home
    await sleep(400);
    s = await tvState(tv);
    check('Up on the first row of All apps goes back to Home', !s.appsOpen && s.focus === focusBefore, s);

    // Visibility: hidden pauses the clock timer and photo rotation.
    const vis = await tv.eval(`(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      const paused = document.documentElement.classList.contains('paused');
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      return { paused, resumed: !document.documentElement.classList.contains('paused') };
    })()`);
    check('hidden -> paused, visible -> resumed', vis.paused && vis.resumed, vis);

    const tvErrors = realErrors(tv);
    check('no script errors in the TV app', tvErrors.length === 0, tvErrors);

    // An older build kept the password in localStorage: the next start removes it.
    await tv.eval(`localStorage.setItem('gh.pw.v1', JSON.stringify({ id: 'old', plain: ${JSON.stringify(after)} }))`);

    // Second look: another photo, the YouTube shortcut focused, still frame.
    const tv2 = await browser.newPage({ width: 1920, height: 1080 });
    await tv2.goto(base + '&bg=nature-11.jpg&focus=9', 4500);
    check('a password stored by an older build is removed at start', (await tv2.eval(`localStorage.getItem('gh.pw.v1')`)) === null);
    await sleep(400);
    await tv2.shot(path.join(OUT, 'tv-focus-youtube.png'));
    await tv2.close();

    // Service not running: + says the website is starting and shows no password.
    const tvDown = await browser.newPage({ width: 1920, height: 1080 });
    await tvDown.goto('http://127.0.0.1:' + UI + '/index.html?preview=1&video=0&still=1&panel=1&api=' + encodeURIComponent('http://127.0.0.1:' + (PORT + 9)), 3500);
    const down = await tvDown.eval(`({ open: document.getElementById('panel').classList.contains('open'), pw: document.getElementById('panel-pw').textContent, note: document.getElementById('panel-pw-note').textContent })`);
    check('service down: + shows no password and says the website is starting', down.open && down.pw === '—' && /starting/.test(down.note), down);
    await tvDown.close();

    // Older-TV switches: smartHubLaunch is off by default; photoService: false
    // (here ?photoService=0) leaves only the apps and inputs, and nothing can be hidden.
    const tvOld = await browser.newPage({ width: 1920, height: 1080 });
    await tvOld.goto(base + '&still=1&photoService=0', 4500);
    check('smartHubLaunch is off by default', (await tvOld.eval('GH.config.smartHubLaunch')) === false);
    s = await tvState(tvOld);
    check('no photo service: only the 4 apps and 3 inputs, no shortcuts or +', s.count === 7 && JSON.stringify(await kinds(tvOld)) === JSON.stringify(['app', 'app', 'app', 'app', 'input', 'input', 'input']), s.count);
    for (let i = 0; i < 10; i++) await tvOld.key(K.RIGHT);
    s = await tvState(tvOld);
    check('no photo service: the last tile is an input', s.focus === 6, s);
    await tvOld.key(K.ENTER, { hold: 900 });
    s = await tvState(tvOld);
    check('no photo service: menu has no Hide', JSON.stringify(s.menuItems) === JSON.stringify(['Move left*', 'Move right(x)', 'Cancel']), s.menuItems);
    await tvOld.key(K.BACK);
    const oldErrors = realErrors(tvOld);
    check('no photo service: no script errors', oldErrors.length === 0, oldErrors);
    await tvOld.close();

    // HDMI inputs from config.js: Apple TV (HDMI 1), beIN Sports (HDMI 2), Denon (HDMI 4).
    const tvIn = await browser.newPage({ width: 1920, height: 1080 });
    await tvIn.goto(base + '&still=1&focus=4', 4500);   // the dock remembers focus, so set it
    s = await tvState(tvIn);
    check('inputs: in config order, with the port under the name', s.label === 'Apple TV' && /HDMI 1/.test(await tvIn.eval(`document.querySelector('#dock-row .tile.focused').textContent`)), s.label);
    await tvIn.key(K.ENTER, { hold: 900 });
    s = await tvState(tvIn);
    check('inputs: menu has Move and Hide, not Remove', JSON.stringify(s.menuItems) === JSON.stringify(['Move left(x)', 'Move right*', 'Hide', 'Cancel']), s.menuItems);
    await tvIn.key(K.ENTER);                // Move right
    await sleep(500);
    s = await tvState(tvIn);
    check('inputs: Move right swaps the two inputs', s.label === 'Apple TV' && s.focus === 5, s);
    // The order lives in the service: after a restart the TV shows its cached
    // layout first, then the service's on the next sync.
    const ports = () => tvIn.eval(`[...document.querySelectorAll('#dock-row .tile-input .input-port')].map(e => e.textContent).join(',')`);
    await tvIn.goto(base + '&still=1', 1500);
    const kept = await waitFor(tvIn, `[...document.querySelectorAll('#dock-row .tile-input .input-port')].map(e => e.textContent).join(',') === 'HDMI 2,HDMI 1,HDMI 4'`, 8000);
    check('inputs: the new order is kept after a restart', kept, await ports());
    for (let i = 0; i < 11; i++) await tvIn.key(K.LEFT);
    for (let i = 0; i < 4; i++) await tvIn.key(K.RIGHT);
    s = await tvState(tvIn);
    check('inputs: beIN Sports is now the first input', s.focus === 4 && s.label === 'beIN Sports', s);
    await tvIn.key(K.ENTER);
    await sleep(400);
    s = await tvState(tvIn);
    check('OK on an input switches to it (preview toast)', /would open beIN Sports/.test(s.toast), s.toast);
    await tvIn.key(K.RIGHT);                // Apple TV: move it back to the front
    await tvIn.key(K.ENTER, { hold: 900 });
    await tvIn.key(K.ENTER);                // Move left
    await sleep(500);
    s = await tvState(tvIn);
    check('inputs: Move left restores the config order', s.label === 'Apple TV' && s.focus === 4, s);
    await tvIn.goto(base + '&still=1&photoService=0&focus=4', 4500);
    await tvIn.key(K.ENTER, { hold: 900 });
    s = await tvState(tvIn);
    check('inputs, no photo service: menu has no Hide or Remove', JSON.stringify(s.menuItems) === JSON.stringify(['Move left(x)', 'Move right*', 'Cancel']), s.menuItems);
    await tvIn.key(K.BACK);
    const inErrors = realErrors(tvIn);
    check('inputs: no script errors', inErrors.length === 0, inErrors);
    await tvIn.close();

    // Screensaver (?idle shortens the delay) and evening dimming.
    const tvAmb = await browser.newPage({ width: 1920, height: 1080 });
    await tvAmb.goto(base + '&bg=nature-06.jpg&idle=1500&night=1&focus=1', 3000);
    await sleep(2200);
    const amb1 = await tvAmb.eval(`({ amb: document.documentElement.classList.contains('ambient'), night: document.documentElement.classList.contains('night') })`);
    check('screensaver starts after the idle time', amb1.amb === true, amb1);
    check('evening dimming on with ?night=1', amb1.night === true, amb1);
    const shown = () => tvAmb.eval(`[...document.querySelectorAll('#bg .bg-layer.show img')].map(i => i.src).join(' ')`);
    const photo0 = await shown();
    const before1 = (await tvState(tvAmb)).focus;
    await tvAmb.key(K.RIGHT);
    await sleep(2200);
    s = await tvState(tvAmb);
    const photo1 = await shown();
    check('Right in the screensaver changes the scene and stays in it', s.ambient && s.focus === before1 && photo1 !== photo0, { ambient: s.ambient, focus: s.focus, photo0, photo1 });
    await tvAmb.key(K.LEFT);
    await sleep(300);
    check('Left in the screensaver stays in it too', (await tvState(tvAmb)).ambient);
    await tvAmb.key(K.DOWN);
    await sleep(300);
    s = await tvState(tvAmb);
    check('any other button only wakes the screen', !s.ambient && !s.appsOpen && s.focus === before1, s);
    await tvAmb.key(K.RIGHT);
    await sleep(300);
    check('the next press works normally', (await tvState(tvAmb)).focus === before1 + 1);
    // Apple TV face: nothing from Home (the Top Shelf) may sit over the screensaver.
    await tvAmb.eval(`document.documentElement.classList.add('face-tv'); GH.enterAmbient(); true`);
    await sleep(1600);
    const shelfOp = await tvAmb.eval(`getComputedStyle(document.getElementById('shelf')).opacity`);
    check('the Top Shelf is hidden in the screensaver', shelfOp === '0', shelfOp);
    // Info (457) in the screensaver keeps it on (photos: no caption to show, but no wake either when video runs).
    const capOk = await tvAmb.eval(`typeof GH.VideoSaver.showCaption === 'function'`);
    check('the screensaver can show its caption on demand', capOk);
    // OLED care and the daytime look
    const shift = await tvAmb.eval(`(() => { const h = document.documentElement; const before = getComputedStyle(document.getElementById('clock')).translate; h.style.setProperty('--shift-x', '6px'); h.style.setProperty('--shift-y', '-3px'); return [h.classList.contains('pixel-shift'), before, getComputedStyle(document.getElementById('clock')).translate]; })()`);
    check('screen care moves the clock a few pixels', shift[0] === true && shift[2] === '6px -3px', shift);
    const sun = await tvAmb.eval(`(() => { const d = new Date(2026, 5, 21, 12); const r = GH.sunTimes(d, 0, -d.getTimezoneOffset() / 4); return [Math.round(r.rise), Math.round(r.set)]; })()`);
    check('sunrise and sunset at the equator are about 6 and 18', Math.abs(sun[0] - 360) < 20 && Math.abs(sun[1] - 1080) < 20, sun);
    await tvAmb.close();

    // ---------------- phone website ----------------
    console.log('Phone website');
    const ph = await browser.newPage({ width: 390, height: 844, scale: 2, mobile: true });
    await ph.goto('http://127.0.0.1:' + PORT + '/', 1800);
    check('signed-out phone sees the sign-in form', await ph.eval(`!document.getElementById('login').hidden`));
    await ph.type('#login-pw', 'not-the-password');
    await ph.click('#login-btn');
    await sleep(1300);
    const msg = await ph.eval(`document.getElementById('login-msg').textContent`);
    check('wrong password message', /Wrong password/.test(msg), msg);
    await ph.eval(`document.getElementById('login-pw').value = ''`);
    await ph.shot(path.join(OUT, 'phone-login.png'));

    // Sign in with the QR code on the TV's + panel: no password needed.
    const tvQr = await browser.newPage({ width: 1920, height: 1080 });
    await tvQr.goto(base + '&still=1&panel=1', 3000);
    await waitFor(tvQr, `document.getElementById('panel-qr').classList.contains('on')`, 4000);
    const qr = await tvQr.eval(`fetch('http://127.0.0.1:${PORT}/local/qr?k=' + encodeURIComponent(window.GH_LOCAL_KEY)).then(r => r.json())`);
    check('the TV has a sign-in code for its QR code', qr && /^[A-Za-z0-9_-]{20,}$/.test(qr.token) && qr.url === 'http://127.0.0.1:' + PORT, qr && qr.url);
    await ph.goto('http://127.0.0.1:' + PORT + '/#qr=' + qr.token, 2500);
    check('opening the QR link signs the phone in', await ph.eval(`!document.getElementById('main').hidden && location.hash === ''`));
    const thanks = await waitFor(tvQr, `/Signed in on your phone/.test(document.getElementById('toast').textContent) && document.getElementById('toast').textContent`, 6000);
    check('the TV says the phone signed in', !!thanks, thanks);
    const again = await ph.eval(`fetch('/api/qr-login', { method: 'POST', headers: { 'X-GH': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ${JSON.stringify(qr.token)} }) }).then(r => r.status)`);
    check('a QR code signs in only once', again === 401, again);
    await tvQr.close();

    await ph.goto('http://127.0.0.1:' + UI + '/dev/login?to=/%23photos', 2500);
    check('signed-in phone sees the photos tab', await ph.eval(`!document.getElementById('main').hidden && !document.getElementById('tab-photos').hidden`));
    const grid = await ph.eval(`document.querySelectorAll('#grid button').length`);
    check('photo grid shows the 2 demo photos', grid === 2, grid);

    // Upload through the real page: a portrait JPEG and a PNG, resized in the browser.
    const tmp = path.join(__dirname, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    await ph.setFiles('#file-input', await makeTestImages(browser, tmp));
    let up = 0;
    for (let i = 0; i < 40 && up < 4; i++) { await sleep(500); up = await ph.eval(`document.querySelectorAll('#grid button').length`); }
    check('two uploads from the page (portrait JPEG + PNG) appear', up === 4, up);
    const st = await ph.eval(`fetch('/api/photos', { headers: { 'X-GH': '1' } }).then(r => r.json())`);
    const newest = st.photos.slice(0, 2);
    check('uploaded photos are 1920x1080 with thumbnails', newest.every((p) => p.w === 1920 && p.h === 1080 && p.thumb), newest);
    await sleep(2800);
    await ph.shot(path.join(OUT, 'phone-photos.png'));

    await ph.click('[data-tab="settings"]');      // Shortcuts live in Settings now
    await sleep(1200);
    await ph.type('#yt-url', 'https://youtu.be/dQw4w9WgXcQ?t=42');
    await sleep(2500);
    const prev = await ph.eval(`({ title: document.getElementById('yt-title').textContent, meta: document.getElementById('yt-meta').textContent, thumb: document.getElementById('yt-thumb').naturalWidth, btn: !document.getElementById('yt-btn').disabled })`);
    check('YouTube link previewed with title and thumbnail', prev.btn && prev.thumb > 120 && /Rick Astley/.test(prev.title) && /1:42|0:42/.test(prev.meta), prev);
    await ph.shot(path.join(OUT, 'phone-shortcuts.png'), { fullPage: true });

    await ph.type('#web-url', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
    await ph.click('#web-btn');
    await sleep(600);
    const moved = await ph.eval(`document.getElementById('yt-url').value`);
    check('a YouTube link typed as a website moves to the video form', /jNQXAC9IVRw/.test(moved), moved);

    await ph.click('[data-tab="settings"]');
    await sleep(3600);                   // let the last toast fade
    await ph.shot(path.join(OUT, 'phone-settings.png'));

    // Design tab: the faces. Choosing one on the phone changes the TV within a poll.
    await ph.click('[data-tab="design"]');
    await sleep(1200);
    const faces = await ph.eval(`[...document.querySelectorAll('#dz-faces [data-face]')].map(b => b.getAttribute('data-face'))`);
    check('Design tab offers the four faces', !(await ph.eval(`document.getElementById('tab-design').hidden`)) && JSON.stringify(faces) === JSON.stringify(['tv', 'glass', 'minimal', 'bigclock']), faces);
    await ph.shot(path.join(OUT, 'phone-design.png'));
    for (const f of ['glass', 'minimal', 'bigclock', 'tv']) {
      await ph.click('#dz-faces [data-face="' + f + '"]');
      const tapped = await waitFor(ph, `document.querySelector('#dz-faces [data-face="${f}"]').classList.contains('on')`, 3000);
      check('Design tab: tapping the ' + f + ' face selects it', tapped);
      const on =await waitFor(tv, `document.documentElement.classList.contains('face-${f}') && ['tv', 'glass', 'minimal', 'bigclock'].filter((x) => document.documentElement.classList.contains('face-' + x)).length === 1`, 12000);
      const shelf = await tv.eval(`getComputedStyle(document.getElementById('shelf')).display !== 'none'`);
      const aspect = await tv.eval(`document.getElementById('dock').style.getPropertyValue('--aspect')`);
      check('face ' + f + ' chosen on the phone reaches the TV' + (f === 'tv' ? ' (Top Shelf, wide tiles)' : ' (no Top Shelf, square tiles)'),
        on && shelf === (f === 'tv') && aspect === (f === 'tv' ? '1.6' : '1'),
        { on, shelf, aspect, service: (await localState(tv)).settings.design.face, tvClass: await tv.eval('document.documentElement.className') });
      if (f !== 'tv') { await sleep(600); await tv.shot(path.join(OUT, 'tv-face-' + f + '.png')); }
    }
    const phErrors = realErrors(ph, /status of 401/);
    check('no script errors on the phone page', phErrors.length === 0, phErrors);

    // First run as the owner will see it: the apps, the inputs and +, no shortcuts yet.
    const ids = (await localState(tv)).shortcuts.map((x) => x.id);
    for (const id of ids) await tv.eval(`fetch('http://127.0.0.1:${PORT}/local/shortcuts/${id}?k=' + encodeURIComponent(window.GH_LOCAL_KEY), { method: 'DELETE' }).then(r => r.status)`);
    const tv3 = await browser.newPage({ width: 1920, height: 1080 });
    await tv3.goto(base + '&bg=nature-04.jpg&focus=0', 4500);
    const n3 = await tv3.eval(`document.querySelectorAll('#dock-row .tile').length`);
    check('first run: four apps, three inputs and +', n3 === 8, n3);
    await tv3.shot(path.join(OUT, 'tv-first-run.png'));
    await tv3.close();
  } finally {
    await browser.close();
    runner.kill('SIGTERM');
    await sleep(500);
    for (const f of ['ui-portrait.jpg', 'ui-landscape.png']) {
      try { fs.unlinkSync(path.join(__dirname, 'tmp', f)); } catch (e) { /* not created */ }
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
