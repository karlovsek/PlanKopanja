/* Razčlenjevanje prilepljenega seznama oseb (CSV/TSV). Deluje v brskalniku (window.KSCsv) in v Node. */
(function (root) {
  'use strict';

  // Ena vrstica → polja. Ločilo: tabulator (lepljenje iz Excela), sicer podpičje, sicer vejica.
  // Polja v dvojnih narekovajih lahko vsebujejo ločilo ("" = narekovaj).
  function splitLine(line) {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"' && cur.trim() === '') { cur = ''; quoted = true; }
      else if (ch === sep) { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  const COLUMNS = {
    room: /^(soba|room)$/i,
    name: /^(ime|priimek|name)( in (ime|priimek))?$/i,
    note: /^(opomba|note)$/i
  };

  // Glava (npr. "Soba,Priimek in ime") določi stolpce; brez glave: 1 polje = ime, sicer soba, ime.
  // Vrne { persons: [{ name, room, note }], bad: [neveljavne vrstice] }.
  function parsePersons(text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const persons = [];
    const bad = [];
    if (!lines.length) return { persons, bad };

    let col = null;
    const head = splitLine(lines[0]);
    if (head.some(h => COLUMNS.room.test(h) || COLUMNS.name.test(h))) {
      col = {};
      Object.keys(COLUMNS).forEach(k => { col[k] = head.findIndex(h => COLUMNS[k].test(h)); });
      lines.shift();
    }

    lines.forEach(line => {
      const cells = splitLine(line);
      const c = col || (cells.length === 1 ? { name: 0, room: -1, note: -1 } : { room: 0, name: 1, note: 2 });
      const get = i => (i >= 0 && cells[i]) || '';
      const name = get(c.name).replace(/\s+/g, ' ');
      if (!name) bad.push(line.trim());
      else persons.push({ name, room: get(c.room), note: get(c.note) });
    });
    return { persons, bad };
  }

  const api = { splitLine, parsePersons };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KSCsv = api;
})(this);
