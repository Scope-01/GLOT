// Checks the Home handoff endpoint against the sequence AeroTizen's writer uses.
// Run: node dev/test-home-control.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { start } = require('../app/service/home-control.js');

const T1 = 'a'.repeat(32);
const T2 = 'b'.repeat(32);
const H = 'c'.repeat(64);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-home-'));

function call(port, method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const OK = { 'X-AeroTizen-Home': '1', 'Content-Type': 'application/json' };
const ask = (port, m) => call(port, 'POST', '/control/home', OK, JSON.stringify({
  expected_mode: m.from[0], expected_transaction: m.from[1], expected_baseline_sha256: m.from[2],
  mode: m.to[0], transaction: m.to[1], baseline_sha256: m.to[2]
}));
function listen(d) {
  const s = start({ dir: d, port: 0 });
  return new Promise((r) => s.once('listening', () => r({ s, port: s.address().port })));
}
const close = (s) => new Promise((r) => s.close(r));

(async () => {
  let { s, port } = await listen(dir);
  let r = await call(port, 'GET', '/');
  assert.strictEqual(r.body.leaving, false);
  assert.deepStrictEqual(r.body.homeControl, { protocol: 1, app_id: 'DclHome001.Home', persistent: true, mode: 'watcher', transaction: null, baseline_sha256: null });

  assert.strictEqual((await call(port, 'POST', '/control/home', { 'Content-Type': 'application/json' }, '{}')).status, 403, 'needs the header');
  assert.strictEqual((await call(port, 'POST', '/control/home', { ...OK, Origin: 'http://evil' }, '{}')).status, 403, 'rejects browsers');
  assert.strictEqual((await call(port, 'POST', '/control/home', { ...OK, 'Content-Type': 'text/plain' }, '{}')).status, 415);
  assert.strictEqual((await ask(port, { from: ['native', T1, H], to: ['hold', T1, H] })).status, 409, 'stale expectation');
  assert.strictEqual((await ask(port, { from: ['watcher', null, null], to: ['native', T1, H] })).status, 409, 'native only from hold');

  // apply: watcher -> hold -> native
  assert.strictEqual((await ask(port, { from: ['watcher', null, null], to: ['hold', T1, H] })).body.mode, 'hold');
  assert.strictEqual((await ask(port, { from: ['hold', T1, H], to: ['native', T2, H] })).status, 409, 'native must keep its transaction');
  assert.strictEqual((await ask(port, { from: ['hold', T1, H], to: ['native', T1, H] })).body.mode, 'native');

  // A restart keeps the record.
  await close(s);
  ({ s, port } = await listen(dir));
  r = await call(port, 'GET', '/');
  assert.strictEqual(r.body.homeControl.mode, 'native');
  assert.strictEqual(r.body.homeControl.transaction, T1);

  // restore: native -> hold (new token) -> watcher
  assert.strictEqual((await ask(port, { from: ['native', T1, H], to: ['hold', T2, 'd'.repeat(64)] })).status, 409, 'other baseline');
  assert.strictEqual((await ask(port, { from: ['native', T1, H], to: ['hold', T2, H] })).body.transaction, T2);
  assert.strictEqual((await ask(port, { from: ['hold', T2, H], to: ['watcher', null, null] })).body.mode, 'watcher');
  await close(s);

  // A corrupt record or no storage blocks, so the writer refuses.
  fs.writeFileSync(path.join(dir, 'home-routing-v1.json'), 'nope');
  ({ s, port } = await listen(dir));
  assert.strictEqual((await call(port, 'GET', '/')).body.homeControl.mode, 'blocked');
  await close(s);
  ({ s, port } = await listen(null));
  r = (await call(port, 'GET', '/')).body.homeControl;
  assert.strictEqual(r.mode, 'blocked');
  assert.strictEqual(r.persistent, false);
  await close(s);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('home control: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
