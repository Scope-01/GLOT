// Checks that website settings are cleaned before the TV sees them.
// Run: node dev/test-settings.js
'use strict';
const a = require('assert');
const s = require('../app/service/settings.js');

let m = s.merge(null, null);
a.strictEqual(m.name, 'GLOT');
a.strictEqual(m.home, null);
m = s.merge(m, { photos: { intervalSec: '9999', drift: false, disabled: ['nature-01.jpg', '../x.jpg', 5] }, screensaver: { afterMin: 0 },
  night: { from: '25:00', to: '07:30' }, weather: { latitude: 24.7, longitude: 999, place: '<b>x</b>' } });
a.strictEqual(m.photos.intervalSec, 3600);
a.strictEqual(m.photos.drift, false);
a.deepStrictEqual(m.photos.disabled, ['nature-01.jpg']);
a.strictEqual(m.screensaver.afterMin, 0);
a.strictEqual(m.night.from, '20:00');
a.strictEqual(m.night.to, '07:30');
a.strictEqual(m.weather.latitude, null);
m = s.merge(m, { home: { order: ['nuvio'], hidden: [1, 'x'], extra: [{ ids: ['a.b'], label: 'AB' }, { ids: ['bad id'] }],
  inputs: [{ hdmi: 1, label: 'A', brand: 'appletv' }, { hdmi: 9, label: 'no' }, { hdmi: 1, label: 'dup' }, { hdmi: '2', label: '', brand: 'evil' }],
  allOrder: ['a.b', 'a.b'] } });
a.deepStrictEqual(m.home.extra, [{ key: 'x:a.b', label: 'AB', ids: ['a.b'], names: [] }]);
a.deepStrictEqual(m.home.inputs, [{ label: 'A', hdmi: 1, brand: 'appletv' }, { label: 'HDMI 2', hdmi: 2 }]);
a.deepStrictEqual(m.home.allOrder, ['a.b']);
a.strictEqual(s.merge(m, { name: '  ' }).name, m.name);
a.strictEqual(s.merge(m, { clock24: true }).clock24, true);
a.strictEqual(s.merge(m, {}).home.order[0], 'nuvio');
m = s.merge(m, { screensaver: { quality: '4khdr' } });
a.strictEqual(m.screensaver.quality, '4k');
m = s.merge(m, { advanced: { clockSize: 'huge', tileSize: 'large', holdMs: 9999, css: '#time{color:gold}' } });
a.strictEqual(m.advanced.clockSize, 'medium');
a.strictEqual(m.advanced.holdMs, 1500);
m = s.merge(m, { design: { face: 'bigclock', faces: { bigclock: { font: 'serif', weight: 950, color: '#FF8800',
  widgets: ['weather', 'x', 'weather', 'countdown', 'date', 'greeting'] } }, countdown: { label: 'Eid', date: '2027-03-20' }, accent: 'red' } });
a.strictEqual(m.design.face, 'bigclock');
a.deepStrictEqual(m.design.faces.bigclock, { font: 'serif', weight: 900, color: '#FF8800', widgets: ['weather', 'countdown', 'date'] });
a.strictEqual(m.design.accent, 'auto');
m = s.merge(m, { design: { faces: { tv: { weight: 300 } } } });
a.strictEqual(m.design.faces.bigclock.font, 'serif', 'other faces kept');
a.strictEqual(m.design.faces.tv.font, 'inter', 'unchanged fields kept');
console.log('settings: all checks passed');
