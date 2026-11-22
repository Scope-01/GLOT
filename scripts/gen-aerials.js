// Builds app/js/aerials.js from Apple's aerial catalogue: video addresses plus
// Apple's timed location captions in English and Arabic.
// Usage: node gen-aerials.js <catalogue folder> <output file>
'use strict';
const fs = require('fs');
const path = require('path');
const [, , dir, out] = process.argv;

// Minimal binary property list reader: enough for a dictionary of strings.
function readBplist(buf) {
  if (buf.toString('ascii', 0, 8) !== 'bplist00') throw new Error('not a binary plist');
  const trailer = buf.slice(buf.length - 32);
  const offSize = trailer[6];
  const refSize = trailer[7];
  const numObjects = Number(trailer.readBigUInt64BE(8));
  const topObject = Number(trailer.readBigUInt64BE(16));
  const tableOffset = Number(trailer.readBigUInt64BE(24));
  const uint = (pos, size) => { let v = 0; for (let i = 0; i < size; i++) v = v * 256 + buf[pos + i]; return v; };
  const offsets = [];
  for (let i = 0; i < numObjects; i++) offsets.push(uint(tableOffset + i * offSize, offSize));
  function lengthAt(pos, low) {
    if (low !== 0xf) return { len: low, start: pos + 1 };
    const marker = buf[pos + 1];
    const size = 1 << (marker & 0xf);
    return { len: uint(pos + 2, size), start: pos + 2 + size };
  }
  function obj(ref) {
    const pos = offsets[ref];
    const type = buf[pos] >> 4;
    const low = buf[pos] & 0xf;
    if (type === 0x5) { const l = lengthAt(pos, low); return buf.toString('latin1', l.start, l.start + l.len); }
    if (type === 0x6) {
      const l = lengthAt(pos, low);
      const b = Buffer.from(buf.slice(l.start, l.start + l.len * 2));
      b.swap16();
      return b.toString('utf16le');
    }
    if (type === 0xd) {
      const l = lengthAt(pos, low);
      const res = {};
      for (let i = 0; i < l.len; i++) {
        const k = obj(uint(l.start + i * refSize, refSize));
        res[k] = obj(uint(l.start + (l.len + i) * refSize, refSize));
      }
      return res;
    }
    if (type === 0x1) return uint(pos + 1, 1 << low);
    return null;
  }
  return obj(topObject);
}

const strings = (lang) => readBplist(fs.readFileSync(path.join(dir, 'TVIdleScreenStrings.bundle', lang + '.lproj', 'Localizable.nocache.strings')));
const en = strings('en');
const ar = strings('ar');
const entries = JSON.parse(fs.readFileSync(path.join(dir, 'entries.json'), 'utf8'));
const toHttp = (u) => (u ? u.replace(/^https:/, 'http:') : undefined);
const q = (s) => JSON.stringify(String(s));

let withCaptions = 0;
const rows = entries.assets.filter((a) => a['url-1080-H264']).map((a) => {
  const parts = [
    'url: ' + q(toHttp(a['url-1080-H264'])),
    'credit: ' + q(a.accessibilityLabel || ''),
  ];
  if (a['url-4K-SDR']) parts.push('k4: ' + q(toHttp(a['url-4K-SDR'])));
  // Apple's own captions: seconds into the clip -> place, in English and Arabic.
  const poi = a.pointsOfInterest || {};
  const caps = Object.keys(poi).map(Number).filter((t) => isFinite(t)).sort((x, y) => x - y)
    .map((t) => ({ t, en: en[poi[t]], ar: ar[poi[t]] })).filter((c) => c.en);
  if (caps.length) {
    withCaptions += 1;
    parts.push('caps: [' + caps.map((c) => '[' + c.t + ', ' + q(c.en) + ', ' + q(c.ar || c.en) + ']').join(', ') + ']');
  }
  return '  { ' + parts.join(', ') + ' }';
});

fs.writeFileSync(out,
  "// Generated from Apple's aerial catalogue (resources-16). Streamed from Apple's server, never bundled.\n" +
  "// url: 1080p H.264. k4: 4K HEVC SDR. caps: Apple's timed captions [seconds, English, Arabic].\n" +
  "// Apple's HDR files are Dolby Vision profile 5, which Samsung TVs can't show. Plain http: Apple's https\n" +
  "// is untrusted off Apple devices.\n" +
  'window.GH_AERIALS = [\n' + rows.join(',\n') + '\n];\n');
console.log('scenes', rows.length, 'with captions', withCaptions, 'en strings', Object.keys(en).length, 'ar strings', Object.keys(ar).length);
console.log('sample', rows[0].slice(0, 400));
