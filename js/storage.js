/* Shranjevanje stanja v localStorage + izvoz/uvoz JSON. */
(function (root) {
  'use strict';

  const KEY = 'kopalniSeznam.v1';

  function empty() {
    return { version: 1, corridors: [], persons: [], schedules: {}, ui: {} };
  }

  // Starejši format (capacityPerDay, excludedWeekdays, skipHolidays, extraExcludedDates)
  // → kapaciteta po vrsti dneva + izjeme po datumih.
  function normalizeCorridor(c) {
    if (c.capacity && c.dayOverrides) return c;
    const out = Object.assign({}, c);
    if (!out.capacity) {
      const per = parseInt(c.capacityPerDay, 10);
      const excl = c.excludedWeekdays || [];
      out.capacity = Number.isFinite(per)
        ? {
            weekday: per,
            saturday: excl.includes(6) ? 0 : per,
            sundayHoliday: (excl.includes(0) || c.skipHolidays !== false) ? 0 : per
          }
        : Object.assign({}, root.KSScheduler.DEFAULT_CAPACITY);
    }
    if (!out.dayOverrides) {
      out.dayOverrides = {};
      (c.extraExcludedDates || []).forEach(d => { out.dayOverrides[d] = 0; });
    }
    ['capacityPerDay', 'excludedWeekdays', 'skipHolidays', 'extraExcludedDates'].forEach(k => delete out[k]);
    return out;
  }

  function normalize(s) {
    if (!s || typeof s !== 'object') return empty();
    return {
      version: 1,
      corridors: Array.isArray(s.corridors) ? s.corridors.map(normalizeCorridor) : [],
      persons: Array.isArray(s.persons) ? s.persons : [],
      schedules: (s.schedules && typeof s.schedules === 'object') ? s.schedules : {},
      ui: (s.ui && typeof s.ui === 'object') ? s.ui : {}
    };
  }

  function load() {
    try {
      const raw = root.localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : empty();
    } catch (e) {
      console.error('Napaka pri nalaganju podatkov', e);
      return empty();
    }
  }

  function save(state) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Napaka pri shranjevanju podatkov', e);
      return false;
    }
  }

  function exportJSON(state) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kopalni-seznam-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Prebere izbrano datoteko in vrne Promise z normaliziranim stanjem.
  function importFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Datoteke ni mogoče prebrati.'));
      reader.onload = () => {
        let data;
        try { data = JSON.parse(reader.result); } catch (e) {
          reject(new Error('Datoteka ni veljaven JSON.'));
          return;
        }
        if (!data || !Array.isArray(data.corridors) || !Array.isArray(data.persons)) {
          reject(new Error('Datoteka ne vsebuje podatkov Kopalnega seznama.'));
          return;
        }
        resolve(normalize(data));
      };
      reader.readAsText(file);
    });
  }

  root.KSStorage = { KEY, empty, load, save, exportJSON, importFile };
})(this);
