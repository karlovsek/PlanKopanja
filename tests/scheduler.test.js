/* Testi za scheduler in praznike. Zagon: `node tests/scheduler.test.js` ali odpri tests/scheduler.test.html. */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const H = isNode ? require('../js/holidays.js') : root.KSHolidays;
  const S = isNode ? require('../js/scheduler.js') : root.KSScheduler;
  const Csv = isNode ? require('../js/csv.js') : root.KSCsv;
  const Rules = isNode ? require('../js/rules.js') : root.KSRules;

  const results = [];
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: e.message }); }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert'); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ` pričakovano ${JSON.stringify(b)}, dobljeno ${JSON.stringify(a)}`); }

  function corridor(extra) {
    return Object.assign({ id: 'c1', name: 'A', capacity: { weekday: 2, saturday: 2, sundayHoliday: 0 }, dayOverrides: {} }, extra || {});
  }
  function makePersons(n, extra) {
    const res = [];
    for (let i = 0; i < n; i++) {
      res.push(Object.assign({ id: 'p' + i, corridorId: 'c1', name: 'Oseba ' + String(i).padStart(2, '0'), intervalDays: 10, allowedWeekdays: [], active: true }, extra || {}));
    }
    return res;
  }
  function datesOf(days, pid) { return Object.keys(days).filter(d => days[d].includes(pid)).sort(); }

  // ---------- prazniki ----------
  test('Velika noč', () => {
    eq(H.easterSunday(2024), '2024-03-31');
    eq(H.easterSunday(2026), '2026-04-05');
    eq(H.easterSunday(2027), '2027-03-28');
  });
  test('Velikonočni ponedeljek in fiksni prazniki', () => {
    eq(H.holidayName('2027-03-29'), 'Velikonočni ponedeljek');
    eq(H.holidayName('2026-04-06'), 'Velikonočni ponedeljek');
    eq(H.holidayName('2026-11-01'), 'Dan spomina na mrtve');
    eq(H.holidayName('2026-12-25'), 'Božič');
    eq(H.holidayName('2026-10-31'), 'Dan reformacije');
    eq(H.holidayName('2026-10-30'), null);
  });

  // ---------- razpored ----------
  const c = corridor();
  const persons = makePersons(11).concat([{ id: 'tue', corridorId: 'c1', name: 'Torkova', intervalDays: 7, allowedWeekdays: [2], active: true }]);
  const oct = S.buildSchedule(c, persons, 2026, 10, {});
  const schedules = { 'c1|2026-10': { days: oct.days } };
  const nov = S.buildSchedule(c, persons, 2026, 11, schedules);
  schedules['c1|2026-11'] = { days: nov.days };
  const dec = S.buildSchedule(c, persons, 2026, 12, schedules);

  test('Kapaciteta nikoli presežena', () => {
    [oct, nov, dec].forEach(r => Object.keys(r.days).forEach(d => assert(r.days[d].length <= S.capacityOn(c, d), d + ' ima ' + r.days[d].length)));
  });
  test('Privzete kapacitete: med tednom 3, sobota 1, nedelja/praznik 0', () => {
    const def = { id: 'c1', name: 'A' };
    eq(S.capacityOn(def, '2026-10-07'), 3, 'sreda');
    eq(S.capacityOn(def, '2026-10-10'), 1, 'sobota');
    eq(S.capacityOn(def, '2026-10-11'), 0, 'nedelja');
    eq(S.capacityOn(def, '2026-12-25'), 0, 'božič (petek)');
    const r = S.buildSchedule(def, makePersons(20), 2026, 10, {});
    Object.keys(r.days).forEach(d => assert(r.days[d].length <= S.capacityOn(def, d), d));
    eq(r.days['2026-10-10'].length, 1, 'sobota 10. 10.');
  });
  test('Torkova samo ob torkih, vsak torek', () => {
    const ds = datesOf(oct.days, 'tue');
    ds.forEach(d => eq(S.weekday(d), 2, d));
    eq(ds.length, 4, 'torki v oktobru 2026: ');
  });
  test('Nedelje in prazniki brez kopanja', () => {
    [oct, nov, dec].forEach(r => Object.keys(r.days).forEach(d => {
      assert(S.weekday(d) !== 0, 'nedelja ' + d);
      assert(!H.holidayName(d), 'praznik ' + d);
    }));
    assert(!oct.days['2026-10-31'], '31. 10.');
    assert(!dec.days['2026-12-25'], '25. 12.');
    const mar = S.buildSchedule(c, persons, 2027, 3, {});
    assert(!mar.days['2027-03-29'], 'Velikonočni ponedeljek');
  });
  test('Razmik med kopanji ≈ interval (tudi čez mesec)', () => {
    const all = Object.assign({}, oct.days, nov.days, dec.days);
    persons.filter(p => p.id !== 'tue').forEach(p => {
      const ds = datesOf(all, p.id);
      assert(ds.length >= 8, p.name + ' ima le ' + ds.length + ' kopanj');
      for (let i = 1; i < ds.length; i++) {
        const gap = S.diffDays(ds[i - 1], ds[i]);
        assert(gap >= 8 && gap <= 12, `${p.name}: razmik ${gap} (${ds[i - 1]} → ${ds[i]})`);
      }
    });
  });
  test('Brez opozoril, ko je kapacitete dovolj', () => {
    const bad = oct.warnings.concat(nov.warnings).filter(w => w.level !== 'info');
    eq(bad.length, 0, JSON.stringify(bad));
  });
  test('Opozorilo pri premajhni kapaciteti', () => {
    const r = S.buildSchedule(corridor({ capacity: { weekday: 1, saturday: 1, sundayHoliday: 0 } }), makePersons(20), 2026, 10, {});
    const capW = r.warnings.find(w => w.level === 'error' && /Kapaciteta premajhna/.test(w.text));
    assert(capW, 'kapaciteta');
    assert(!('personId' in capW) && !('date' in capW), 'splošno opozorilo brez osebe in dneva');
    assert(r.warnings.some(w => /zamude|ni razporejena/.test(w.text)));
  });
  test('Opozorilo, ko je na en dan v tednu vezanih preveč oseb', () => {
    const p = makePersons(3, { allowedWeekdays: [2], intervalDays: 7 });
    const r = S.buildSchedule(c, p, 2026, 10, {});
    assert(r.warnings.some(w => w.level === 'error' && /torek/.test(w.text)));
  });
  test('Oseba brez veljavnega dneva', () => {
    const p = [{ id: 'x', corridorId: 'c1', name: 'Nedeljski', intervalDays: 7, allowedWeekdays: [0], active: true }];
    const r = S.buildSchedule(c, p, 2026, 10, {});
    eq(Object.values(r.days).flat().length, 0);
    assert(r.warnings.some(w => /nobenega veljavnega dneva/.test(w.text)));
  });
  test('Neaktivne osebe se ne razporedijo', () => {
    const p = makePersons(3);
    p[1].active = false;
    const r = S.buildSchedule(c, p, 2026, 10, {});
    eq(Object.values(r.days).flat().includes('p1'), false);
  });
  test('Analiza zazna ročne napake', () => {
    const days = { '2026-10-05': ['p0', 'p1', 'p2'], '2026-10-04': ['tue'] };
    const w = S.analyzeSchedule(c, persons, 2026, 10, days, {}).map(x => x.text).join('\n');
    assert(w.includes('preveč razporejenih (3 / 2)'), 'kapaciteta');
    assert(/ni veljaven/.test(w), 'nedelja');
    assert(/ni dovoljen dan/.test(w), 'torek');
  });
  test('Opozorila imajo dan in osebo', () => {
    const days = { '2026-10-05': ['p0', 'p1', 'p2'], '2026-10-04': ['tue'] };
    const w = S.analyzeSchedule(c, persons, 2026, 10, days, {});
    const over = w.find(x => /preveč razporejenih/.test(x.text));
    eq(over.date, '2026-10-05');
    assert(!('personId' in over), 'dan brez osebe');
    const tue = w.find(x => /ni dovoljen dan/.test(x.text));
    eq(tue.date, '2026-10-04');
    eq(tue.personId, 'tue');
    const missing = w.find(x => /ni razporejena/.test(x.text));
    assert(missing && missing.personId && !('date' in missing), JSON.stringify(missing));
    const due = w.find(x => /do konca meseca/.test(x.text));
    assert(due && due.personId && !('date' in due), JSON.stringify(due));
  });
  test('Ročne izjeme po dnevih', () => {
    const c2 = corridor({ dayOverrides: { '2026-10-15': 0, '2026-10-18': 1, '2026-10-20': 4 } });
    eq(S.dayInfo(c2, '2026-10-15').reason, 'Izjema: ni kopanja');
    eq(S.capacityOn(c2, '2026-10-18'), 1, 'nedelja z izjemo');
    const r = S.buildSchedule(c2, makePersons(30), 2026, 10, {});
    assert(!r.days['2026-10-15'], '15. 10. izključen');
    eq(r.days['2026-10-18'].length, 1, 'nedelja 18. 10.');
    eq(r.days['2026-10-20'].length, 4, 'torek 20. 10.');
  });

  // ---------- omejitve oseb po datumih ----------
  test('personAllows upošteva blokirane datume', () => {
    const p = { id: 'b', name: 'B', allowedWeekdays: [], blockedDates: ['2026-10-14'] };
    eq(S.personAllows(p, '2026-10-14'), false, 'blokiran');
    eq(S.personAllows(p, '2026-10-15'), true, 'drug dan');
    eq(S.personAllows({ id: 'x', name: 'X' }, '2026-10-14'), true, 'brez polja');
  });
  test('Oseba z omejitvijo ni razporejena na blokiran dan', () => {
    const base = S.buildSchedule(c, makePersons(11), 2026, 10, {});
    const first = datesOf(base.days, 'p0');
    const p = makePersons(11);
    p[0].blockedDates = first.slice(0, 2);
    const r = S.buildSchedule(c, p, 2026, 10, {});
    const ds = datesOf(r.days, 'p0');
    p[0].blockedDates.forEach(d => assert(!ds.includes(d), 'razporejena na blokiran ' + d));
    assert(Math.abs(S.diffDays(first[0], ds[0])) <= 2, `sosednji dan: ${first[0]} → ${ds[0]}`);
    const bad = r.warnings.filter(w => w.level !== 'info' && w.text.indexOf(p[0].name) === 0);
    eq(bad.length, 0, JSON.stringify(bad));
  });
  test('dateRange vrne vse datume obdobja (tudi čez mesec)', () => {
    eq(JSON.stringify(S.dateRange('2026-10-30', '2026-11-02')),
      JSON.stringify(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']), 'čez mesec');
    eq(S.dateRange('2026-10-05', '2026-10-05').length, 1, 'en dan');
    eq(S.dateRange('2026-10-05', '2026-10-04').length, 0, 'obrnjeno');
  });
  test('groupDateRanges združi zaporedne datume v obdobja', () => {
    eq(JSON.stringify(S.groupDateRanges(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-07'])),
      JSON.stringify([{ from: '2026-10-01', to: '2026-10-03' }, { from: '2026-10-07', to: '2026-10-07' }]));
    eq(JSON.stringify(S.groupDateRanges(['2026-10-31', '2026-11-01'])),
      JSON.stringify([{ from: '2026-10-31', to: '2026-11-01' }]), 'čez mesec');
    eq(S.groupDateRanges([]).length, 0, 'prazno');
  });
  test('pruneBlockedDates odstrani le omejitve pred mejo', () => {
    const a = { id: 'a', blockedDates: ['2025-01-01', '2026-10-01', '2026-10-12'] };
    const b = { id: 'b' };
    const cDates = ['2026-10-05'];
    const cp = { id: 'c', blockedDates: cDates };
    eq(S.pruneBlockedDates([a, b, cp], '2026-10-01'), 1, 'število odstranjenih');
    eq(JSON.stringify(a.blockedDates), JSON.stringify(['2026-10-01', '2026-10-12']), 'datum = meja ostane');
    assert(!('blockedDates' in b), 'oseba brez polja ostane brez');
    assert(cp.blockedDates === cDates, 'nespremenjeno polje ostane isto');
  });
  test('Oseba z odsotnostjo od–do v tem obdobju ni razporejena', () => {
    const p = makePersons(11);
    p[0].blockedDates = S.dateRange('2026-10-05', '2026-10-18');
    const r = S.buildSchedule(c, p, 2026, 10, {});
    const ds = datesOf(r.days, 'p0');
    assert(ds.length > 0, 'oseba je razporejena izven obdobja');
    ds.forEach(d => assert(!p[0].blockedDates.includes(d), 'razporejena v odsotnosti ' + d));
  });
  test('Analiza zazna ročno postavitev na blokiran dan', () => {
    const p = makePersons(1);
    p[0].blockedDates = ['2026-10-14'];
    const w = S.analyzeSchedule(c, p, 2026, 10, { '2026-10-14': ['p0'] }, {});
    assert(w.some(x => x.level === 'error' && /se ne more kopati/.test(x.text)), JSON.stringify(w));
  });

  // ---------- uvoz seznama oseb ----------
  test('Uvoz: CSV z glavo Soba,Priimek in ime', () => {
    const r = Csv.parsePersons('﻿Soba,Priimek in ime\r\n202,NOVAK JANEZ\r\n\r\n207,KRANJC ROZA  MARIJA\r\n');
    eq(r.persons.length, 2);
    eq(r.persons[0].room, '202');
    eq(r.persons[0].name, 'NOVAK JANEZ');
    eq(r.persons[1].name, 'KRANJC ROZA MARIJA', 'odvečni presledki');
    eq(r.bad.length, 0);
  });

  test('Uvoz: tabulatorji (Excel), podpičja, narekovaji, stolpci po glavi', () => {
    eq(Csv.parsePersons('Ime\tSoba\nNovak Janez\t12').persons[0].room, '12', 'glava določa vrstni red');
    eq(Csv.parsePersons('3;Horvat Ana').persons[0].name, 'Horvat Ana', 'podpičje, brez glave');
    eq(Csv.parsePersons('"5","Zupan, Marko"').persons[0].name, 'Zupan, Marko', 'vejica v narekovajih');
    eq(Csv.parsePersons('Samo Ime').persons[0].room, '', 'en stolpec = ime');
    const r = Csv.parsePersons('Soba,Ime,Opomba\n4,,x\n5,Kos Eva,voziček');
    eq(r.bad.length, 1, 'vrstica brez imena');
    eq(r.persons[0].note, 'voziček');
  });

  test('Uvoz: ločilo velja za ves seznam (podpičje v opombi CSV z vejicami)', () => {
    const r = Csv.parsePersons('Soba,Ime,Opomba\n5,Kos Eva,voziček; pomoč\n6,"Zupan; Marko",');
    eq(r.persons[0].name, 'Kos Eva');
    eq(r.persons[0].room, '5');
    eq(r.persons[0].note, 'voziček; pomoč');
    eq(r.persons[1].name, 'Zupan; Marko', 'podpičje v narekovajih');
    eq(Csv.parsePersons('Priimek in ime\nNovak, Janez').persons[0].name, 'Novak, Janez', 'glava z enim stolpcem');
  });

  test('Uvoz: ločena stolpca Priimek in Ime, glava pod naslovom, »Št. sobe«', () => {
    const r = Csv.parsePersons('Soba;Priimek;Ime\n202;Novak;Janez\n202;Novak;Marija');
    eq(r.persons.map(p => p.name).join('|'), 'Novak Janez|Novak Marija');
    const t = Csv.parsePersons('Seznam stanovalcev\t\nIme in priimek\tŠt. sobe\nNOVAK JANEZ\t202');
    eq(t.persons.length, 1, 'naslov ni oseba');
    eq(t.persons[0].name, 'NOVAK JANEZ');
    eq(t.persons[0].room, '202');
    eq(t.bad.length, 1, 'naslov med neveljavnimi vrsticami');
  });

  test('Uvoz: celica z več vrsticami (Alt+Enter v Excelu)', () => {
    const r = Csv.parsePersons('202\tNOVAK JANEZ\t"voziček\nalergija"\n203\tKRANJC MARIJA');
    eq(r.persons.length, 2);
    eq(r.persons[0].note, 'voziček alergija');
    eq(Csv.parsePersons('202,"NOVAK JANEZ\n203,KRANJC MARIJA').persons.length, 2, 'nezaprt narekovaj');
  });

  test('Uvoz: brez glave je soba tisti od prvih dveh stolpcev, ki ima številke', () => {
    const r = Csv.parsePersons('NOVAK JANEZ\t202\nKRANJC MARIJA\t203\nHORVAT ANA\t');
    eq(r.persons.map(p => p.name + '/' + p.room).join('|'), 'NOVAK JANEZ/202|KRANJC MARIJA/203|HORVAT ANA/', 'ime, soba');
    eq(Csv.parsePersons('202\tNOVAK JANEZ\n\tKRANJC MARIJA').persons.map(p => p.name).join('|'), 'NOVAK JANEZ|KRANJC MARIJA', 'soba, ime');
  });

  // ---------- pravila razporejanja ----------
  test('Pravila: veljavni datumi, zaporedne različice brez vrzeli in prekrivanj', () => {
    // Pravi koledarski datum (ne npr. 2026-09-31).
    const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && S.addDays(s, 0) === s;
    Rules.RULES.forEach(r => {
      assert(r.id && r.text, 'id/text: ' + JSON.stringify(r));
      assert(isDate(r.from), r.id + ': from ' + r.from);
      assert(r.from >= Rules.START, r.id + ': from pred začetkom zgodovine');
      assert(r.to === null || (isDate(r.to) && r.to >= r.from), r.id + ': to ' + r.to);
    });
    const ids = Array.from(new Set(Rules.RULES.map(r => r.id)));
    ids.forEach(id => {
      const versions = Rules.RULES.filter(r => r.id === id).sort((a, b) => (a.from < b.from ? -1 : 1));
      for (let i = 1; i < versions.length; i++) {
        assert(versions[i - 1].to, id + ': starejša različica nima `to`');
        eq(versions[i].from, S.addDays(versions[i - 1].to, 1), id + ': nova različica velja dan po koncu stare;');
      }
    });
  });
  test('Pravila: veljavno besedilo se ujema s kodo razporejanja', () => {
    const current = id => {
      const r = Rules.RULES.find(x => x.id === id && x.to === null);
      assert(r, 'ni veljavnega pravila ' + id);
      return r.text;
    };
    const c = S.DEFAULT_CAPACITY;
    assert(current('privzeta-kapaciteta').includes(`delavnik ${c.weekday}, sobota ${c.saturday}, nedelja/praznik ${c.sundayHoliday}`),
      'privzeta kapaciteta');
    assert(current('interval').includes(`privzeto ${S.DEFAULT_INTERVAL}, najmanj 1`), 'privzeti interval');
    assert(current('rocni-popravki').includes(`Zadnjih ${Rules.UNDO_LIMIT} sprememb`), 'razveljavitve');
    assert(current('omejitve-datumov').includes(`največ ${S.MAX_ABSENCE_DAYS} dni`), 'najdaljša odsotnost');
    assert(current('omejitve-datumov').includes(`${S.BLOCKED_KEEP_DAYS} dni`), 'čiščenje starih omejitev');
    eq(S.intervalOf({}), S.DEFAULT_INTERVAL, 'intervalOf brez vrednosti');
    eq(S.intervalOf({ intervalDays: -3 }), 1, 'intervalOf najmanj 1');
    // Število dni v besedilu (brez slovničnih oblik, ki so odvisne od števila).
    assert(new RegExp(`\\b${S.LOOKAHEAD_DAYS} veljavn`).test(current('pogled-naprej')), 'pogled naprej: število dni');
    assert(current('pogled-naprej').includes(`prvih ${2 * S.LOOKAHEAD_DAYS} dneh`), 'pogled naprej: naslednji mesec');
    const p = iv => ({ intervalDays: iv });
    assert(current('zgodovina').includes('2 × interval + 7'), 'zgodovina: besedilo');
    [5, 10, 14].forEach(iv => eq(S.historyLimit(p(iv)), 2 * iv + 7, 'historyLimit ' + iv));
    assert(current('pogled-naprej').includes('max(1, ⌊interval / 5⌋)'), 'pogled naprej: besedilo');
    [[3, 1], [10, 2], [14, 2], [15, 3]].forEach(([iv, n]) => eq(S.pullForwardDays(p(iv)), n, 'pullForwardDays ' + iv));
    assert(current('prekratek-razmik').includes('polovice intervala (zaokroženo navzgor)'), 'kratek razmik: besedilo');
    [[9, 5], [10, 5], [7, 4]].forEach(([iv, n]) => eq(S.shortGap(p(iv)), n, 'shortGap ' + iv));
    assert(current('zaklenjeni-termini').includes('polovico intervala (zaokroženo navzgor)'), 'zaklenjeni termini: besedilo');
  });
  test('Pravila: seznam praznikov se ujema s holidays.js', () => {
    const text = Rules.RULES.find(r => r.id === 'prazniki' && r.to === null).text.toLowerCase();
    [2026, 2027].forEach(y => Object.values(H.getHolidays(y)).forEach(name =>
      assert(text.includes(name.toLowerCase()), 'manjka praznik ' + name)));
  });
  test('Pravila: zgodovina upošteva kopanja do 2 × interval + 7 dni pred mesecem', () => {
    const p = makePersons(1);
    const sched = d => ({ 'c1|2026-09': { days: { [d]: ['p0'] } } });
    eq(S.knownLastBaths(p, sched('2026-09-04'), '2026-10-01').p0, '2026-09-04', '27 dni');
    eq(S.knownLastBaths(p, sched('2026-09-03'), '2026-10-01').p0, undefined, '28 dni');
  });
  test('knownLastBaths bere razporede vseh hodnikov', () => {
    const p = makePersons(1, { corridorId: 'c2' });
    const schedules = { 'c1|2026-09': { days: { '2026-09-25': ['p0'] } } };
    eq(S.knownLastBaths(p, schedules, '2026-10-01').p0, '2026-09-25');
  });
  test('Po premiku na drug hodnik rok sledi zgodovini', () => {
    const p = makePersons(1, { corridorId: 'c2' });
    const schedules = { 'c1|2026-09': { days: { '2026-09-25': ['p0'] } } };
    const r = S.buildSchedule(corridor({ id: 'c2' }), p, 2026, 10, schedules);
    const first = Object.keys(r.days).filter(d => r.days[d].includes('p0')).sort()[0];
    eq(first, S.addDays('2026-09-25', 10));
  });
  test('removeFutureBaths odstrani le prihodnje termine na starem hodniku', () => {
    const schedules = {
      'c1|2026-10': {
        days: { '2026-10-05': ['p0', 'p1'], '2026-10-20': ['p0', 'p1'] }, edited: false,
        locked: { '2026-10-05': ['p0'], '2026-10-20': ['p0', 'p1'] }
      },
      'c2|2026-10': { days: { '2026-10-20': ['p0'] }, edited: false }
    };
    eq(S.removeFutureBaths(schedules, 'c1', 'p0', '2026-10-12'), 1);
    eq(JSON.stringify(schedules['c1|2026-10'].days), JSON.stringify({ '2026-10-05': ['p0', 'p1'], '2026-10-20': ['p1'] }));
    eq(JSON.stringify(schedules['c1|2026-10'].locked), JSON.stringify({ '2026-10-05': ['p0'], '2026-10-20': ['p1'] }));
    eq(JSON.stringify(schedules['c2|2026-10'].days), JSON.stringify({ '2026-10-20': ['p0'] }));
    eq(schedules['c1|2026-10'].edited, true);
    eq(schedules['c2|2026-10'].edited, false);
  });
  // ---------- zaklenjeni termini ----------
  test('setLocked in isLocked: dodaj, odstrani, prazni ključi se pobrišejo', () => {
    const s = { days: {} };
    eq(S.isLocked(s, '2026-10-14', 'p0'), false);
    eq(S.isLocked(undefined, '2026-10-14', 'p0'), false);
    S.setLocked(s, '2026-10-14', 'p0', true);
    S.setLocked(s, '2026-10-14', 'p0', true);
    S.setLocked(s, '2026-10-14', 'p1', true);
    eq(JSON.stringify(s.locked), JSON.stringify({ '2026-10-14': ['p0', 'p1'] }));
    eq(S.isLocked(s, '2026-10-14', 'p1'), true);
    S.setLocked(s, '2026-10-14', 'p0', false);
    eq(S.isLocked(s, '2026-10-14', 'p0'), false);
    S.setLocked(s, '2026-10-14', 'p1', false);
    assert(!('locked' in s), 'prazen locked se izbriše');
    S.setLocked(s, '2026-10-15', 'p0', false);
    assert(!('locked' in s), 'odklep neobstoječega');
  });
  test('unschedule odstrani termin in njegov zaklep', () => {
    const s = { days: { '2026-10-14': ['p0', 'p1'] }, locked: { '2026-10-14': ['p0', 'p1'] } };
    S.unschedule(s, '2026-10-14', 'p0');
    eq(JSON.stringify(s), JSON.stringify({ days: { '2026-10-14': ['p1'] }, locked: { '2026-10-14': ['p1'] } }));
    S.unschedule(s, '2026-10-14', 'p1');
    eq(JSON.stringify(s), JSON.stringify({ days: { '2026-10-14': [] } }));
  });
  test('Zaklenjen termin ostane pri sestavi', () => {
    const p = makePersons(11);
    const r = S.buildSchedule(c, p, 2026, 10, {}, { fixed: { '2026-10-14': ['p0'] } });
    assert(r.days['2026-10-14'].includes('p0'), JSON.stringify(r.days['2026-10-14']));
    eq(JSON.stringify(r.locked), JSON.stringify({ '2026-10-14': ['p0'] }));
  });
  test('Brez kopanja tik pred zaklenjenim terminom, rok se šteje od njega', () => {
    // Brez zaklepa bi se p0 kopala 10. 10. (rok).
    const p = makePersons(1);
    const prev = { 'c1|2026-09': { days: { '2026-09-30': ['p0'] } } };
    assert(S.buildSchedule(c, p, 2026, 10, prev).days['2026-10-10'].includes('p0'), 'brez zaklepa');
    const r = S.buildSchedule(c, p, 2026, 10, prev, { fixed: { '2026-10-14': ['p0'] } });
    const dates = datesOf(r.days, 'p0');
    assert(!dates.some(d => d >= '2026-10-10' && d <= '2026-10-13'), dates.join(', '));
    const next = dates.find(d => d > '2026-10-14');
    assert(next >= '2026-10-22' && next <= '2026-10-24', 'naslednje kopanje ' + next);
  });
  test('Zaklenjeni termini in kapaciteta dneva', () => {
    const p = makePersons(20);
    const r = S.buildSchedule(c, p, 2026, 10, {}, { fixed: { '2026-10-14': ['p7'] } });
    assert(r.days['2026-10-14'].length <= 2 && r.days['2026-10-14'].includes('p7'), JSON.stringify(r.days['2026-10-14']));
    const r3 = S.buildSchedule(c, p, 2026, 10, {}, { fixed: { '2026-10-14': ['p3', 'p7', 'p11'] } });
    eq(r3.days['2026-10-14'].slice().sort().join(), ['p11', 'p3', 'p7'].join());
  });
  test('Zaklenjen termin na dan brez kopanja je v razporedu, analiza ga označi', () => {
    const p = makePersons(5);
    const r = S.buildSchedule(c, p, 2026, 10, {}, { fixed: { '2026-10-18': ['p0'] } });
    eq(JSON.stringify(r.days['2026-10-18']), JSON.stringify(['p0']));
    assert(r.warnings.some(w => w.level === 'error' && w.date === '2026-10-18'), JSON.stringify(r.warnings));
  });
  test('Zaklep neaktivne osebe ali osebe drugega hodnika izpade', () => {
    const p = makePersons(5);
    p[1].active = false;
    p[2].corridorId = 'c2';
    const r = S.buildSchedule(c, p, 2026, 10, {}, { fixed: { '2026-10-14': ['p1', 'p2'], '2026-10-18': ['p2'] } });
    eq(JSON.stringify(r.locked), '{}');
    assert(!r.days['2026-10-14'].includes('p1') && !r.days['2026-10-14'].includes('p2'), JSON.stringify(r.days['2026-10-14']));
    assert(!r.days['2026-10-18'], 'nedelja brez kopanja');
  });

  test('Zamuda z rokom v prejšnjem mesecu je opozorilo', () => {
    const p = makePersons(1);
    const prev = { 'c1|2026-09': { days: { '2026-09-15': ['p0'] } } };
    const w = S.analyzeSchedule(c, p, 2026, 10, { '2026-10-01': ['p0'] }, prev);
    const late = w.find(x => x.level === 'warn' && /6 dni zamude/.test(x.text));
    assert(late, JSON.stringify(w));
    eq(late.personId, 'p0');
    eq(late.date, '2026-10-01');
    // Če med rokom in kopanjem ni bilo možnega dneva (zaprto), je le informacija.
    const closed = corridor({ dayOverrides: { '2026-09-25': 0, '2026-09-26': 0, '2026-09-28': 0, '2026-09-29': 0, '2026-09-30': 0 } });
    const w2 = S.analyzeSchedule(closed, p, 2026, 10, { '2026-10-01': ['p0'] }, prev);
    assert(w2.some(x => x.level === 'info' && /vmes ni bilo dovoljenega dneva/.test(x.text)), JSON.stringify(w2));
  });
  test('Razmiki: od prejšnjega meseca, zamude in kratki razmiki', () => {
    const p = { id: 'p', intervalDays: 10 };
    const dates = ['2026-10-07', '2026-10-17', '2026-10-20'];
    eq(JSON.stringify(S.bathGaps(p, '2026-09-25', dates)), JSON.stringify([
      { days: 12, fromPrev: true, level: 'late' },
      { days: 10, fromPrev: false, level: null },
      { days: 3, fromPrev: false, level: 'short' }
    ]));
    eq(JSON.stringify(S.bathGaps(p, null, dates)), JSON.stringify([
      { days: 10, fromPrev: false, level: null },
      { days: 3, fromPrev: false, level: 'short' }
    ]));
    eq(S.bathGaps(p, null, []).length, 0);
  });
  test('Zaporedje mesecev: prejšnji mesec, kasnejši in starejši razporedi', () => {
    eq(S.prevMonth('2026-01'), '2025-12');
    eq(S.prevMonth('2026-10'), '2026-09');
    eq(S.addMonths('2026-12', 1), '2027-01');
    eq(S.addMonths('2026-01', -1), '2025-12');
    eq(S.addMonths('2026-10', 0), '2026-10');
    eq(S.addMonths('2026-03', 14), '2027-05');
    eq(S.addMonths('2026-03', -15), '2024-12');
    const sch = { 'c1|2026-09': {}, 'c1|2026-12': {}, 'c1|2026-11': {}, 'c1|2026-10': {}, 'c2|2026-11': {}, 'c10|2026-12': {} };
    eq(JSON.stringify(S.laterScheduleKeys(sch, 'c1', '2026-10')), JSON.stringify(['c1|2026-11', 'c1|2026-12']));
    eq(S.laterScheduleKeys(sch, 'c1', '2026-12').length, 0);
    eq(S.hasEarlierSchedule(sch, 'c1', '2026-10'), true);
    eq(S.hasEarlierSchedule(sch, 'c1', '2026-09'), false);
    eq(S.hasEarlierSchedule(sch, 'c2', '2026-11'), false);
    eq(S.hasEarlierSchedule({}, 'c1', '2026-10'), false);
  });
  test('Dnevi: pravilna slovnična oblika', () => {
    eq(S.nDays(1), '1 dan');
    eq(S.nDays(2), '2 dneva');
    eq(S.nDays(3), '3 dnevi');
    eq(S.nDays(5), '5 dni');
    eq(S.nDays(101), '101 dan');
  });
  test('Pravila: validOn vključuje oba konca obdobja', () => {
    const r = { from: '2026-10-01', to: '2026-10-31' };
    eq(Rules.validOn(r, '2026-10-01'), true);
    eq(Rules.validOn(r, '2026-10-31'), true);
    eq(Rules.validOn(r, '2026-09-30'), false);
    eq(Rules.validOn(r, '2026-11-01'), false);
    eq(Rules.validOn({ from: '2026-10-01', to: null }, '2030-01-01'), true);
  });

  // ---------- sestava od dneva ----------
  test('Sestava od dneva: dnevi pred njim ostanejo nespremenjeni', () => {
    const p = makePersons(11);
    const copy = JSON.parse(JSON.stringify(S.buildSchedule(c, p, 2026, 10, {}).days));
    const moved = copy['2026-10-03'].shift();
    copy['2026-10-05'] = copy['2026-10-05'].filter(id => id !== moved).concat([moved]);
    const schedules = { 'c1|2026-10': { days: copy } };
    const r = S.buildSchedule(c, p, 2026, 10, schedules, { from: '2026-10-15' });
    const keys = new Set(Object.keys(copy).concat(Object.keys(r.days)));
    keys.forEach(d => {
      if (d < '2026-10-15') eq(JSON.stringify(r.days[d] || []), JSON.stringify(copy[d] || []), d);
    });
    S.monthDays(2026, 10).filter(d => d >= '2026-10-15').forEach(d => {
      const cap = S.capacityOn(c, d);
      if (cap > 0) assert(r.days[d].length <= cap, d + ': ' + r.days[d].length);
    });
    p.forEach(x => assert(datesOf(r.days, x.id).some(d => d >= '2026-10-15'), x.id + ' po 15. 10.'));
    const before = JSON.stringify(copy['2026-10-05']);
    r.days['2026-10-05'].push('x');
    eq(JSON.stringify(copy['2026-10-05']), before, 'kopija');
  });
  test('Sestava od dneva: rok iz ohranjenih dni', () => {
    const p = makePersons(1);
    const schedules = { 'c1|2026-10': { days: { '2026-10-12': ['p0'] } } };
    const r = S.buildSchedule(c, p, 2026, 10, schedules, { from: '2026-10-15' });
    eq(JSON.stringify(r.days['2026-10-12']), '["p0"]');
    const first = datesOf(r.days, 'p0').filter(d => d >= '2026-10-15')[0];
    assert(first >= S.addDays('2026-10-12', 10 - S.pullForwardDays(p[0])) && first <= '2026-10-24', 'prvi termin ' + first);
  });
  test('Sestava od dneva: nova oseba dobi prvi rok od izbranega dne', () => {
    const p = makePersons(3);
    const schedules = { 'c1|2026-10': { days: { '2026-10-05': ['p0'], '2026-10-06': ['p1'] } } };
    const r = S.buildSchedule(c, p, 2026, 10, schedules, { from: '2026-10-15' });
    const dates = datesOf(r.days, 'p2');
    assert(dates.length > 0, 'p2 ni razporejena');
    assert(dates[0] >= '2026-10-15' && dates[0] <= S.addDays('2026-10-15', 10 - 1), 'prvi termin ' + dates[0]);
  });
  test('Sestava od dneva: zaklep pred izbranim dnem ostane', () => {
    const p = makePersons(3);
    const schedules = { 'c1|2026-10': { days: { '2026-10-05': ['p0', 'p1'] } } };
    const fixed = { '2026-10-05': ['p0'], '2026-10-06': ['p2'], '2026-10-20': ['p1'] };
    const r = S.buildSchedule(c, p, 2026, 10, schedules, { fixed, from: '2026-10-15' });
    eq(JSON.stringify(r.locked['2026-10-05']), '["p0"]');
    assert(r.days['2026-10-05'].includes('p0'), 'ohranjen termin');
    eq(r.locked['2026-10-06'], undefined, 'zaklep brez termina');
    assert(r.locked['2026-10-20'].includes('p1') && r.days['2026-10-20'].includes('p1'), 'zaklep po izbranem dnevu');
  });
  test('Sestava od dneva: neveljaven datum = cel mesec', () => {
    const p = makePersons(11);
    const base = S.buildSchedule(c, p, 2026, 10, {});
    ['2026-11-03', '2026-10-01', '', undefined].forEach(from => {
      const r = S.buildSchedule(c, p, 2026, 10, {}, { from });
      eq(JSON.stringify(r.days), JSON.stringify(base.days), String(from));
    });
  });
  test('Privzeti začetek sestave', () => {
    eq(S.defaultBuildFrom('2026-10', '2026-10-12'), '2026-10-13');
    eq(S.defaultBuildFrom('2026-10', '2026-10-31'), '');
    eq(S.defaultBuildFrom('2026-11', '2026-10-12'), '');
    eq(S.buildStart(2026, 10, '2026-10-15'), '2026-10-15');
    eq(S.buildStart(2026, 10, '2026-10-01'), null);
    eq(S.buildStart(2026, 10, '2026-11-03'), null);
    eq(S.buildStart(2026, 10, ''), null);
  });

  // ---------- izpis ----------
  const failed = results.filter(r => !r.ok);
  if (isNode) {
    results.forEach(r => console.log((r.ok ? '  ok   ' : '  FAIL ') + r.name + (r.ok ? '' : ' – ' + r.err)));
    console.log(`\n${results.length - failed.length}/${results.length} testov uspešnih.`);
    if (failed.length) process.exitCode = 1;
  } else {
    root.KSTestResults = results;
    const out = document.getElementById('results');
    results.forEach(r => {
      const li = document.createElement('li');
      li.className = r.ok ? 'ok' : 'fail';
      li.textContent = (r.ok ? '✔ ' : '✘ ') + r.name + (r.ok ? '' : ' – ' + r.err);
      out.appendChild(li);
    });
    document.getElementById('summary').textContent = `${results.length - failed.length}/${results.length} testov uspešnih.`;
  }
})(this);
