// Glass Home - preview mock of the TV's installed apps (served by dev/run.js
// at /dev/mock.js, never packaged). A few apps get generated test icons so each
// icon case can be checked: transparent dark, transparent light, opaque square
// and opaque wide. The rest are name tiles.
(function () {
  'use strict';
  function icon(w, h, bg, fg) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
    x.fillStyle = fg;
    x.beginPath();
    x.arc(w / 2, h / 2, Math.min(w, h) * 0.32, 0, Math.PI * 2);
    x.fill();
    return c.toDataURL('image/png');
  }
  var names = ['YouTube', 'Netflix', 'Prime Video', 'Samsung TV Plus', 'Disney+', 'Internet', 'Spotify',
    'Nuvio', 'Stremio', 'MBC Shahid', 'OSN+', 'TOD by beIN', 'Apple TV', 'SmartThings', 'Yango Play'];
  var icons = {
    Nuvio: icon(256, 256, null, '#ffffff'),
    'MBC Shahid': icon(256, 256, null, '#101010'),
    'OSN+': icon(256, 256, '#c8102e', '#ffffff'),
    'Yango Play': icon(400, 225, '#20603d', '#ffffff')
  };
  window.GH_MOCK = {
    apps: names.map(function (n) { return { id: 'mock.' + n.replace(/[^A-Za-z]/g, ''), name: n, iconPath: icons[n] || null }; })
      .concat([{ id: 'com.samsung.tv.cobalt-yt', name: 'YouTube', iconPath: null }])   // the TV lists YouTube twice
  };
}());
