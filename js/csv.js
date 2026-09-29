/* Razčlenjevanje prilepljenega seznama oseb (CSV/TSV). Deluje v brskalniku (window.KSCsv) in v Node. */
(function (root) {
  'use strict';

  const SEPS = ['\t', ';', ','];

  // Besedilo → vrstice. Prelom v polju z narekovaji (celica iz Excela z Alt+Enter) ne začne nove vrstice;
  // če kak narekovaj ostane odprt do konca, se besedilo razdeli kar po prelomih.
  function splitRecords(text) {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cur += '""'; i++; continue; }
        if (ch === '"') quoted = false;
        cur += ch;
      } else if (ch === '\n') { out.push(cur); cur = ''; }
      else {
        if (ch === '"' && /(^|[\t;,])\s*$/.test(cur)) quoted = true;
        cur += ch;
      }
    }
    if (quoted) return text.split('\n');
    out.push(cur);
    return out;
  }

  // Ločilo: znak, ki se v danih vrsticah izven narekovajev pojavi največkrat; ob enakem številu ima prednost
  // tabulator (lepljenje iz Excela), nato podpičje. Podpičje v opombi tako ne razbije vrstice, ločene z vejicami.
  function detectSep(lines) {
    const n = { '\t': 0, ';': 0, ',': 0 };
    lines.forEach(line => {
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (!quoted && SEPS.includes(ch)) n[ch]++;
      }
    });
    return SEPS.reduce((best, s) => (n[s] > n[best] ? s : best));
  }

  // Ena vrstica → polja, ločena s `sep`. Polja v dvojnih narekovajih lahko vsebujejo ločilo ("" = narekovaj).
  function splitLine(line, sep) {
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
    room: /^((št\.?|številka)\s*)?(soba|sobe|room)(\s*(št\.?|no\.?))?$/i,
    name: /^(ime|priimek|name)( in (ime|priimek))?$/i,
    note: /^(opomba|note)$/i
  };

  // Ločilo vrstice, če je vrstica glava (vsaj en stolpec je soba ali ime), sicer null.
  function headerSep(line) {
    const sep = detectSep([line]);
    return splitLine(line, sep).some(h => COLUMNS.room.test(h) || COLUMNS.name.test(h)) ? sep : null;
  }

  // Glava (npr. "Soba,Priimek in ime") določi stolpce in ločilo; je lahko v eni od prvih treh vrstic
  // (vrstice nad njo, npr. naslov seznama, se ne uvozijo). Ločena stolpca "Priimek" in "Ime" se združita.
  // Brez glave: 1 polje = ime, sicer soba, ime(, opomba) – ali ime, soba, če so številke večinoma v drugem stolpcu.
  // Vrne { persons: [{ name, room, note }], bad: [neveljavne vrstice] }.
  function parsePersons(text) {
    const lines = splitRecords(String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')).filter(l => l.trim());
    const persons = [];
    const bad = [];

    let col = null;
    let sep = null;
    const h = lines.slice(0, 3).findIndex(l => (sep = headerSep(l)) !== null);
    if (h >= 0) {
      const head = splitLine(lines[h], sep);
      col = {
        room: head.findIndex(x => COLUMNS.room.test(x)),
        name: head.map((x, i) => (COLUMNS.name.test(x) ? i : -1)).filter(i => i >= 0),
        note: head.findIndex(x => COLUMNS.note.test(x))
      };
      lines.slice(0, h).forEach(l => bad.push(l.trim()));
      lines.splice(0, h + 1);
    } else {
      sep = detectSep(lines);
    }

    const rows = lines.map(line => splitLine(line, sep));
    let multi = { room: 0, name: [1], note: 2 };
    if (!col) {
      // Soba je tisti od prvih dveh stolpcev, v katerem so številke (npr. stolpca »NOVAK JANEZ«, »202« iz Excela).
      const digit = s => /\d/.test(s);
      const vote = rows.reduce((n, c) => n + (c.length < 2 ? 0 : (digit(c[1]) && !digit(c[0])) - (digit(c[0]) && !digit(c[1]))), 0);
      if (vote > 0) multi = { name: [0], room: 1, note: 2 };
    }

    lines.forEach((line, r) => {
      const cells = rows[r];
      const c = col || (cells.length === 1 ? { name: [0], room: -1, note: -1 } : multi);
      const get = i => (cells[i] || '').replace(/\s+/g, ' ');
      const name = c.name.map(get).join(' ').trim();
      if (!name) bad.push(line.trim());
      else persons.push({ name, room: get(c.room), note: get(c.note) });
    });
    return { persons, bad };
  }

  const api = { parsePersons };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KSCsv = api;
})(this);
