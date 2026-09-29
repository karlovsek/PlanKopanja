/* Sestava razporeda kopanja. Brez DOM – deluje v brskalniku (window.KSScheduler) in v Node. */
(function (root) {
  'use strict';

  const Holidays = (typeof module !== 'undefined' && module.exports)
    ? require('./holidays.js')
    : root.KSHolidays;

  const DAY_MS = 86400000;
  const LOOKAHEAD_DAYS = 4;
  const WEEKDAY_NAMES = ['nedelja', 'ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota'];

  // ---------- datumi (ISO nizi "YYYY-MM-DD", računano v UTC) ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function format(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function addDays(iso, n) { return format(parse(iso) + n * DAY_MS); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / DAY_MS); } // b - a
  function weekday(iso) { return new Date(parse(iso)).getUTCDay(); } // 0 = nedelja
  function monthKey(year, month) { return year + '-' + pad(month); }
  function monthDays(year, month) {
    const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const res = [];
    for (let d = 1; d <= n; d++) res.push(year + '-' + pad(month) + '-' + pad(d));
    return res;
  }
  function nDays(n) { const r = n % 100; return n + ' ' + (r === 1 ? 'dan' : r === 2 ? 'dneva' : (r === 3 || r === 4) ? 'dnevi' : 'dni'); }
  function shortDate(iso) { return (+iso.slice(8, 10)) + '. ' + (+iso.slice(5, 7)) + '.'; }

  // ---------- pravila ----------
  function intervalOf(p) { return Math.max(1, parseInt(p.intervalDays, 10) || 10); }
  const DEFAULT_CAPACITY = { weekday: 3, saturday: 1, sundayHoliday: 0 };

  function toCap(v, def) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
  }

  // Privzeta kapaciteta hodnika za vrsto dneva ('weekday' | 'saturday' | 'sundayHoliday').
  function defaultCapacity(corridor, kind) {
    const c = corridor.capacity || {};
    return toCap(c[kind], DEFAULT_CAPACITY[kind]);
  }

  function weekdayKind(wd) { return wd === 0 ? 'sundayHoliday' : wd === 6 ? 'saturday' : 'weekday'; }
  function dayKind(iso) { return Holidays.holidayName(iso) ? 'sundayHoliday' : weekdayKind(weekday(iso)); }

  // Kapaciteta dneva in ali je veljaven za kopanje (kapaciteta > 0); če ni, zakaj.
  // Ročna izjema (corridor.dayOverrides[iso]) ima prednost pred privzeto kapaciteto.
  function dayInfo(corridor, iso) {
    const holiday = Holidays.holidayName(iso);
    const overrides = corridor.dayOverrides || {};
    const override = Object.prototype.hasOwnProperty.call(overrides, iso);
    const capacity = override ? toCap(overrides[iso], 0) : defaultCapacity(corridor, dayKind(iso));
    let reason = null;
    if (capacity === 0) {
      if (override) reason = 'Izjema: ni kopanja';
      else if (holiday) reason = 'Praznik: ' + holiday;
      else reason = 'Ne kopa se (' + WEEKDAY_NAMES[weekday(iso)] + ')';
    }
    return { valid: capacity > 0, capacity, override, reason, holiday };
  }

  function capacityOn(corridor, iso) { return dayInfo(corridor, iso).capacity; }

  function personAllows(person, iso) {
    const a = person.allowedWeekdays || [];
    return a.length === 0 || a.includes(weekday(iso));
  }

  function isAvailable(corridor, person, iso) {
    return personAllows(person, iso) && dayInfo(corridor, iso).valid;
  }

  function nextAvailable(corridor, person, iso) {
    for (let i = 1; i <= 62; i++) {
      const d = addDays(iso, i);
      if (isAvailable(corridor, person, d)) return d;
    }
    return null;
  }

  // Težave pri razporeditvi `count` oseb na dan `iso` oziroma osebe `person` na ta dan (ali null).
  // Skupno za analizo razporeda in za opozorila ob ročnih popravkih.
  function dayIssue(corridor, iso, count) {
    const info = dayInfo(corridor, iso);
    if (!info.valid) return `${shortDate(iso)}: dan ni veljaven (${info.reason})`;
    if (count > info.capacity) return `${shortDate(iso)}: preveč razporejenih (${count} / ${info.capacity})`;
    return null;
  }
  function personDayIssue(person, iso) {
    return personAllows(person, iso) ? null : `${person.name}: ${shortDate(iso)} (${WEEKDAY_NAMES[weekday(iso)]}) ni dovoljen dan`;
  }

  // Ključ shranjenega razporeda; scheduleKey(id, '') je predpona vseh razporedov hodnika.
  function scheduleKey(corridorId, month) { return corridorId + '|' + month; }

  // Zadnje kopanje vsake osebe pred datumom `beforeIso` (iz shranjenih razporedov tega hodnika).
  // Prestara zadnja kopanja (več kot 2 × interval + 7 dni) se ne upoštevajo.
  function knownLastBaths(corridor, persons, schedules, beforeIso) {
    const last = {};
    const prefix = scheduleKey(corridor.id, '');
    Object.keys(schedules || {}).forEach(key => {
      if (key.indexOf(prefix) !== 0) return;
      const days = (schedules[key] && schedules[key].days) || {};
      Object.keys(days).forEach(d => {
        if (d >= beforeIso) return;
        (days[d] || []).forEach(pid => { if (!last[pid] || last[pid] < d) last[pid] = d; });
      });
    });
    const res = {};
    persons.forEach(p => {
      const l = last[p.id];
      if (l && diffDays(l, beforeIso) <= 2 * intervalOf(p) + 7) res[p.id] = l;
    });
    return res;
  }

  function byName(a, b) { return (a.name || '').localeCompare(b.name || '', 'sl'); }

  // ---------- sestava ----------
  function buildSchedule(corridor, persons, year, month, schedules) {
    const all = monthDays(year, month);
    const start = all[0];
    const active = persons.filter(p => p.corridorId === corridor.id && p.active !== false);
    const validDays = [];
    const cap = {};
    const days = {};
    all.forEach(d => {
      const c = capacityOn(corridor, d);
      if (c > 0) { validDays.push(d); cap[d] = c; days[d] = []; }
    });

    const allowedCount = {};
    active.forEach(p => { allowedCount[p.id] = validDays.filter(d => personAllows(p, d)).length; });

    // Roki: iz zgodovine ali enakomerno razporejeni v prvem intervalu meseca.
    const last = knownLastBaths(corridor, active, schedules, start);
    const due = {};
    const load = {};
    active.forEach(p => {
      if (last[p.id]) {
        due[p.id] = addDays(last[p.id], intervalOf(p));
        load[due[p.id]] = (load[due[p.id]] || 0) + 1;
      }
    });
    active.filter(p => !last[p.id])
      .sort((a, b) => allowedCount[a.id] - allowedCount[b.id] || byName(a, b))
      .forEach(p => {
        const windowEnd = addDays(start, intervalOf(p) - 1);
        const opts = validDays.filter(d => d <= windowEnd && personAllows(p, d));
        if (!opts.length) {
          due[p.id] = validDays.find(d => personAllows(p, d)) || start;
          return;
        }
        // Dan z najmanjšo zasedenostjo glede na kapaciteto.
        const fill = d => (load[d] || 0) / cap[d];
        let best = opts[0];
        opts.forEach(d => { if (fill(d) < fill(best)) best = d; });
        due[p.id] = best;
        load[best] = (load[best] || 0) + 1;
      });

    // Veljavni dnevi meseca + nekaj dni naslednjega meseca (za pogled naprej čez konec meseca).
    const horizon = validDays.slice();
    for (let i = 1; i <= 2 * LOOKAHEAD_DAYS; i++) {
      const d = addDays(all[all.length - 1], i);
      const c = capacityOn(corridor, d);
      if (c > 0) { horizon.push(d); cap[d] = c; }
    }

    // Pohlepno dan za dnem.
    validDays.forEach(d => {
      const cands = [];
      active.forEach(p => {
        if (!personAllows(p, d)) return;
        const late = diffDays(due[p.id], d);
        let ok = late >= 0;
        if (!ok) {
          // Prej, če bi bil naslednji možni dan po roku vsaj toliko, kot bi bili zdaj prezgodaj.
          const n = nextAvailable(corridor, p, d);
          if (n) {
            const lateThen = diffDays(due[p.id], n);
            ok = lateThen > 0 && lateThen >= -late;
          }
        }
        if (ok) cands.push({ p, late });
      });
      cands.sort((a, b) => b.late - a.late
        || allowedCount[a.p.id] - allowedCount[b.p.id]
        || byName(a.p, b.p));
      const taken = cands.slice(0, cap[d]).map(c => c.p);

      // Pogled naprej: če v naslednjih nekaj veljavnih dneh rokov ne bo mogoče pokriti s
      // kapaciteto, prosta mesta danes zapolni z osebami z najbližjim rokom (malo prej je
      // bolje kot zamuda).
      const free = cap[d] - taken.length;
      if (free > 0) {
        const idx = horizon.indexOf(d);
        const ahead = horizon.slice(idx + 1, idx + 1 + LOOKAHEAD_DAYS);
        const rest = active.filter(p => !taken.includes(p));
        let excess = 0;
        let slots = 0;
        ahead.forEach((day, j) => {
          slots += cap[day];
          const demand = rest.filter(p => due[p.id] <= day && ahead.slice(0, j + 1).some(x => personAllows(p, x))).length;
          excess = Math.max(excess, demand - slots);
        });
        if (excess > 0) {
          rest.filter(p => personAllows(p, d) && diffDays(d, due[p.id]) <= Math.max(1, Math.floor(intervalOf(p) / 5)))
            .sort((a, b) => (due[a.id] < due[b.id] ? -1 : due[a.id] > due[b.id] ? 1 : 0)
              || allowedCount[b.id] - allowedCount[a.id] || byName(a, b))
            .slice(0, Math.min(free, excess))
            .forEach(p => taken.push(p));
        }
      }

      taken.forEach(p => {
        days[d].push(p.id);
        due[p.id] = addDays(d, intervalOf(p));
      });
    });

    return { days, warnings: analyzeSchedule(corridor, persons, year, month, days, schedules) };
  }

  // ---------- analiza (tudi po ročnih popravkih) ----------
  // Vrne seznam { level: 'error'|'warn'|'info', text }.
  function analyzeSchedule(corridor, persons, year, month, days, schedules) {
    const warnings = [];
    const push = (level, text) => warnings.push({ level, text });
    const all = monthDays(year, month);
    const start = all[0];
    const mine = persons.filter(p => p.corridorId === corridor.id);
    const byId = {};
    mine.forEach(p => { byId[p.id] = p; });
    const active = mine.filter(p => p.active !== false);
    const cap = {};
    all.forEach(d => { cap[d] = capacityOn(corridor, d); });
    const validDays = all.filter(d => cap[d] > 0);

    // Kapaciteta skupaj.
    let needed = 0;
    active.forEach(p => { if (validDays.some(d => personAllows(p, d))) needed += all.length / intervalOf(p); });
    const slots = validDays.reduce((sum, d) => sum + cap[d], 0);
    if (Math.round(needed) > slots) {
      push('error', `Kapaciteta premajhna: potrebnih je približno ${Math.round(needed)} kopanj, ` +
        `v mesecu je na voljo le ${slots} mest.`);
    }

    // Osebe, vezane na en sam dan v tednu, lahko ta dan prenapolnijo.
    const perWeekday = {};
    active.forEach(p => {
      const a = p.allowedWeekdays || [];
      if (a.length === 1) perWeekday[a[0]] = (perWeekday[a[0]] || 0) + 7 / intervalOf(p);
    });
    Object.keys(perWeekday).forEach(wd => {
      const wdCap = defaultCapacity(corridor, weekdayKind(+wd));
      if (perWeekday[wd] > wdCap + 1e-9) {
        push('error', `Na dan ${WEEKDAY_NAMES[wd]} so vezane osebe, ki potrebujejo približno ` +
          `${Math.round(perWeekday[wd] * 10) / 10} mest na teden, kapaciteta je ${wdCap}.`);
      }
    });

    // Posamezni dnevi.
    Object.keys(days).sort().forEach(d => {
      const ids = days[d] || [];
      if (!ids.length) return;
      const issue = dayIssue(corridor, d, ids.length);
      if (issue) push('error', issue + '.');
      ids.forEach(id => {
        const p = byId[id];
        if (!p) return;
        const pIssue = personDayIssue(p, d);
        if (pIssue) push('error', pIssue + '.');
        if (p.active === false) push('warn', `${p.name}: ni aktivna, a je razporejena ${shortDate(d)}.`);
      });
    });

    // Posamezne osebe.
    const last = knownLastBaths(corridor, active, schedules, start);
    active.slice().sort(byName).forEach(p => {
      const iv = intervalOf(p);
      const avail = validDays.filter(d => personAllows(p, d));
      if (!avail.length) {
        push('error', `${p.name}: v tem mesecu nima nobenega veljavnega dneva.`);
        return;
      }
      const dates = Object.keys(days).filter(d => (days[d] || []).includes(p.id)).sort();
      let prev = last[p.id] || null;
      if (!dates.length && !prev) {
        push('warn', `${p.name}: v tem mesecu ni razporejena.`);
        return;
      }
      dates.forEach(d => {
        if (prev) {
          const gap = diffDays(prev, d);
          const dueD = addDays(prev, iv);
          if (gap > iv) {
            const forced = !avail.some(x => x >= dueD && x < d);
            if (forced) push('info', `${p.name}: ${shortDate(d)} – ${nDays(gap)} od prejšnjega kopanja (vmes ni bilo dovoljenega dneva).`);
            else push('warn', `${p.name}: ${shortDate(d)} – ${nDays(gap)} od prejšnjega kopanja (${nDays(gap - iv)} zamude).`);
          } else if (gap < Math.ceil(iv / 2)) {
            push('info', `${p.name}: ${shortDate(d)} – le ${nDays(gap)} po prejšnjem kopanju.`);
          }
        }
        prev = d;
      });
      if (prev) {
        const dueD = addDays(prev, iv);
        if (dueD <= avail[avail.length - 1]) {
          push('warn', `${p.name}: rok ${shortDate(dueD)} – do konca meseca ni več razporejena.`);
        }
      }
    });

    return warnings;
  }

  const api = {
    WEEKDAY_NAMES,
    addDays, diffDays, weekday, monthKey, monthDays, shortDate,
    DEFAULT_CAPACITY, defaultCapacity, dayKind, dayInfo, capacityOn,
    personAllows, isAvailable, intervalOf, byName,
    dayIssue, personDayIssue, scheduleKey,
    knownLastBaths, buildSchedule, analyzeSchedule
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KSScheduler = api;
})(this);
