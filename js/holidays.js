/* Slovenski dela prosti dnevi. Deluje v brskalniku (window.KSHolidays) in v Node (module.exports). */
(function (root) {
  'use strict';

  const FIXED = [
    [1, 1, 'Novo leto'],
    [1, 2, 'Novo leto'],
    [2, 8, 'Prešernov dan'],
    [4, 27, 'Dan upora proti okupatorju'],
    [5, 1, 'Praznik dela'],
    [5, 2, 'Praznik dela'],
    [6, 25, 'Dan državnosti'],
    [8, 15, 'Marijino vnebovzetje'],
    [10, 31, 'Dan reformacije'],
    [11, 1, 'Dan spomina na mrtve'],
    [12, 25, 'Božič'],
    [12, 26, 'Dan samostojnosti in enotnosti']
  ];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function iso(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  // Velikonočna nedelja (gregorijanski koledar, algoritem Meeus/Jones/Butcher).
  function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(year, month, day);
  }

  const cache = {};

  // Vrne { "YYYY-MM-DD": "ime praznika" } za dano leto.
  function getHolidays(year) {
    if (cache[year]) return cache[year];
    const map = {};
    FIXED.forEach(([m, d, name]) => { map[iso(year, m, d)] = name; });
    const e = easterSunday(year);
    const [ey, em, ed] = e.split('-').map(Number);
    map[e] = 'Velika noč';
    map[iso(ey, em, ed + 1)] = 'Velikonočni ponedeljek';
    map[iso(ey, em, ed + 49)] = 'Binkošti';
    cache[year] = map;
    return map;
  }

  function holidayName(isoDate) {
    return getHolidays(+isoDate.slice(0, 4))[isoDate] || null;
  }

  const api = { easterSunday, getHolidays, holidayName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KSHolidays = api;
})(this);
