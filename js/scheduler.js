/* Sestava razporeda kopanja. Brez DOM – deluje v brskalniku (window.KSScheduler) in v Node. */
(function (root) {
  'use strict';

  const Holidays = (typeof module !== 'undefined' && module.exports)
    ? require('./holidays.js')
    : root.KSHolidays;

  const DAY_MS = 86400000;
  const LOOKAHEAD_DAYS = 4;
  const MAX_ABSENCE_DAYS = 366; // najdaljše obdobje odsotnosti, vneseno naenkrat v obrazcu osebe
  const BLOCKED_KEEP_DAYS = 400; // omejitve, starejše od toliko dni, se izbrišejo
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
  // Vsi datumi od `from` do `to` (vključno); [] če to < from.
  function dateRange(from, to) {
    const res = [];
    for (let d = from; d <= to; d = addDays(d, 1)) res.push(d);
    return res;
  }
  // Urejen seznam datumov → zaporedna obdobja [{ from, to }].
  function groupDateRanges(dates) {
    const res = [];
    dates.forEach(d => {
      const prev = res[res.length - 1];
      if (prev && diffDays(prev.to, d) === 1) prev.to = d;
      else res.push({ from: d, to: d });
    });
    return res;
  }
  // Iz oseb odstrani blockedDates pred `beforeIso` (spremeni objekte). Vrne število odstranjenih datumov.
  function pruneBlockedDates(persons, beforeIso) {
    let removed = 0;
    persons.forEach(p => {
      if (!p.blockedDates) return;
      const keep = p.blockedDates.filter(d => d >= beforeIso);
      removed += p.blockedDates.length - keep.length;
      if (keep.length < p.blockedDates.length) p.blockedDates = keep;
    });
    return removed;
  }

  // ---------- pravila ----------
  const DEFAULT_INTERVAL = 10;
  function intervalOf(p) { return Math.max(1, parseInt(p.intervalDays, 10) || DEFAULT_INTERVAL); }
  // Zadnje kopanje, starejše od tega števila dni pred začetkom meseca, se ne upošteva.
  function historyLimit(p) { return 2 * intervalOf(p) + 7; }
  // Pogled naprej: koliko dni pred rokom je oseba lahko razporejena prej.
  function pullForwardDays(p) { return Math.max(1, Math.floor(intervalOf(p) / 5)); }
  // Razmik, krajši od tega, je »le N dni po prejšnjem kopanju«.
  function shortGap(p) { return Math.ceil(intervalOf(p) / 2); }
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

  // Omejitev: dan, ko se oseba ne more kopati (person.blockedDates).
  function personBlocked(person, iso) { return (person.blockedDates || []).includes(iso); }

  function personAllows(person, iso) {
    const a = person.allowedWeekdays || [];
    return (a.length === 0 || a.includes(weekday(iso))) && !personBlocked(person, iso);
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
    if (personBlocked(person, iso)) return `${person.name}: ${shortDate(iso)} se ne more kopati (omejitev)`;
    return personAllows(person, iso) ? null : `${person.name}: ${shortDate(iso)} (${WEEKDAY_NAMES[weekday(iso)]}) ni dovoljen dan`;
  }

  // Ključ shranjenega razporeda; scheduleKey(id, '') je predpona vseh razporedov hodnika.
  function scheduleKey(corridorId, month) { return corridorId + '|' + month; }

  // ('2026-12', 1) → '2027-01'; n je lahko negativen.
  function addMonths(month, n) {
    const [y, m] = month.split('-').map(Number);
    const idx = y * 12 + (m - 1) + n;
    return monthKey(Math.floor(idx / 12), idx % 12 + 1);
  }
  // '2026-01' → '2025-12'
  function prevMonth(month) { return addMonths(month, -1); }
  // Meseci (YYYY-MM) shranjenih razporedov hodnika.
  function corridorMonths(schedules, corridorId) {
    const prefix = scheduleKey(corridorId, '');
    return Object.keys(schedules || {}).filter(k => k.indexOf(prefix) === 0).map(k => k.slice(prefix.length));
  }
  // Ključi razporedov hodnika za mesece, kasnejše od `month` (urejeni).
  function laterScheduleKeys(schedules, corridorId, month) {
    return corridorMonths(schedules, corridorId).filter(mo => mo > month).sort()
      .map(mo => scheduleKey(corridorId, mo));
  }
  // Ali obstaja razpored hodnika za kak mesec pred `month`.
  function hasEarlierSchedule(schedules, corridorId, month) {
    return corridorMonths(schedules, corridorId).some(mo => mo < month);
  }

  // Zadnje kopanje vsake osebe pred datumom `beforeIso` iz shranjenih razporedov vseh hodnikov (oseba je lahko
  // medtem premeščena). Prestara zadnja kopanja (več kot 2 × interval + 7 dni) se ne upoštevajo.
  function knownLastBaths(persons, schedules, beforeIso) {
    const last = {};
    Object.keys(schedules || {}).forEach(key => {
      const days = (schedules[key] && schedules[key].days) || {};
      Object.keys(days).forEach(d => {
        if (d >= beforeIso) return;
        (days[d] || []).forEach(pid => { if (!last[pid] || last[pid] < d) last[pid] = d; });
      });
    });
    const res = {};
    persons.forEach(p => {
      const l = last[p.id];
      if (l && diffDays(l, beforeIso) <= historyLimit(p)) res[p.id] = l;
    });
    return res;
  }

  // Iz razporedov hodnika `corridorId` odstrani termine osebe z datumom >= `fromIso`; spremenjenim razporedom
  // nastavi edited = true. Vrne število odstranjenih terminov.
  function removeFutureBaths(schedules, corridorId, personId, fromIso) {
    let removed = 0;
    corridorMonths(schedules, corridorId).forEach(mo => {
      const s = schedules[scheduleKey(corridorId, mo)];
      const days = s.days || {};
      Object.keys(days).forEach(d => {
        if (d < fromIso || !days[d].includes(personId)) return;
        unschedule(s, d, personId);
        removed++;
        s.edited = true;
      });
    });
    return removed;
  }

  // Zaklenjeni termini (sched.locked: { datum: [personId] }) se ob ponovni sestavi ohranijo. Vsak zaklenjen termin
  // je tudi v sched.days.
  function isLocked(sched, d, id) {
    return !!(sched && sched.locked && (sched.locked[d] || []).includes(id));
  }
  // Zaklene (on = true) ali odklene termin; prazni dnevi in prazno polje locked se pobrišejo.
  function setLocked(sched, d, id, on) {
    const locked = sched.locked || {};
    const ids = (locked[d] || []).filter(x => x !== id);
    if (on) ids.push(id);
    if (ids.length) locked[d] = ids;
    else delete locked[d];
    if (Object.keys(locked).length) sched.locked = locked;
    else delete sched.locked;
  }
  // Odstrani termin osebe na dan `d` skupaj z morebitnim zaklepom.
  function unschedule(sched, d, id) {
    if (sched.days[d]) sched.days[d] = sched.days[d].filter(x => x !== id);
    setLocked(sched, d, id, false);
  }

  // Razmiki med zaporednimi kopanji osebe: [{ days, fromPrev, level }]; prvi je od `prevIso` (če je podan).
  // level: 'late' (daljši od intervala), 'short' (krajši od shortGap), null.
  function bathGaps(person, prevIso, dates) {
    const iv = intervalOf(person);
    const res = [];
    let prev = prevIso || null;
    dates.forEach(d => {
      if (prev) {
        const days = diffDays(prev, d);
        const level = days > iv ? 'late' : days < shortGap(person) ? 'short' : null;
        res.push({ days, fromPrev: !!prevIso && !res.length, level });
      }
      prev = d;
    });
    return res;
  }

  function byName(a, b) { return (a.name || '').localeCompare(b.name || '', 'sl'); }

  // ---------- sestava ----------
  // Začetek delne sestave: `from`, če je v mesecu in ni njegov prvi dan, sicer null (cel mesec).
  function buildStart(year, month, from) {
    const all = monthDays(year, month);
    return from > all[0] && from <= all[all.length - 1] ? from : null;
  }

  // opts.fixed: zaklenjeni termini meseca ({ datum: [personId] }), ki ostanejo na mestu.
  // opts.from: sestavi le dneve od tega datuma naprej; prejšnji dnevi se prepišejo iz shranjenega razporeda
  // (neveljaven ali prvi dan meseca = cel mesec).
  function buildSchedule(corridor, persons, year, month, schedules, opts) {
    opts = opts || {};
    const all = monthDays(year, month);
    const start = buildStart(year, month, opts.from) || all[0];
    const active = persons.filter(p => p.corridorId === corridor.id && p.active !== false);
    const validDays = [];
    const cap = {};
    const days = {};
    // Dnevi pred začetkom sestave ostanejo, kot so (tudi premeščene ali neaktivne osebe).
    const old = (schedules || {})[scheduleKey(corridor.id, monthKey(year, month))];
    const oldDays = (old && old.days) || {};
    all.forEach(d => {
      const c = capacityOn(corridor, d);
      if (c > 0) { validDays.push(d); cap[d] = c; days[d] = []; }
      if (d < start && oldDays[d]) days[d] = oldDays[d].slice();
    });
    const buildDays = validDays.filter(d => d >= start);

    // Zaklenjeni termini: le dnevi tega meseca in aktivne osebe hodnika, brez podvojitev. Pred začetkom sestave
    // ostane zaklep le terminom, ki so ohranjeni.
    const fixed = opts.fixed || {};
    const activeById = new Map(active.map(p => [p.id, p]));
    const locked = {};
    const lockDates = {};
    all.forEach(d => {
      const keep = d < start ? (id => (days[d] || []).includes(id)) : (id => activeById.has(id));
      const ids = Array.from(new Set(fixed[d] || [])).filter(keep);
      if (!ids.length) return;
      locked[d] = ids;
      if (d >= start) ids.forEach(id => { (lockDates[id] = lockDates[id] || []).push(d); });
    });
    // Oseba počaka na zaklenjen termin, če bi bilo kopanje na dan `d` preblizu njemu.
    const waitsForLock = (p, d) => (lockDates[p.id] || []).some(f => f > d && diffDays(d, f) < shortGap(p));
    // Ali ima oseba zaklenjen termin v obdobju (from, to].
    const lockedBetween = (p, from, to) => (lockDates[p.id] || []).some(f => f > from && f <= to);

    const allowedCount = {};
    active.forEach(p => { allowedCount[p.id] = validDays.filter(d => personAllows(p, d)).length; });

    // Roki: iz zgodovine (tudi ohranjenih dni tega meseca) ali enakomerno razporejeni v prvem intervalu od začetka
    // sestave.
    const last = knownLastBaths(active, schedules, start);
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
        const choices = buildDays.filter(d => d <= windowEnd && personAllows(p, d));
        if (!choices.length) {
          due[p.id] = buildDays.find(d => personAllows(p, d)) || start;
          return;
        }
        // Dan z najmanjšo zasedenostjo glede na kapaciteto.
        const fill = d => (load[d] || 0) / cap[d];
        let best = choices[0];
        choices.forEach(d => { if (fill(d) < fill(best)) best = d; });
        due[p.id] = best;
        load[best] = (load[best] || 0) + 1;
      });

    // Veljavni dnevi sestave + nekaj dni naslednjega meseca (za pogled naprej čez konec meseca).
    const horizon = buildDays.slice();
    for (let i = 1; i <= 2 * LOOKAHEAD_DAYS; i++) {
      const d = addDays(all[all.length - 1], i);
      const c = capacityOn(corridor, d);
      if (c > 0) { horizon.push(d); cap[d] = c; }
    }

    // Pohlepno dan za dnem. Zaklenjen termin se vpiše tudi na dan brez kopanja (napako pokaže analiza).
    all.filter(d => d >= start && (cap[d] > 0 || locked[d])).forEach(d => {
      if (!days[d]) days[d] = [];
      const fixedHere = (locked[d] || []).map(id => activeById.get(id));
      const cands = [];
      active.forEach(p => {
        if (!personAllows(p, d) || fixedHere.includes(p) || waitsForLock(p, d)) return;
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
      // Zaklenjeni najprej, preostala mesta kandidatom.
      const taken = fixedHere.concat(cands.slice(0, Math.max(0, (cap[d] || 0) - fixedHere.length)).map(c => c.p));

      // Pogled naprej: če v naslednjih nekaj veljavnih dneh rokov ne bo mogoče pokriti s
      // kapaciteto, prosta mesta danes zapolni z osebami z najbližjim rokom (malo prej je
      // bolje kot zamuda). Zaklenjeni termini v prihodnjih dneh so že zasedena mesta, njihove osebe pa niso
      // v povpraševanju.
      const free = (cap[d] || 0) - taken.length;
      if (free > 0) {
        const idx = horizon.indexOf(d);
        const ahead = horizon.slice(idx + 1, idx + 1 + LOOKAHEAD_DAYS);
        const rest = active.filter(p => !taken.includes(p));
        let excess = 0;
        let slots = 0;
        ahead.forEach((day, j) => {
          slots += cap[day] - (locked[day] || []).length;
          const demand = rest.filter(p => due[p.id] <= day
            && ahead.slice(0, j + 1).some(x => personAllows(p, x))
            && !lockedBetween(p, d, day)).length;
          excess = Math.max(excess, demand - slots);
        });
        if (excess > 0) {
          rest.filter(p => personAllows(p, d) && !waitsForLock(p, d) && diffDays(d, due[p.id]) <= pullForwardDays(p))
            .sort((a, b) => (due[a.id] < due[b.id] ? -1 : due[a.id] > due[b.id] ? 1 : 0)
              || allowedCount[b.id] - allowedCount[a.id] || byName(a, b))
            .slice(0, Math.min(free, excess))
            .forEach(p => taken.push(p));
        }
      }

      // Rok se šteje od zadnjega kopanja, tudi zaklenjenega.
      taken.forEach(p => {
        days[d].push(p.id);
        due[p.id] = addDays(d, intervalOf(p));
      });
    });

    return { days, locked, warnings: analyzeSchedule(corridor, persons, year, month, days, schedules) };
  }

  // Privzeti začetek sestave za mesec `month` ('YYYY-MM'): jutri, če je `today` v tem mesecu in jutri še ni
  // naslednji mesec, sicer '' (cel mesec).
  function defaultBuildFrom(month, today) {
    if (!today || today.slice(0, 7) !== month) return '';
    const next = addDays(today, 1);
    return next.slice(0, 7) === month ? next : '';
  }

  // ---------- analiza (tudi po ročnih popravkih) ----------
  // Vrne seznam { level: 'error'|'warn'|'info', text, date?, personId? } (date/personId: dan oz. oseba, na katero se
  // opozorilo nanaša).
  function analyzeSchedule(corridor, persons, year, month, days, schedules) {
    const warnings = [];
    const push = (level, text, extra) => warnings.push(Object.assign({ level, text }, extra));
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
      if (issue) push('error', issue + '.', { date: d });
      ids.forEach(id => {
        const p = byId[id];
        if (!p) return;
        const at = { date: d, personId: p.id };
        const pIssue = personDayIssue(p, d);
        if (pIssue) push('error', pIssue + '.', at);
        if (p.active === false) push('warn', `${p.name}: ni aktivna, a je razporejena ${shortDate(d)}.`, at);
      });
    });

    // Posamezne osebe.
    const last = knownLastBaths(active, schedules, start);
    active.slice().sort(byName).forEach(p => {
      const iv = intervalOf(p);
      const avail = validDays.filter(d => personAllows(p, d));
      if (!avail.length) {
        push('error', `${p.name}: v tem mesecu nima nobenega veljavnega dneva.`, { personId: p.id });
        return;
      }
      const dates = Object.keys(days).filter(d => (days[d] || []).includes(p.id)).sort();
      let prev = last[p.id] || null;
      if (!dates.length && !prev) {
        push('warn', `${p.name}: v tem mesecu ni razporejena.`, { personId: p.id });
        return;
      }
      dates.forEach(d => {
        if (prev) {
          const at = { date: d, personId: p.id };
          const gap = diffDays(prev, d);
          const dueD = addDays(prev, iv);
          if (gap > iv) {
            // Rok je lahko še v prejšnjem mesecu, zato se dnevi preverijo po koledarju, ne le v tem mesecu.
            let forced = true;
            for (let x = dueD; x < d && forced; x = addDays(x, 1)) forced = !isAvailable(corridor, p, x);
            if (forced) push('info', `${p.name}: ${shortDate(d)} – ${nDays(gap)} od prejšnjega kopanja (vmes ni bilo dovoljenega dneva).`, at);
            else push('warn', `${p.name}: ${shortDate(d)} – ${nDays(gap)} od prejšnjega kopanja (${nDays(gap - iv)} zamude).`, at);
          } else if (gap < shortGap(p)) {
            push('info', `${p.name}: ${shortDate(d)} – le ${nDays(gap)} po prejšnjem kopanju.`, at);
          }
        }
        prev = d;
      });
      if (prev) {
        const dueD = addDays(prev, iv);
        if (dueD <= avail[avail.length - 1]) {
          push('warn', `${p.name}: rok ${shortDate(dueD)} – do konca meseca ni več razporejena.`, { personId: p.id });
        }
      }
    });

    return warnings;
  }

  const api = {
    WEEKDAY_NAMES, LOOKAHEAD_DAYS,
    addDays, diffDays, weekday, monthKey, monthDays, shortDate, nDays,
    MAX_ABSENCE_DAYS, dateRange, groupDateRanges, BLOCKED_KEEP_DAYS, pruneBlockedDates,
    DEFAULT_CAPACITY, defaultCapacity, dayKind, dayInfo, capacityOn,
    personAllows, personBlocked, isAvailable, byName,
    DEFAULT_INTERVAL, intervalOf, historyLimit, pullForwardDays, shortGap, bathGaps,
    dayIssue, personDayIssue, scheduleKey, addMonths, prevMonth,laterScheduleKeys, hasEarlierSchedule,
    knownLastBaths, removeFutureBaths, isLocked, setLocked, unschedule, buildStart, buildSchedule, defaultBuildFrom, analyzeSchedule
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KSScheduler = api;
})(this);
