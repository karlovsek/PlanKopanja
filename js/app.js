/* Uporabniški vmesnik Plana kopanja. */
(function () {
  'use strict';

  const S = window.KSScheduler;
  const Store = window.KSStorage;
  const Csv = window.KSCsv;
  const Rules = window.KSRules;

  const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const WD_SHORT = ['Ned', 'Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob'];
  const MONTHS = ['januar', 'februar', 'marec', 'april', 'maj', 'junij', 'julij',
    'avgust', 'september', 'oktober', 'november', 'december'];
  const BACKUP_REMIND_DAYS = 7; // po toliko dneh od zadnjega izvoza se v glavi pokaže opomnik
  const UNDO_LIMIT = Rules.UNDO_LIMIT; // število v besedilu pravila »rocni-popravki«

  let state = Store.load();
  let selection = null; // { date, personId } – izbran čip za premik
  let editingDay = null; // datum, za katerega je odprto urejanje izjeme
  let focusBlocked = false; // po spremembi omejitve se v urejevalniku dneva fokusira izbirnik oseb
  let formBlocked = new Set(); // delovna kopija omejitev odprtega obrazca osebe (zapiše se ob shranjevanju)
  let personSort = { key: 'name', dir: 1 }; // razvrščanje tabele oseb (dir: 1 naraščajoče, -1 padajoče)
  const undoStack = []; // [{ label, corridorId, month, snapshot }] – spremembe v zavihku Razpored, samo v pomnilniku

  // ---------- pomožne ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(c => {
      if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function save() {
    if (!Store.save(state)) alert('Podatkov ni bilo mogoče shraniti v brskalnik. Izvozite jih v datoteko!');
  }

  const byName = S.byName;
  const str = v => (v == null ? '' : String(v));

  function weekdayList(arr) {
    return WD_ORDER.filter(w => (arr || []).includes(w)).map(w => WD_SHORT[w]).join(', ');
  }

  function personLabel(p) { return p.name + (p.room ? ' (' + p.room + ')' : ''); }

  function fmtDate(iso) { return S.shortDate(iso) + ' ' + iso.slice(0, 4); }
  // Lokalni datum in čas, npr. »12. 10. 2026 ob 14:05«.
  function fmtDateTime(d) {
    return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ob ${d.getHours()}:` +
      String(d.getMinutes()).padStart(2, '0');
  }

  // "2026-12-24", "24.12.2026", "24. 12. 2026" → ISO ali null
  function parseDate(s) {
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } else {
      m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(s);
      if (!m) return null;
      d = +m[1]; mo = +m[2]; y = +m[3];
    }
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  }

  function renderWeekdayBoxes(container) {
    container.innerHTML = '';
    WD_ORDER.forEach(w => {
      container.appendChild(el('label', {}, [el('input', { type: 'checkbox', value: w }), WD_SHORT[w]]));
    });
  }
  function getWeekdays(container) { return $$('input:checked', container).map(i => +i.value); }
  function setWeekdays(container, arr) { $$('input', container).forEach(i => { i.checked = (arr || []).includes(+i.value); }); }

  function corridorById(id) { return state.corridors.find(c => c.id === id); }
  function personById(id) { return state.persons.find(p => p.id === id); }
  function personsOf(cid) { return state.persons.filter(p => p.corridorId === cid).sort(byName); }

  function currentCorridorId() {
    let id = state.ui.corridorId;
    if (!corridorById(id)) id = state.corridors[0] ? state.corridors[0].id : null;
    state.ui.corridorId = id;
    return id;
  }

  function fillCorridorSelects() {
    const cid = currentCorridorId();
    $$('.corridor-select').forEach(sel => {
      sel.innerHTML = '';
      state.corridors.slice().sort(byName).forEach(c => sel.appendChild(el('option', { value: c.id, text: c.name })));
      sel.value = cid || '';
      sel.disabled = !cid;
    });
  }

  // Izbran čip in odprto urejanje izjeme veljata samo, dokler je odprt koledar.
  function clearScheduleInteraction() {
    selection = null;
    editingDay = null;
  }

  // Razveljavi: pred vsako spremembo v zavihku Razpored se shrani posnetek hodnikov, oseb in razporedov
  // (brez `ui`) ter hodnik in mesec, na katera se razveljavitev vrne. Ob spremembi hodnikov ali oseb drugje se sklad
  // izbriše, da razveljavitev ne povozi teh sprememb.
  function pushUndo(label) {
    undoStack.push({
      label, corridorId: currentCorridorId(), month: currentMonth(),
      snapshot: JSON.stringify({ corridors: state.corridors, persons: state.persons, schedules: state.schedules }),
    });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }

  // Shrani spremembo hodnikov ali oseb (zunaj zavihka Razpored) in izbriši zgodovino razveljavitev.
  function saveClearUndo() {
    undoStack.length = 0;
    save();
  }

  function undo() {
    const last = undoStack.pop();
    if (!last) return false;
    Object.assign(state, JSON.parse(last.snapshot));
    // Pogled se preklopi na hodnik in mesec spremembe, da je razveljavitev vidna.
    const moved = last.corridorId !== state.ui.corridorId || last.month !== state.ui.month;
    state.ui.corridorId = last.corridorId;
    state.ui.month = last.month;
    clearScheduleInteraction();
    save();
    render();
    const where = moved ? ` (hodnik »${corridorById(last.corridorId).name}«, ${monthName(last.month)})` : '';
    setStatus('Razveljavljeno: ' + last.label + where + '.', 'ok');
    return true;
  }

  // ---------- zavihki ----------
  function showTab(name) {
    if (!$('#tab-' + name)) name = 'corridors';
    clearScheduleInteraction();
    $$('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + name; });
    $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    state.ui.tab = name;
    save();
    render();
  }

  function render() {
    fillCorridorSelects();
    const tab = state.ui.tab;
    if (tab === 'corridors') renderCorridors();
    else if (tab === 'persons') renderPersons();
    else if (tab === 'schedule') renderSchedule();
    else if (tab === 'backup') renderBackup();
    else if (tab === 'rules') renderRules();
    renderBackupReminder();
  }

  // Opomnik v glavi: varnostna kopija še ni bila izvožena ali je starejša od BACKUP_REMIND_DAYS dni.
  function renderBackupReminder() {
    const btn = $('#backup-reminder');
    const last = state.ui.lastExport ? new Date(state.ui.lastExport) : null;
    const days = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
    let text = '';
    if (state.corridors.length) {
      if (!last) text = 'Varnostna kopija še ni bila izvožena';
      else if (days >= BACKUP_REMIND_DAYS) text = 'Od zadnje varnostne kopije: ' + S.nDays(days);
    }
    btn.textContent = text;
    btn.hidden = !text;
  }

  // Pojavno okno z obrazcem: ob vsakem odprtju prazno (nov vnos) ali izpolnjeno z `item` (urejanje).
  function openDialog(dlg, reset, fill, item) {
    reset();
    if (item) fill(item);
    dlg.showModal();
    $('[name]:not([type=hidden])', dlg).focus();
  }

  // ---------- HODNIKI ----------
  const corridorForm = $('#corridor-form');
  const corridorDialog = $('#corridor-dialog');

  function openCorridorDialog(c) { openDialog(corridorDialog, resetCorridorForm, editCorridor, c); }

  function renderCorridors() {
    const tbody = $('#corridor-rows');
    tbody.innerHTML = '';
    if (!state.corridors.length) {
      tbody.appendChild(el('tr', { class: 'empty' }, [el('td', { colspan: 7, text: 'Ni še nobenega hodnika.' })]));
    }
    state.corridors.slice().sort(byName).forEach(c => {
      tbody.appendChild(el('tr', {}, [
        el('td', { text: c.name }),
        el('td', { text: String(S.defaultCapacity(c, 'weekday')) }),
        el('td', { text: String(S.defaultCapacity(c, 'saturday')) }),
        el('td', { text: String(S.defaultCapacity(c, 'sundayHoliday')) }),
        el('td', { text: overrideList(c) || '–' }),
        el('td', { text: String(personsOf(c.id).length) }),
        el('td', { class: 'actions' }, [
          el('button', { type: 'button', class: 'small', text: 'Uredi', onclick: () => openCorridorDialog(c) }), ' ',
          el('button', { type: 'button', class: 'small link-danger', text: 'Briši', onclick: () => deleteCorridor(c) })
        ])
      ]));
    });
  }

  function overrideList(c, sep) {
    const o = c.dayOverrides || {};
    return Object.keys(o).sort().map(d => fmtDate(d) + ' = ' + o[d]).join(sep || ', ');
  }

  function resetCorridorForm() {
    corridorForm.reset();
    corridorForm.id.value = '';
    corridorForm.capWeekday.value = S.DEFAULT_CAPACITY.weekday;
    corridorForm.capSaturday.value = S.DEFAULT_CAPACITY.saturday;
    corridorForm.capSundayHoliday.value = S.DEFAULT_CAPACITY.sundayHoliday;
    $('#corridor-form-title').textContent = 'Nov hodnik';
    $('.form-error', corridorForm).hidden = true;
  }

  function editCorridor(c) {
    corridorForm.id.value = c.id;
    corridorForm.name.value = c.name;
    corridorForm.capWeekday.value = S.defaultCapacity(c, 'weekday');
    corridorForm.capSaturday.value = S.defaultCapacity(c, 'saturday');
    corridorForm.capSundayHoliday.value = S.defaultCapacity(c, 'sundayHoliday');
    corridorForm.dayOverrides.value = overrideList(c, '\n');
    $('#corridor-form-title').textContent = 'Uredi hodnik: ' + c.name;
  }

  function deleteCorridor(c) {
    const n = personsOf(c.id).length;
    if (!confirm(`Izbrišem hodnik »${c.name}«? Izbrisane bodo tudi vse njegove osebe (${n}) in razporedi.`)) return;
    state.corridors = state.corridors.filter(x => x.id !== c.id);
    state.persons = state.persons.filter(p => p.corridorId !== c.id);
    const prefix = S.scheduleKey(c.id, '');
    Object.keys(state.schedules).forEach(k => { if (k.indexOf(prefix) === 0) delete state.schedules[k]; });
    saveClearUndo();
    render();
  }

  corridorForm.addEventListener('submit', e => {
    e.preventDefault();
    const f = corridorForm;
    const errBox = $('.form-error', f);
    const overrides = {};
    const bad = [];
    f.dayOverrides.value.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).forEach(line => {
      const m = /^(.+?)\s*[=:]\s*(\d+)$/.exec(line);
      const d = m && parseDate(m[1].trim());
      if (d) overrides[d] = +m[2]; else bad.push(line);
    });
    if (bad.length) {
      errBox.textContent = 'Neveljavne izjeme: ' + bad.join(', ') + ' (uporabite obliko 24.12.2026 = 0).';
      errBox.hidden = false;
      return;
    }
    const cap = input => Math.max(0, parseInt(input.value, 10) || 0);
    const data = {
      name: f.name.value.trim(),
      capacity: { weekday: cap(f.capWeekday), saturday: cap(f.capSaturday), sundayHoliday: cap(f.capSundayHoliday) },
      dayOverrides: overrides
    };
    const existing = corridorById(f.id.value);
    if (existing) Object.assign(existing, data);
    else {
      const c = Object.assign({ id: newId() }, data);
      state.corridors.push(c);
      state.ui.corridorId = c.id;
    }
    saveClearUndo();
    corridorDialog.close();
    render();
  });
  $('#btn-new-corridor').addEventListener('click', () => openCorridorDialog());

  // ---------- OSEBE ----------
  const personForm = $('#person-form');
  const personDialog = $('#person-dialog');

  function openPersonDialog(p) {
    if (currentCorridorId()) openDialog(personDialog, resetPersonForm, editPerson, p);
  }

  // »Župančič« → »zupancic«, »Đurić« → »duric« (iskanje brez velikih črk, šumnikov in odvečnih presledkov)
  function fold(s) {
    return str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/\s+/g, ' ');
  }

  // Filtri tabele oseb, prebrani iz polj pod glavo (tudi vrednosti, ki jih brskalnik obnovi ob ponovnem nalaganju).
  function personFilterValues() {
    const f = {};
    $$('#tab-persons [data-filter]').forEach(inp => { f[inp.dataset.filter] = inp.value.trim(); });
    return f;
  }

  function personMatcher(f) {
    const name = fold(f.name);
    const room = fold(f.room);
    const interval = parseInt(f.interval, 10); // »10 dni« → 10
    return p => {
      if (name && !fold(p.name).includes(name)) return false;
      if (room && !fold(p.room).includes(room)) return false;
      if (f.interval && S.intervalOf(p) !== interval) return false;
      const a = p.allowedWeekdays || [];
      if (f.weekdays === 'limited') { if (!a.length) return false; }
      else if (f.weekdays && a.length && !a.includes(+f.weekdays)) return false;
      if (f.active && (p.active !== false ? 'da' : 'ne') !== f.active) return false;
      return true;
    };
  }

  // Dovoljeni dnevi kot niz položajev v tednu (pon = 0 … ned = 6), npr. »02« = pon, sre; prazen niz = vsi dnevi.
  function wdKey(p) { return WD_ORDER.map((w, i) => ((p.allowedWeekdays || []).includes(w) ? i : '')).join(''); }

  const roomCollator = new Intl.Collator('sl', { numeric: true });

  // Primerjave za razvrščanje tabele oseb po stolpcih.
  const personCompare = {
    name: byName,
    note: (a, b) => str(a.note).localeCompare(str(b.note), 'sl'),
    room: (a, b) => roomCollator.compare(str(a.room), str(b.room)),
    interval: (a, b) => S.intervalOf(a) - S.intervalOf(b),
    weekdays: (a, b) => wdKey(a).localeCompare(wdKey(b)),
    active: (a, b) => (a.active === false) - (b.active === false)
  };

  function comparePersons(a, b) {
    const k = personSort.key;
    // Osebe brez sobe oz. opombe so vedno na koncu (ne glede na smer).
    if ((k === 'room' || k === 'note') && !a[k] !== !b[k]) return a[k] ? -1 : 1;
    return personSort.dir * personCompare[k](a, b) || byName(a, b);
  }

  function renderPersons() {
    const cid = currentCorridorId();
    $('#persons-empty').hidden = !!cid;
    $('#persons-status').hidden = true;
    $('#persons-count').hidden = true;
    $('#btn-import-persons').disabled = !cid;
    $('#btn-new-person').disabled = !cid;
    const tbody = $('#person-rows');
    tbody.innerHTML = '';
    if (!cid) return;
    const f = personFilterValues();
    const all = state.persons.filter(p => p.corridorId === cid);
    const list = all.filter(personMatcher(f)).sort(comparePersons);
    $$('#tab-persons button.sort').forEach(b => {
      if (b.dataset.sort === personSort.key) b.parentNode.setAttribute('aria-sort', personSort.dir > 0 ? 'ascending' : 'descending');
      else b.parentNode.removeAttribute('aria-sort');
    });
    $('#persons-count').hidden = !Object.values(f).some(v => v);
    $('#persons-count span').textContent = `Prikazanih ${list.length} od ${all.length}`;
    if (!list.length) {
      tbody.appendChild(el('tr', { class: 'empty' }, [el('td', {
        colspan: 7, text: all.length ? 'Ni oseb, ki ustrezajo filtru.' : 'Na tem hodniku ni oseb.'
      })]));
    }
    const today = todayIso();
    list.forEach(p => {
      const future = (p.blockedDates || []).filter(d => d >= today);
      tbody.appendChild(el('tr', { class: p.active === false ? 'inactive' : '' }, [
        el('td', {}, [p.name, future.length
          ? el('span', { class: 'blocked-mark no-print', title: 'Ima omejitve: ' + rangeText(S.groupDateRanges(future)[0]), text: ' ⊘' })
          : null]),
        el('td', { text: p.room || '' }),
        el('td', { text: 'vsakih ' + S.intervalOf(p) + ' dni' }),
        el('td', { text: weekdayList(p.allowedWeekdays) || 'vsi' }),
        el('td', { text: p.active === false ? 'ne' : 'da' }),
        el('td', { text: p.note || '' }),
        el('td', { class: 'actions' }, [
          el('button', { type: 'button', class: 'small', text: 'Uredi', onclick: () => openPersonDialog(p) }), ' ',
          el('button', { type: 'button', class: 'small link-danger', text: 'Briši', onclick: () => deletePerson(p) })
        ])
      ]));
    });
  }

  $$('#tab-persons button.sort').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.sort;
    personSort = { key, dir: personSort.key === key ? -personSort.dir : 1 };
    renderPersons();
  }));

  $$('#tab-persons [data-filter]').forEach(inp => inp.addEventListener('input', renderPersons));

  $('#btn-clear-filter').addEventListener('click', () => {
    $$('#tab-persons [data-filter]').forEach(inp => { inp.value = ''; });
    renderPersons();
    $('#tab-persons [data-filter]').focus(); // gumb se je skril – fokus ostane v tabeli
  });

  function resetPersonForm() {
    personForm.reset();
    personForm.id.value = '';
    personForm.intervalDays.value = S.DEFAULT_INTERVAL;
    $('#interval-hint').hidden = true;
    $('#person-form-title').textContent = 'Nova oseba';
    $('.save-next', personForm).hidden = false;
    $('#person-added').hidden = true;
    formBlocked = new Set();
    $('#absence-error').hidden = true;
    renderAbsenceList();
  }

  function editPerson(p) {
    const f = personForm;
    f.id.value = p.id;
    f.name.value = p.name;
    f.room.value = p.room || '';
    f.note.value = p.note || '';
    f.intervalDays.value = S.intervalOf(p);
    setWeekdays($('.weekdays', f), p.allowedWeekdays);
    f.active.checked = p.active !== false;
    $('#person-form-title').textContent = 'Uredi osebo: ' + p.name;
    $('.save-next', f).hidden = true;
    formBlocked = new Set(p.blockedDates || []);
    renderAbsenceList();
  }

  // Obdobje { from, to } kot »30. 10. 2026 – 2. 11. 2026 (4 dni)« oz. »3. 11. 2026« za en dan.
  function rangeText(r) {
    return r.from === r.to ? fmtDate(r.from)
      : fmtDate(r.from) + ' – ' + fmtDate(r.to) + ' (' + S.nDays(S.diffDays(r.from, r.to) + 1) + ')';
  }

  // Omejitve v obrazcu osebe, združene v obdobja; pretekla obdobja so siva.
  function renderAbsenceList() {
    const ul = $('.absence-list', personForm);
    ul.innerHTML = '';
    const ranges = S.groupDateRanges([...formBlocked].sort());
    if (!ranges.length) ul.appendChild(el('li', { class: 'hint', text: 'Ni omejitev.' }));
    const today = todayIso();
    ranges.forEach(r => {
      ul.appendChild(el('li', { class: r.to < today ? 'past' : '' }, [
        el('span', { text: rangeText(r) }),
        el('button', {
          type: 'button', class: 'x', title: 'Odstrani obdobje', 'aria-label': 'Odstrani obdobje', text: '×',
          onclick: () => {
            S.dateRange(r.from, r.to).forEach(d => formBlocked.delete(d));
            renderAbsenceList();
          }
        })
      ]));
    });
  }

  function addAbsence() {
    const f = personForm;
    const err = $('#absence-error');
    const from = f.absFrom.value;
    const to = f.absTo.value || from;
    let msg = '';
    if (!from || f.absFrom.validity.badInput) msg = 'Vnesite datum Od.';
    else if (f.absTo.validity.badInput) msg = 'Datum Do ni veljaven.';
    else if (to < from) msg = 'Datum Do je pred datumom Od.';
    else if (S.diffDays(from, to) + 1 > S.MAX_ABSENCE_DAYS) msg = `Obdobje je daljše od ${S.MAX_ABSENCE_DAYS} dni.`;
    err.textContent = msg;
    err.hidden = !msg;
    if (msg) return;
    S.dateRange(from, to).forEach(d => formBlocked.add(d));
    f.absFrom.value = '';
    f.absTo.value = '';
    renderAbsenceList();
    f.absFrom.focus();
  }

  $('#btn-add-absence').addEventListener('click', addAbsence);
  [personForm.absFrom, personForm.absTo].forEach(inp => inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addAbsence(); }
  }));

  function deletePerson(p) {
    if (!confirm(`Izbrišem osebo »${p.name}«? Odstranjena bo tudi iz vseh razporedov.`)) return;
    state.persons = state.persons.filter(x => x.id !== p.id);
    Object.values(state.schedules).forEach(s => {
      Object.keys(s.days || {}).forEach(d => { s.days[d] = s.days[d].filter(id => id !== p.id); });
    });
    saveClearUndo();
    render();
  }

  // Oseba z enim samim dovoljenim dnem → predlagaj interval 7 (vsak teden).
  $('.weekdays', personForm).addEventListener('change', () => {
    const hint = $('#interval-hint');
    const days = getWeekdays($('.weekdays', personForm));
    if (days.length === 1 && +personForm.intervalDays.value === S.DEFAULT_INTERVAL) {
      personForm.intervalDays.value = '7';
      hint.textContent = `Samo ${WD_SHORT[days[0]].toLowerCase()} → interval nastavljen na 7 dni (vsak teden). Po potrebi ga spremenite.`;
      hint.hidden = false;
    } else if (days.length !== 1) {
      hint.hidden = true;
    }
  });

  personForm.addEventListener('submit', e => {
    e.preventDefault();
    const f = personForm;
    const cid = currentCorridorId();
    if (!cid) return;
    const data = {
      name: f.name.value.trim(),
      room: f.room.value.trim(),
      note: f.note.value.trim(),
      intervalDays: S.intervalOf({ intervalDays: f.intervalDays.value }),
      allowedWeekdays: getWeekdays($('.weekdays', f)),
      active: f.active.checked,
      blockedDates: [...formBlocked].sort()
    };
    const existing = personById(f.id.value);
    const oldBlocked = new Set((existing && existing.blockedDates) || []);
    const changed = data.blockedDates.filter(d => !oldBlocked.delete(d)).concat([...oldBlocked]);
    if (existing) Object.assign(existing, data);
    else state.persons.push(Object.assign({ id: newId(), corridorId: cid }, data));
    saveClearUndo();
    render();
    // Spremenjene omejitve v mesecu, ki že ima razpored, se upoštevajo šele ob ponovni sestavi.
    if (changed.some(d => state.schedules[S.scheduleKey(cid, d.slice(0, 7))])) {
      showStatus($('#persons-status'), `Omejitve osebe ${data.name} so spremenjene. Kliknite »Sestavi« v zavihku ` +
        'Razpored, da se upoštevajo v razporedu.', 'ok');
    }
    if (!existing && e.submitter && e.submitter.value === 'next') {
      resetPersonForm();
      const added = $('#person-added');
      added.textContent = 'Dodano: ' + data.name;
      added.hidden = false;
      f.name.focus();
    } else {
      personDialog.close();
    }
  });
  $('#btn-new-person').addEventListener('click', () => openPersonDialog());

  // ---------- UVOZ OSEB (prilepljen seznam) ----------
  const importForm = $('#import-form');
  const importDialog = $('#import-dialog');

  // Osebe iz prilepljenega besedila; tiste, ki na hodniku že obstajajo (enako ime in soba; če soba pri eni od
  // obeh ni vpisana, zadošča ime), se izpustijo.
  function importCandidates() {
    const res = Csv.parsePersons(importForm.text.value);
    // Primerjava ne loči velikih črk, presledkov (tudi nedeljivih) in zapisa šumnikov v Unicode (NFC/NFD).
    const norm = s => str(s).normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('sl');
    const rooms = new Map(); // ime → sobe oseb s tem imenom ('' = brez sobe)
    const add = p => {
      const n = norm(p.name);
      if (!rooms.has(n)) rooms.set(n, new Set());
      rooms.get(n).add(norm(p.room));
    };
    const exists = p => {
      const r = rooms.get(norm(p.name));
      const room = norm(p.room);
      return !!r && (!room || r.has('') || r.has(room));
    };
    personsOf(currentCorridorId()).forEach(add);
    const fresh = [];
    let dup = 0;
    res.persons.forEach(p => {
      if (exists(p)) dup++;
      else { add(p); fresh.push(p); }
    });
    return { fresh, dup, bad: res.bad };
  }

  function updateImportPreview() {
    const { fresh, dup, bad } = importCandidates();
    // Prva nova oseba kot zgled, da se vidi, ali sta ime in soba prav prepoznana.
    const parts = ['Novih oseb: ' + fresh.length + (fresh.length ? ', npr. »' + personLabel(fresh[0]) + '«' : '')];
    if (dup) parts.push('že obstaja ali podvojeno (preskočeno): ' + dup);
    if (bad.length) parts.push('neveljavne vrstice: ' + bad.join(' | '));
    $('#import-preview').textContent = importForm.text.value.trim() ? parts.join(' · ') : '';
  }

  $('#btn-import-persons').addEventListener('click', () => {
    const c = corridorById(currentCorridorId());
    if (c) openDialog(importDialog, () => {
      importForm.reset();
      updateImportPreview();
      $('#import-title').textContent = 'Uvoz oseb – hodnik ' + c.name;
    });
  });
  importForm.text.addEventListener('input', updateImportPreview);

  importForm.addEventListener('submit', e => {
    e.preventDefault();
    const cid = currentCorridorId();
    const { fresh } = importCandidates();
    if (!cid || !fresh.length) return;
    fresh.forEach(p => state.persons.push({
      id: newId(), corridorId: cid, name: p.name, room: p.room, note: p.note,
      intervalDays: S.DEFAULT_INTERVAL, allowedWeekdays: [], active: true
    }));
    saveClearUndo();
    importDialog.close();
    render();
    showStatus($('#persons-status'), 'Uvoženih oseb: ' + fresh.length + '.', 'ok');
  });

  // Prekliči in × zapreta okno (Escape ga zapre sam); obrazec se ponastavi ob naslednjem odprtju.
  $$('.modal .cancel, .modal .modal-close').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

  // ---------- RAZPORED ----------
  function defaultMonth() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    return S.monthKey(d.getFullYear(), d.getMonth() + 1);
  }
  function currentMonth() {
    if (!/^\d{4}-\d{2}$/.test(state.ui.month || '')) state.ui.month = defaultMonth();
    return state.ui.month;
  }
  function currentKey() { return S.scheduleKey(currentCorridorId(), currentMonth()); }
  function ym() { return currentMonth().split('-').map(Number); }

  function showStatus(box, text, level) {
    box.textContent = text || '';
    ['ok', 'warn', 'error'].forEach(l => box.classList.toggle(l, l === level));
    box.hidden = !text;
  }
  function setStatus(text, level) { showStatus($('#schedule-status'), text, level); }

  function ensureSchedule() {
    const key = currentKey();
    if (!state.schedules[key]) state.schedules[key] = { days: {}, edited: false };
    return state.schedules[key];
  }

  function renderSchedule() {
    const cid = currentCorridorId();
    const c = corridorById(cid);
    const undoBtn = $('#btn-undo');
    const lastUndo = undoStack[undoStack.length - 1];
    undoBtn.disabled = !lastUndo;
    undoBtn.title = lastUndo ? 'Razveljavi: ' + lastUndo.label : '';
    $('#schedule-month').value = currentMonth();
    const cal = $('#calendar');
    cal.innerHTML = '';
    $('#schedule-warnings').innerHTML = '';
    $('#schedule-summary').innerHTML = '';
    $('#schedule-notes').innerHTML = '';
    cal.classList.remove('has-notes');
    if (!c) {
      $('#schedule-title').textContent = '';
      setStatus('Najprej dodajte hodnik in osebe.', 'warn');
      return;
    }
    const [y, m] = ym();
    const sched = state.schedules[currentKey()];
    const persons = personsOf(cid);
    const byId = {};
    persons.forEach(p => { byId[p.id] = p; });
    // Osebe z opombo, ki so ta mesec v razporedu, dobijo zaporedno številko (po imenu).
    const scheduled = new Set(sched ? Object.values(sched.days).flat() : []);
    const noted = persons.filter(p => scheduled.has(p.id) && noteText(p));
    const noteNo = {};
    noted.forEach((p, i) => { noteNo[p.id] = i + 1; });
    cal.classList.toggle('has-notes', noted.length > 0);

    $('#schedule-title').textContent = `Plan kopanja – ${c.name} – ${monthName(currentMonth())}`;
    document.title = $('#schedule-title').textContent;

    WD_ORDER.forEach(w => cal.appendChild(el('div', { class: 'cal-head', text: WD_SHORT[w] })));
    const dates = S.monthDays(y, m);
    for (let i = 0; i < (S.weekday(dates[0]) + 6) % 7; i++) cal.appendChild(el('div', { class: 'day blank' }));

    dates.forEach(d => {
      const info = S.dayInfo(c, d);
      const cap = info.capacity;
      const ids = ((sched && sched.days[d]) || []).filter(id => byId[id]);
      const cls = ['day'];
      if (!info.valid) cls.push('excluded');
      if (info.override) cls.push('override');
      if (info.valid && ids.length > cap) cls.push('over');
      if (selection && selection.date !== d) cls.push('drop-target');
      let note = info.valid ? (info.holiday || '') : info.reason;
      if (info.valid && info.override) note = 'Izjema' + (info.holiday ? ' (' + info.holiday + ')' : '');
      const cell = el('div', { class: cls.join(' '), dataset: { date: d }, onclick: () => onDayClick(d) }, [
        el('div', { class: 'day-head' }, [
          el('span', { class: 'day-num', text: String(+d.slice(8)) }),
          el('span', { class: 'day-note', text: note }),
          el('button', {
            type: 'button', class: 'edit-cap', title: 'Uredi dan: največ oseb, omejitve oseb', text: '✎',
            onclick: ev => { ev.stopPropagation(); editingDay = editingDay === d ? null : d; focusBlocked = false; renderSchedule(); }
          })
        ])
      ]);
      ids.forEach(id => {
        const p = byId[id];
        const chipCls = ['chip'];
        // Izbran čip; ostali termini iste osebe v mesecu so označeni drugače.
        if (selection && selection.personId === id) chipCls.push(selection.date === d ? 'selected' : 'same-person');
        if (!S.personAllows(p, d) || !info.valid) chipCls.push('bad');
        cell.appendChild(el('div', {
          class: chipCls.join(' '),
          title: p.note || '',
          onclick: ev => { ev.stopPropagation(); onChipClick(d, id); }
        }, [
          el('span', {}, [
            p.name,
            p.room ? el('span', { class: 'room', text: ' (' + p.room + ')' }) : null,
            noteNo[id] ? noteRef(noteNo[id]) : null
          ]),
          el('button', {
            type: 'button', class: 'x', title: 'Odstrani', text: '×',
            onclick: ev => { ev.stopPropagation(); removePerson(d, id); }
          })
        ]));
      });
      const blocked = persons.filter(p => S.personBlocked(p, d));
      if (blocked.length) {
        cell.appendChild(el('div', {
          class: 'day-blocked no-print', title: 'Se ne more kopati',
          text: '⊘ ' + blocked.map(p => p.name).join(', ')
        }));
      }
      if (editingDay === d) cell.appendChild(capacityEditor(c, d, info, persons));
      if (info.valid || ids.length) {
        cell.appendChild(el('span', { class: 'day-count', text: ids.length + ' / ' + cap }));
        cell.appendChild(el('button', {
          type: 'button', class: 'add-btn small', title: 'Dodaj osebo', text: '+',
          onclick: ev => { ev.stopPropagation(); showAddSelect(ev.currentTarget, d, ids, persons); }
        }));
      }
      cal.appendChild(cell);
    });

    if (!sched) {
      if (!$('#schedule-status').classList.contains('ok')) {
        setStatus(persons.length
          ? 'Razpored za ta mesec še ni sestavljen. Kliknite »Sestavi«.'
          : 'Na tem hodniku še ni oseb – dodajte jih v zavihku Osebe.', 'warn');
      }
      return;
    }

    renderWarnings(S.analyzeSchedule(c, state.persons, y, m, sched.days, state.schedules), sched);
    renderNotes(noted, noteNo);
    renderSummary(c, persons, sched.days);
  }

  // Urejevalnik dneva: izjema (največ oseb) in osebe, ki se ta dan ne morejo kopati.
  function capacityEditor(c, d, info, persons) {
    const input = el('input', { type: 'number', min: 0, value: info.capacity, 'aria-label': 'Največ oseb' });
    const commit = () => {
      const n = parseInt(input.value, 10);
      if (!Number.isFinite(n) || n < 0) { input.focus(); return; }
      setOverride(c, d, n);
    };
    const close = () => { editingDay = null; renderSchedule(); };
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    });
    const blocked = persons.filter(p => S.personBlocked(p, d));
    const options = persons.filter(p => p.active !== false && !S.personBlocked(p, d));
    const sel = el('select', { 'aria-label': 'Dodaj omejitev osebi' }, [el('option', { value: '', text: '— dodaj osebo —' })]
      .concat(options.map(p => el('option', { value: p.id, text: personLabel(p) }))));
    sel.addEventListener('change', () => { if (sel.value) setBlocked(d, personById(sel.value), true); });
    const focusSel = focusBlocked;
    focusBlocked = false;
    setTimeout(() => { if (focusSel) sel.focus(); else { input.focus(); input.select(); } }, 0);
    return el('div', { class: 'cap-edit no-print', onclick: ev => ev.stopPropagation() }, [
      el('label', {}, ['Največ oseb ', input]),
      el('div', { class: 'cap-edit-buttons' }, [
        el('button', { type: 'button', class: 'small primary', text: 'Shrani', onclick: commit }),
        el('button', { type: 'button', class: 'small', text: 'Prekliči', title: 'Zapri brez shranjevanja', onclick: close }),
        info.override
          ? el('button', { type: 'button', class: 'small', text: 'Privzeto', title: 'Odstrani izjemo', onclick: () => setOverride(c, d, null) })
          : null
      ]),
      el('div', { class: 'cap-blocked' }, [
        el('div', { text: 'Se ne more kopati:' }),
        blocked.length
          ? el('ul', {}, blocked.map(p => el('li', {}, [
              el('span', { text: personLabel(p) }),
              el('button', { type: 'button', class: 'x', title: 'Odstrani omejitev', text: '×', onclick: () => setBlocked(d, p, false) })
            ])))
          : null,
        options.length ? sel : null
      ])
    ]);
  }

  // Omejitev osebe na dan `d`; urejevalnik dneva ostane odprt.
  function setBlocked(d, p, on) {
    pushUndo('omejitev');
    const dates = new Set(p.blockedDates || []);
    if (on) dates.add(d); else dates.delete(d);
    p.blockedDates = Array.from(dates).sort();
    focusBlocked = true;
    save();
    const sched = state.schedules[currentKey()];
    const hint = sched ? ' Kliknite »Sestavi«, da se upošteva v razporedu.' : '';
    const placed = on && sched && (sched.days[d] || []).includes(p.id);
    setStatus((on
      ? `Omejitev: ${p.name} se ${S.shortDate(d)} ne more kopati.` + (placed ? ' Opozorilo: ta dan je že v razporedu.' : '')
      : `Omejitev odstranjena: ${p.name} se ${S.shortDate(d)} lahko kopa.`) + hint, placed ? 'warn' : 'ok');
    renderSchedule();
  }

  function setOverride(c, d, n) {
    const old = (c.dayOverrides || {})[d];
    if ((old == null ? null : old) === n) { editingDay = null; renderSchedule(); return; }
    pushUndo('izjema');
    c.dayOverrides = c.dayOverrides || {};
    if (n == null) delete c.dayOverrides[d]; else c.dayOverrides[d] = n;
    editingDay = null;
    save();
    const hint = state.schedules[currentKey()] ? ' Kliknite »Sestavi«, da se upošteva v razporedu.' : '';
    setStatus((n == null
      ? `Izjema za ${S.shortDate(d)} odstranjena (privzeto: največ ${S.capacityOn(c, d)}).`
      : `Izjema za ${S.shortDate(d)}: največ ${n}.`) + hint, 'ok');
    renderSchedule();
  }

  // Informacije (npr. zamuda, ker vmes ni bilo dovoljenega dneva) se štejejo posebej, ne med opozorila.
  function countWarnings(warnings) {
    const info = warnings.filter(w => w.level === 'info').length;
    return { serious: warnings.length - info, info };
  }

  function renderWarnings(analysis, sched) {
    const box = $('#schedule-warnings');
    const order = { error: 0, warn: 1, info: 2 };
    const warnings = analysis.slice().sort((a, b) => order[a.level] - order[b.level]);
    // Zastarel razpored: opozorilo na vrhu seznama.
    if (sched.stale) {
      warnings.unshift({ level: 'warn', text: `Razpored za ${monthName(sched.stale)} je bil spremenjen po sestavi ` +
        'tega meseca – roki na začetku meseca morda niso več pravilni. Preverite opozorila ali kliknite »Sestavi«.' });
    }
    const n = countWarnings(warnings);
    const counts = warnings.length ? ` (${n.serious})` + (n.info ? ` · informacije (${n.info})` : '') : '';
    box.appendChild(el('h3', { text: 'Opozorila' + counts + (sched.edited ? ' – razpored je ročno popravljen' : '') }));
    if (!warnings.length) {
      box.appendChild(el('p', { class: 'hint', text: 'Ni opozoril.' }));
      return;
    }
    box.appendChild(el('ul', {}, warnings.map(w => el('li', { class: w.level, text: w.text }))));
  }

  function noteText(p) { return str(p.note).trim(); }
  function noteRef(n) { return el('sup', { class: 'note-ref', text: String(n) }); }

  // Legenda opomb pod koledarjem (natisne se skupaj z njim); številke so iste kot ob imenih v koledarju.
  function renderNotes(noted, noteNo) {
    if (!noted.length) return;
    const box = $('#schedule-notes');
    box.appendChild(el('h3', { text: 'Opombe' }));
    box.appendChild(el('ul', { class: 'notes' }, noted.map(p => el('li', {}, [
      noteRef(noteNo[p.id]), ' ' + personLabel(p) + ' – ' + noteText(p)
    ]))));
  }

  function renderSummary(c, persons, days) {
    const box = $('#schedule-summary');
    box.appendChild(el('h3', { text: 'Povzetek' }));
    const [y, m] = ym();
    const last = S.knownLastBaths(c, persons, state.schedules, S.monthDays(y, m)[0]);
    const rows = persons.map(p => {
      const ds = Object.keys(days).filter(d => days[d].includes(p.id)).sort();
      // Število dni med zaporednimi kopanji; prvi razmik (v oklepaju) je od kopanja v prejšnjem mesecu.
      const gapCells = [];
      S.bathGaps(p, last[p.id], ds).forEach((g, i) => {
        if (i) gapCells.push(', ');
        gapCells.push(el('span', {
          class: g.level === 'late' ? 'gap-late' : g.level === 'short' ? 'gap-short' : '',
          title: g.fromPrev ? 'Od zadnjega kopanja v prejšnjem mesecu (' + S.shortDate(last[p.id]) + ')' : null,
          text: g.fromPrev ? '(' + g.days + ')' : String(g.days)
        }));
      });
      return el('tr', { class: p.active === false ? 'inactive' : '' }, [
        el('td', { text: p.name }),
        el('td', { text: p.room || '' }),
        el('td', { text: String(S.intervalOf(p)) }),
        el('td', { text: String(ds.length) }),
        el('td', { text: ds.map(d => S.shortDate(d)).join(', ') }),
        el('td', {}, gapCells)
      ]);
    });
    const gapsHint = 'V oklepaju: od zadnjega kopanja v prejšnjem mesecu. ' +
      'Oranžno: daljši od intervala, sivo: krajši od polovice intervala.';
    box.appendChild(el('table', { class: 'list' }, [
      el('thead', {}, [el('tr', {}, ['Ime', 'Soba', 'Interval', 'Št. kopanj', 'Datumi', 'Razmak med datumi']
        .map(t => el('th', { text: t, title: t === 'Razmak med datumi' ? gapsHint : null })))]),
      el('tbody', {}, rows)
    ]));
  }

  // Opozorila ob ročnem popravku (ne blokirajo).
  function checkPlacement(d, personId, ids) {
    const p = personById(personId);
    return [S.dayIssue(corridorById(currentCorridorId()), d, ids.length), p && S.personDayIssue(p, d)]
      .filter(Boolean).map(m => m + '.');
  }

  // Sprememba tega meseca naredi kasnejše razporede hodnika zastarele (roki se računajo iz prejšnjih mesecev).
  // Ohrani najzgodnejši mesec, ki je razpored naredil zastarelega.
  function markLaterStale() {
    const month = currentMonth();
    S.laterScheduleKeys(state.schedules, currentCorridorId(), month).forEach(k => {
      const s = state.schedules[k];
      if (!s.stale || s.stale > month) s.stale = month;
    });
  }

  function monthName(month) {
    const [y, m] = month.split('-').map(Number);
    return MONTHS[m - 1] + ' ' + y;
  }

  function afterEdit(sched, msgs, okText) {
    sched.edited = true;
    markLaterStale();
    save();
    setStatus(msgs.length ? 'Opozorilo: ' + msgs.join(' ') : okText, msgs.length ? 'warn' : 'ok');
    renderSchedule();
  }

  function onChipClick(d, id) {
    if (selection && selection.date === d && selection.personId === id) selection = null;
    else selection = { date: d, personId: id };
    setStatus(selection ? 'Izbrano. Kliknite na dan, kamor želite osebo premakniti (ponovni klik prekliče).' : '', null);
    renderSchedule();
  }

  function onDayClick(d) {
    if (!selection || selection.date === d) return;
    const sched = ensureSchedule();
    const { date: from, personId } = selection;
    selection = null;
    const target = sched.days[d] || [];
    if (target.includes(personId)) {
      setStatus('Oseba je na ta dan že razporejena.', 'warn');
      renderSchedule();
      return;
    }
    pushUndo('premik');
    sched.days[from] = (sched.days[from] || []).filter(id => id !== personId);
    sched.days[d] = target.concat(personId);
    const p = personById(personId);
    afterEdit(sched, checkPlacement(d, personId, sched.days[d]),
      `Premaknjeno: ${p ? p.name : 'oseba'} (${S.shortDate(from)} → ${S.shortDate(d)})`);
  }

  function removePerson(d, id) {
    pushUndo('odstranitev');
    const sched = ensureSchedule();
    sched.days[d] = (sched.days[d] || []).filter(x => x !== id);
    if (selection && selection.personId === id) selection = null;
    const p = personById(id);
    afterEdit(sched, [], `Odstranjeno: ${p ? p.name : 'oseba'} (${S.shortDate(d)})`);
  }

  function showAddSelect(btn, d, ids, persons) {
    const options = persons.filter(p => !ids.includes(p.id))
      .sort((a, b) => (a.active === false) - (b.active === false) || byName(a, b));
    if (!options.length) { setStatus('Vse osebe so na ta dan že razporejene.', 'warn'); return; }
    const sel = el('select', { onclick: ev => ev.stopPropagation() }, [el('option', { value: '', text: '— dodaj osebo —' })]
      .concat(options.map(p => el('option', {
        value: p.id,
        text: personLabel(p) + (p.active === false ? ' – neaktivna' : '') + (S.personBlocked(p, d) ? ' – ne more' : '')
      }))));
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      pushUndo('dodajanje');
      const sched = ensureSchedule();
      sched.days[d] = (sched.days[d] || []).concat(sel.value);
      const p = personById(sel.value);
      afterEdit(sched, checkPlacement(d, sel.value, sched.days[d]), `Dodano: ${p.name} (${S.shortDate(d)})`);
    });
    // Po izbiri je select že odstranjen (afterEdit je izrisal koledar) – ne izrisuj še enkrat.
    sel.addEventListener('blur', () => setTimeout(() => { if (sel.isConnected) renderSchedule(); }, 150));
    btn.replaceWith(sel);
    sel.focus();
  }

  $('#btn-build').addEventListener('click', () => {
    const c = corridorById(currentCorridorId());
    if (!c) return;
    const key = currentKey();
    const old = state.schedules[key];
    const month = currentMonth();
    const prev = S.prevMonth(month);
    if (!state.schedules[S.scheduleKey(c.id, prev)] && S.hasEarlierSchedule(state.schedules, c.id, month) &&
      !confirm(`Razpored za ${monthName(prev)} ni sestavljen, zato bodo roki izračunani iz starejših podatkov ` +
        'ali kot pri novih osebah. Vseeno sestavim?')) return;
    if (old && old.edited && !confirm('Razpored za ta mesec je bil ročno popravljen. Ga res želite na novo sestaviti (popravki se izgubijo)?')) return;
    pushUndo('sestava');
    const [y, m] = ym();
    const res = S.buildSchedule(c, state.persons, y, m, state.schedules);
    state.schedules[key] = { days: res.days, edited: false };
    markLaterStale();
    selection = null;
    save();
    const n = countWarnings(res.warnings);
    const infoText = n.info ? `, informacij: ${n.info}` : '';
    const seeBelow = res.warnings.length ? ' (glej spodaj)' : '';
    setStatus(n.serious
      ? `Razpored sestavljen, opozoril: ${n.serious}${infoText}${seeBelow}.`
      : `Razpored sestavljen brez opozoril${infoText}${seeBelow}.`, n.serious ? 'warn' : 'ok');
    renderSchedule();
  });

  $('#btn-clear-schedule').addEventListener('click', () => {
    const key = currentKey();
    if (!state.schedules[key]) return;
    if (!confirm('Izbrišem razpored za ta mesec?')) return;
    pushUndo('brisanje razporeda');
    delete state.schedules[key];
    markLaterStale();
    selection = null;
    save();
    setStatus('', null);
    renderSchedule();
  });

  // Izbran čip (in z njim označeni termini ter cilji premika) se ne natisne – tudi pri tiskanju s Ctrl+P.
  // V desni kot naslova se vpiše čas tiskanja.
  window.addEventListener('beforeprint', () => {
    if (selection) { selection = null; renderSchedule(); }
    $('#print-time').textContent = 'Natisnjeno: ' + fmtDateTime(new Date());
  });
  $('#btn-print').addEventListener('click', () => window.print());

  $('#schedule-month').addEventListener('change', e => {
    if (!e.target.value) return;
    state.ui.month = e.target.value;
    clearScheduleInteraction();
    setStatus('', null);
    save();
    renderSchedule();
  });

  $$('.corridor-select').forEach(sel => sel.addEventListener('change', e => {
    state.ui.corridorId = e.target.value;
    clearScheduleInteraction();
    setStatus('', null);
    save();
    render();
  }));

  $('#btn-undo').addEventListener('click', undo);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (selection || editingDay)) {
      clearScheduleInteraction();
      setStatus('', null);
      renderSchedule();
    }
    // Ctrl+Z samo v zavihku Razpored in ne med vnosom v polje (tam ostane običajna razveljavitev besedila).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' &&
      state.ui.tab === 'schedule' && !e.target.closest('input, textarea, select') &&
      !document.querySelector('dialog[open]')) {
      if (undo()) e.preventDefault();
    }
  });

  // ---------- VARNOSTNA KOPIJA ----------
  function renderBackup() {
    $('#backup-info').textContent = `Trenutno shranjeno – hodniki: ${state.corridors.length}, ` +
      `osebe: ${state.persons.length}, mesečni razporedi: ${Object.keys(state.schedules).length}. ` +
      lastExportText();
  }

  function lastExportText() {
    if (!state.ui.lastExport) return 'Podatki še niso bili izvoženi.';
    return 'Zadnji izvoz: ' + fmtDateTime(new Date(state.ui.lastExport)) + '.';
  }

  // ---------- PRAVILA RAZPOREJANJA ----------
  function todayIso() {
    const d = new Date();
    return S.monthKey(d.getFullYear(), d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0');
  }

  function ruleItem(r, withSection) {
    const period = !r.to ? `velja od ${fmtDate(r.from)}`
      : r.to === r.from ? `veljalo le ${fmtDate(r.from)}`
      : `veljalo ${fmtDate(r.from)} – ${fmtDate(r.to)}`;
    return el('li', {}, [
      withSection ? el('strong', { text: r.section + ': ' }) : null,
      r.text + ' ',
      el('span', { class: 'rule-period', text: '(' + period + ')' })
    ]);
  }

  // Pravila, ki veljajo na izbrani dan (po razdelkih), in pravila, ki so pred tem dnem že prenehala veljati.
  function renderRules() {
    const day = $('#rules-date').value || todayIso();
    const box = $('#rules-list');
    box.innerHTML = '';
    if (day < Rules.START) {
      box.appendChild(el('p', { class: 'status warn', text: `Zgodovina pravil se začne ${fmtDate(Rules.START)}.` }));
      return;
    }
    Rules.SECTIONS.forEach(section => {
      const rules = Rules.RULES.filter(r => r.section === section && Rules.validOn(r, day));
      if (!rules.length) return;
      box.appendChild(el('div', { class: 'card rules' }, [
        el('h3', { text: section }),
        el('ul', {}, rules.map(r => ruleItem(r)))
      ]));
    });
    const past = Rules.RULES.filter(r => r.to && r.to < day)
      .sort((a, b) => b.to.localeCompare(a.to));
    box.appendChild(el('div', { class: 'card rules past' }, [
      el('h3', { text: 'Pravila, ki ne veljajo več' }),
      past.length
        ? el('ul', {}, past.map(r => ruleItem(r, true)))
        : el('p', { class: 'hint', text: 'Ni takih pravil.' })
    ]));
  }

  // Datum se nastavi samo enkrat; med vnosom s tipkovnico Chrome sproži 'change' s prazno vrednostjo – takrat
  // ne izrisuj (in ne prepiši vnosa), dokler datum ni popoln.
  $('#rules-date').value = todayIso();
  $('#rules-date').min = Rules.START;
  $('#rules-date').addEventListener('change', e => {
    if (e.target.value && !e.target.validity.badInput) renderRules();
  });

  function importStatus(text, level) { showStatus($('#import-status'), text, level); }

  // Čas izvoza se zapiše pred izvozom, da je tudi v izvoženi datoteki.
  $('#btn-export').addEventListener('click', () => {
    state.ui.lastExport = new Date().toISOString();
    save();
    Store.exportJSON(state);
    renderBackupReminder();
    renderBackup();
  });
  $('#backup-reminder').addEventListener('click', () => showTab('backup'));

  $('#import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    Store.importFile(file).then(data => {
      if (!confirm(`Uvozim ${data.corridors.length} hodnikov in ${data.persons.length} oseb? Trenutni podatki bodo prepisani.`)) return;
      data.ui = Object.assign({}, data.ui, { tab: 'backup' });
      state = data;
      saveClearUndo();
      render();
      importStatus('Podatki uvoženi.', 'ok');
    }).catch(err => importStatus(err.message, 'error'))
      .then(() => { e.target.value = ''; });
  });

  $('#btn-wipe').addEventListener('click', () => {
    if (!confirm('Res izbrišem VSE podatke (hodnike, osebe, razporede)? Tega ni mogoče razveljaviti.')) return;
    state = Store.empty();
    state.ui.tab = 'backup';
    saveClearUndo();
    render();
  });

  // ---------- zagon ----------
  $$('.weekdays').forEach(renderWeekdayBoxes);
  // Posamezni dnevi v filtru »Dovoljeni dnevi« (za »vsi« in »Samo omejeni«, ki sta v index.html).
  const wdFilter = $('#tab-persons [data-filter=weekdays]');
  WD_ORDER.forEach(w => wdFilter.appendChild(el('option', { value: w, text: WD_SHORT[w] })));
  $$('nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  showTab(state.ui.tab || (state.corridors.length ? 'schedule' : 'corridors'));
})();
