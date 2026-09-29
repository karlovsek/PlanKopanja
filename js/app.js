/* Uporabniški vmesnik Kopalnega seznama. */
(function () {
  'use strict';

  const S = window.KSScheduler;
  const Store = window.KSStorage;

  const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const WD_SHORT = ['Ned', 'Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob'];
  const MONTHS = ['januar', 'februar', 'marec', 'april', 'maj', 'junij', 'julij',
    'avgust', 'september', 'oktober', 'november', 'december'];

  let state = Store.load();
  let selection = null; // { date, personId } – izbran čip za premik
  let editingDay = null; // datum, za katerega je odprto urejanje izjeme

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

  function weekdayList(arr) {
    return WD_ORDER.filter(w => (arr || []).includes(w)).map(w => WD_SHORT[w]).join(', ');
  }

  function fmtDate(iso) { return S.shortDate(iso) + ' ' + iso.slice(0, 4); }

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
  }

  // Pojavno okno z obrazcem: ob vsakem odprtju prazno (nov vnos) ali izpolnjeno z `item` (urejanje).
  function openDialog(dlg, reset, fill, item) {
    reset();
    if (item) fill(item);
    dlg.showModal();
    $('form', dlg).name.focus();
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
    save();
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
    save();
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

  function renderPersons() {
    const cid = currentCorridorId();
    $('#persons-empty').hidden = !!cid;
    $('#btn-new-person').disabled = !cid;
    const tbody = $('#person-rows');
    tbody.innerHTML = '';
    if (!cid) return;
    const list = personsOf(cid);
    if (!list.length) {
      tbody.appendChild(el('tr', { class: 'empty' }, [el('td', { colspan: 7, text: 'Na tem hodniku ni oseb.' })]));
    }
    list.forEach(p => {
      tbody.appendChild(el('tr', { class: p.active === false ? 'inactive' : '' }, [
        el('td', { text: p.name }),
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

  function resetPersonForm() {
    personForm.reset();
    personForm.id.value = '';
    $('#interval-hint').hidden = true;
    $('#person-form-title').textContent = 'Nova oseba';
    $('.save-next', personForm).hidden = false;
    $('#person-added').hidden = true;
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
  }

  function deletePerson(p) {
    if (!confirm(`Izbrišem osebo »${p.name}«? Odstranjena bo tudi iz vseh razporedov.`)) return;
    state.persons = state.persons.filter(x => x.id !== p.id);
    Object.values(state.schedules).forEach(s => {
      Object.keys(s.days || {}).forEach(d => { s.days[d] = s.days[d].filter(id => id !== p.id); });
    });
    save();
    render();
  }

  // Oseba z enim samim dovoljenim dnem → predlagaj interval 7 (vsak teden).
  $('.weekdays', personForm).addEventListener('change', () => {
    const hint = $('#interval-hint');
    const days = getWeekdays($('.weekdays', personForm));
    if (days.length === 1 && personForm.intervalDays.value === '10') {
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
      active: f.active.checked
    };
    const existing = personById(f.id.value);
    if (existing) Object.assign(existing, data);
    else state.persons.push(Object.assign({ id: newId(), corridorId: cid }, data));
    save();
    render();
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
    $('#schedule-month').value = currentMonth();
    const cal = $('#calendar');
    cal.innerHTML = '';
    $('#schedule-warnings').innerHTML = '';
    $('#schedule-summary').innerHTML = '';
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

    $('#schedule-title').textContent = `Kopalni seznam – ${c.name} – ${MONTHS[m - 1]} ${y}`;
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
            type: 'button', class: 'edit-cap', title: 'Izjema: največ oseb ta dan', text: '✎',
            onclick: ev => { ev.stopPropagation(); editingDay = editingDay === d ? null : d; renderSchedule(); }
          })
        ])
      ]);
      ids.forEach(id => {
        const p = byId[id];
        const selected = selection && selection.date === d && selection.personId === id;
        cell.appendChild(el('div', {
          class: 'chip' + (selected ? ' selected' : '') + (!S.personAllows(p, d) || !info.valid ? ' bad' : ''),
          title: p.note || '',
          onclick: ev => { ev.stopPropagation(); onChipClick(d, id); }
        }, [
          el('span', {}, [p.name, p.room ? el('span', { class: 'room', text: ' (' + p.room + ')' }) : null]),
          el('button', {
            type: 'button', class: 'x', title: 'Odstrani', text: '×',
            onclick: ev => { ev.stopPropagation(); removePerson(d, id); }
          })
        ]));
      });
      if (editingDay === d) cell.appendChild(capacityEditor(c, d, info));
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
    renderSummary(persons, sched.days);
  }

  // Vnosno polje za izjemo (največ oseb) na izbran dan.
  function capacityEditor(c, d, info) {
    const input = el('input', { type: 'number', min: 0, value: info.capacity, 'aria-label': 'Največ oseb' });
    const commit = () => {
      const n = parseInt(input.value, 10);
      if (!Number.isFinite(n) || n < 0) { input.focus(); return; }
      setOverride(c, d, n);
    };
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ev.stopPropagation(); editingDay = null; renderSchedule(); }
    });
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return el('div', { class: 'cap-edit no-print', onclick: ev => ev.stopPropagation() }, [
      el('label', {}, ['Največ oseb ', input]),
      el('div', { class: 'cap-edit-buttons' }, [
        el('button', { type: 'button', class: 'small primary', text: 'Shrani', onclick: commit }),
        info.override
          ? el('button', { type: 'button', class: 'small', text: 'Privzeto', title: 'Odstrani izjemo', onclick: () => setOverride(c, d, null) })
          : null
      ])
    ]);
  }

  function setOverride(c, d, n) {
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

  function renderWarnings(warnings, sched) {
    const box = $('#schedule-warnings');
    box.appendChild(el('h3', { text: 'Opozorila' + (sched.edited ? ' (razpored je ročno popravljen)' : '') }));
    if (!warnings.length) {
      box.appendChild(el('p', { class: 'hint', text: 'Ni opozoril.' }));
      return;
    }
    const order = { error: 0, warn: 1, info: 2 };
    box.appendChild(el('ul', {}, warnings.slice()
      .sort((a, b) => order[a.level] - order[b.level])
      .map(w => el('li', { class: w.level, text: w.text }))));
  }

  function renderSummary(persons, days) {
    const box = $('#schedule-summary');
    box.appendChild(el('h3', { text: 'Povzetek' }));
    const rows = persons.map(p => {
      const ds = Object.keys(days).filter(d => days[d].includes(p.id)).sort();
      return el('tr', { class: p.active === false ? 'inactive' : '' }, [
        el('td', { text: p.name }),
        el('td', { text: p.room || '' }),
        el('td', { text: String(S.intervalOf(p)) }),
        el('td', { text: String(ds.length) }),
        el('td', { text: ds.map(d => S.shortDate(d)).join(', ') })
      ]);
    });
    box.appendChild(el('table', { class: 'list' }, [
      el('thead', {}, [el('tr', {}, ['Ime', 'Soba', 'Interval', 'Št. kopanj', 'Datumi'].map(t => el('th', { text: t })))]),
      el('tbody', {}, rows)
    ]));
  }

  // Opozorila ob ročnem popravku (ne blokirajo).
  function checkPlacement(d, personId, ids) {
    const p = personById(personId);
    return [S.dayIssue(corridorById(currentCorridorId()), d, ids.length), p && S.personDayIssue(p, d)]
      .filter(Boolean).map(m => m + '.');
  }

  function afterEdit(sched, msgs, okText) {
    sched.edited = true;
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
    sched.days[from] = (sched.days[from] || []).filter(id => id !== personId);
    sched.days[d] = target.concat(personId);
    const p = personById(personId);
    afterEdit(sched, checkPlacement(d, personId, sched.days[d]),
      `Premaknjeno: ${p ? p.name : 'oseba'} (${S.shortDate(from)} → ${S.shortDate(d)})`);
  }

  function removePerson(d, id) {
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
        text: p.name + (p.room ? ' (' + p.room + ')' : '') + (p.active === false ? ' – neaktivna' : '')
      }))));
    sel.addEventListener('change', () => {
      if (!sel.value) return;
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
    if (old && old.edited && !confirm('Razpored za ta mesec je bil ročno popravljen. Ga res želite na novo sestaviti (popravki se izgubijo)?')) return;
    const [y, m] = ym();
    const res = S.buildSchedule(c, state.persons, y, m, state.schedules);
    state.schedules[key] = { days: res.days, edited: false };
    selection = null;
    save();
    const serious = res.warnings.filter(w => w.level !== 'info').length;
    setStatus(serious ? `Razpored sestavljen, opozoril: ${serious} (glej spodaj).` : 'Razpored sestavljen brez opozoril.', serious ? 'warn' : 'ok');
    renderSchedule();
  });

  $('#btn-clear-schedule').addEventListener('click', () => {
    const key = currentKey();
    if (!state.schedules[key]) return;
    if (!confirm('Izbrišem razpored za ta mesec?')) return;
    delete state.schedules[key];
    selection = null;
    save();
    setStatus('', null);
    renderSchedule();
  });

  $('#btn-print').addEventListener('click', () => {
    selection = null;
    renderSchedule();
    window.print();
  });

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

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (selection || editingDay)) {
      clearScheduleInteraction();
      setStatus('', null);
      renderSchedule();
    }
  });

  // ---------- VARNOSTNA KOPIJA ----------
  function renderBackup() {
    $('#backup-info').textContent = `Trenutno shranjeno – hodniki: ${state.corridors.length}, ` +
      `osebe: ${state.persons.length}, mesečni razporedi: ${Object.keys(state.schedules).length}.`;
  }

  function importStatus(text, level) { showStatus($('#import-status'), text, level); }

  $('#btn-export').addEventListener('click', () => Store.exportJSON(state));

  $('#import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    Store.importFile(file).then(data => {
      if (!confirm(`Uvozim ${data.corridors.length} hodnikov in ${data.persons.length} oseb? Trenutni podatki bodo prepisani.`)) return;
      data.ui = Object.assign({}, data.ui, { tab: 'backup' });
      state = data;
      save();
      render();
      importStatus('Podatki uvoženi.', 'ok');
    }).catch(err => importStatus(err.message, 'error'))
      .then(() => { e.target.value = ''; });
  });

  $('#btn-wipe').addEventListener('click', () => {
    if (!confirm('Res izbrišem VSE podatke (hodnike, osebe, razporede)? Tega ni mogoče razveljaviti.')) return;
    state = Store.empty();
    state.ui.tab = 'backup';
    save();
    render();
  });

  // ---------- zagon ----------
  $$('.weekdays').forEach(renderWeekdayBoxes);
  $$('nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  showTab(state.ui.tab || (state.corridors.length ? 'schedule' : 'corridors'));
})();
