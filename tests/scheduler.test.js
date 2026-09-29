/* Testi za scheduler in praznike. Zagon: `node tests/scheduler.test.js` ali odpri tests/scheduler.test.html. */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const H = isNode ? require('../js/holidays.js') : root.KSHolidays;
  const S = isNode ? require('../js/scheduler.js') : root.KSScheduler;
  const Csv = isNode ? require('../js/csv.js') : root.KSCsv;

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
    assert(r.warnings.some(w => w.level === 'error' && /Kapaciteta premajhna/.test(w.text)));
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
  test('Ročne izjeme po dnevih', () => {
    const c2 = corridor({ dayOverrides: { '2026-10-15': 0, '2026-10-18': 1, '2026-10-20': 4 } });
    eq(S.dayInfo(c2, '2026-10-15').reason, 'Izjema: ni kopanja');
    eq(S.capacityOn(c2, '2026-10-18'), 1, 'nedelja z izjemo');
    const r = S.buildSchedule(c2, makePersons(30), 2026, 10, {});
    assert(!r.days['2026-10-15'], '15. 10. izključen');
    eq(r.days['2026-10-18'].length, 1, 'nedelja 18. 10.');
    eq(r.days['2026-10-20'].length, 4, 'torek 20. 10.');
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
