/*
 * Glass Home - tile styling for known brands, so their tiles look deliberate
 * instead of depending on whatever icon the app reports.
 *   match  tested against "<name> <id>" of an app
 *   key    also how an input in config.js picks a brand (brand: 'denon')
 *   mark   file in img/marks/, shown over bg, inset by pad (% of the tile)
 *   text   a typographic logo instead, with optional sub line
 */
(function () {
  'use strict';
  var BRANDS = [
    { key: 'youtube', match: /youtube|cobalt-yt/i, mark: 'youtube', bg: '#e62117', pad: 26 },
    { key: 'spotify', match: /spotify/i, mark: 'spotify', bg: '#121212', pad: 26 },
    { key: 'stremio', match: /stremio/i, mark: 'stremio', bg: 'linear-gradient(145deg,#8a6cf7,#2f1e78)', pad: 24 },
    { key: 'netflix', match: /netflix/i, mark: 'netflix', bg: '#141414', pad: 26 },
    { key: 'primevideo', match: /prime ?video|primevideo/i, mark: 'primevideo', bg: 'linear-gradient(145deg,#1aa0e0,#0b4f7a)', pad: 14 },
    { key: 'disneyplus', match: /disney/i, mark: 'disneyplus', bg: 'linear-gradient(145deg,#1f5bd8,#091550)', pad: 22 },
    { key: 'appletv', match: /apple ?tv|aria-video/i, mark: 'appletv', bg: '#1c1c1e', pad: 24 },
    { key: 'twitch', match: /twitch/i, mark: 'twitch', bg: '#9146ff', pad: 26 },
    { key: 'plex', match: /plex/i, mark: 'plex', bg: '#1f1f1f', pad: 26 },
    { key: 'crunchyroll', match: /crunchyroll/i, mark: 'crunchyroll', bg: '#f47521', pad: 26 },
    { key: 'dazn', match: /dazn/i, mark: 'dazn', bg: '#0c161c', pad: 24 },
    { key: 'max', match: /(^|\s)max(\s|$)|hbo/i, mark: 'max', bg: '#002be7', pad: 20 },
    { key: 'bein', text: 'beIN', sub: 'SPORTS', bg: 'linear-gradient(145deg,#7a2bb8,#2c0b52)' },
    { key: 'denon', mark: 'denon', bg: 'linear-gradient(145deg,#2b2f36,#0b0d11)', pad: 14 }
  ];

  window.GH = window.GH || {};
  window.GH.brandByKey = function (key) {
    for (var i = 0; i < BRANDS.length; i++) if (BRANDS[i].key === key) return BRANDS[i];
    return null;
  };
  window.GH.brandForApp = function (name, id) {
    var text = (name || '') + ' ' + (id || '');
    for (var i = 0; i < BRANDS.length; i++) if (BRANDS[i].match && BRANDS[i].match.test(text)) return BRANDS[i];
    return null;
  };
}());
