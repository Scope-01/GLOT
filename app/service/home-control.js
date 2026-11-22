// Glass Home - the loopback endpoint AeroTizen's Home tool talks to.  Node 12 API only.
//
// AeroTizen's PC tool remaps the remote's Home button. Its native writer only
// proceeds once the launcher answers on 127.0.0.1:47790 and has saved a "hold"
// state that survives restarts. This file answers that protocol, so the tool
// and its safety checks run unchanged. Glass Home has no watcher to pause: the
// saved mode is only the tool's handoff record. Nothing here changes TV settings.
//
// The transition rules are adapted from AeroTizen's service/home-mode.js (MIT).
'use strict';
var fs = require('fs');
var http = require('http');
var path = require('path');

var APP_ID = 'DclHome001.Home';
var PORT = 47790;
var FILE = 'home-routing-v1.json';

function token(value, length) {
  return typeof value === 'string' && new RegExp('^[a-f0-9]{' + length + '}$').test(value);
}

function valid(value) {
  return !!value && (value.mode === 'watcher'
    ? value.transaction === null && value.baseline_sha256 === null
    : (value.mode === 'native' || value.mode === 'hold') && token(value.transaction, 32) && token(value.baseline_sha256, 64));
}

function writeDurably(file, text) {
  var temporary = file + '.' + process.pid + '-' + Date.now();
  var descriptor = fs.openSync(temporary, 'wx', 384);
  try {
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, file);
  } catch (e) {
    try { fs.unlinkSync(temporary); } catch (ignored) { /* report the rename */ }
    throw e;
  }
  try {
    var folder = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(folder); } finally { fs.closeSync(folder); }
  } catch (e) { /* not every filesystem can sync a folder */ }
}

// dir: a writable folder, or null. Without one the mode reads "blocked" and the
// tool refuses before its first native write.
function createMode(dir) {
  var file = dir ? path.join(dir, FILE) : null;
  var saved = { mode: dir ? 'watcher' : 'blocked', transaction: null, baseline_sha256: null };
  if (file) {
    try {
      if (fs.existsSync(file)) {
        var loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!valid(loaded)) throw new Error('bad saved mode');
        saved = loaded;
      }
    } catch (e) {
      saved = { mode: 'blocked', transaction: null, baseline_sha256: null };
    }
  }
  function read() {
    return { protocol: 1, app_id: APP_ID, persistent: !!file, mode: saved.mode,
      transaction: saved.transaction, baseline_sha256: saved.baseline_sha256 };
  }
  function change(request) {
    if (!file) throw new Error('Persistent Home mode is unavailable');
    if (!request || request.expected_mode !== saved.mode || request.expected_transaction !== saved.transaction ||
        request.expected_baseline_sha256 !== saved.baseline_sha256) {
      throw new Error('Home mode changed; read it again');
    }
    var next = { mode: request.mode, transaction: request.transaction, baseline_sha256: request.baseline_sha256 };
    if (!valid(next) || saved.mode === 'blocked' ||
        (next.mode === 'hold'
          ? saved.mode !== 'watcher' && next.baseline_sha256 !== saved.baseline_sha256
          : saved.mode !== 'hold' ||
            (next.mode === 'native' && (next.transaction !== saved.transaction || next.baseline_sha256 !== saved.baseline_sha256)))) {
      throw new Error('Invalid Home handoff transition');
    }
    var encoded = JSON.stringify(next);
    try {
      writeDurably(file, encoded);
      if (fs.readFileSync(file, 'utf8') !== encoded) throw new Error('Home mode readback failed');
      saved = next;
    } catch (e) {
      saved = { mode: 'blocked', transaction: saved.transaction, baseline_sha256: saved.baseline_sha256 };
      throw e;
    }
    return read();
  }
  return { read: read, change: change };
}

function handler(mode) {
  return function (req, res) {
    function reply(code, value) {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    }
    var headers = req.headers || {};
    // A web page can't set these conditions, so only a local native tool gets through.
    if (headers.origin) return reply(403, { error: 'Local native control required' });
    var pathname = String(req.url || '').split('?')[0];
    if (pathname === '/') {
      if (req.method !== 'GET') return reply(405, { error: 'GET required' });
      return reply(200, { leaving: false, homeControl: mode.read() });
    }
    if (pathname !== '/control/home') return reply(404, { error: 'Not found' });
    if (req.method !== 'POST') return reply(405, { error: 'POST required' });
    if (headers['x-aerotizen-home'] !== '1') return reply(403, { error: 'Local native control required' });
    if (headers['content-type'] !== 'application/json') return reply(415, { error: 'JSON required' });
    var body = '';
    var finished = false;
    req.setEncoding('utf8');
    req.on('data', function (chunk) {
      if (finished) return;
      body += chunk;
      if (body.length > 4096) { finished = true; reply(413, { error: 'Request too large' }); }
    });
    req.on('error', function () {
      if (!finished) { finished = true; reply(400, { error: 'Request failed' }); }
    });
    req.on('end', function () {
      if (finished) return;
      finished = true;
      try {
        reply(200, mode.change(JSON.parse(body)));
      } catch (e) {
        reply(409, { error: e.message, homeControl: mode.read() });
      }
    });
  };
}

// opts: dir (writable folder or null), port, log. Binds to loopback only.
function start(opts) {
  var log = opts.log || function () {};
  var server = http.createServer(handler(createMode(opts.dir)));
  server.on('error', function (e) { log('home control: ' + e.message); });
  server.listen(opts.port === undefined ? PORT : opts.port, '127.0.0.1');
  return server;
}

module.exports = { start: start, createMode: createMode };
