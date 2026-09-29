# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

»Plan kopanja« is a zero-dependency, offline web app (Slovenian UI) for managing people per corridor (hodnik) and
generating a monthly bathing schedule. There is no build step, no package.json and no linter. Users open `index.html`
directly (`file://`), so **no ES modules, no fetch of local files, no CDN** — plain `<script>` tags only.

## Commands

- Run tests: `node tests/scheduler.test.js` (custom mini-harness; prints `ok`/`FAIL` per test and `N/N testov uspešnih.`,
  sets exit code 1 on failure). There is no single-test filter — the whole suite runs in well under a second.
- Tests in browser: open `tests/scheduler.test.html`.
- Manual check in Chrome: serve the folder (e.g. `python -m http.server 8765 --bind 127.0.0.1`) and open `index.html`.
  Note `localStorage` is per origin, so data saved under `file://` is not visible on `127.0.0.1` and vice versa.

## Architecture

Scripts load in this order in `index.html`: `holidays.js` → `scheduler.js` → `storage.js` → `csv.js` → `app.js`.
Each file is an IIFE. `holidays.js`, `scheduler.js` and `csv.js` are DOM-free and are what the tests cover; keep them
that way. In the browser they expose `KSHolidays`, `KSScheduler`, `KSCsv` on `window`; under Node they export the same
API via `module.exports` instead, so the tests can `require` them. `storage.js` (`KSStorage`: `localStorage`, JSON
export/import via `document`, `Blob`, `FileReader`) and `app.js` (UI: tabs, dialogs, calendar, print; no global) are
browser-only.

**State** (one object, persisted as JSON in `localStorage` under key `kopalniSeznam.v1`):
`{ version: 1, corridors: [], persons: [], schedules: {}, ui: {} }`.
- `schedules` is keyed by `corridorId + '|' + 'YYYY-MM'` (`KSScheduler.scheduleKey`); each value is
  `{ days: { 'YYYY-MM-DD': [personId, ...] }, edited }`.
- `ui` holds the selected tab / corridor / month so the app reopens where the user left it.
- `storage.js` `normalize()` migrates older corridor formats (`capacityPerDay`, `excludedWeekdays`, …) to
  `capacity: { weekday, saturday, sundayHoliday }` + `dayOverrides: { date: n }`. Keep it backward compatible; JSON
  import goes through the same normalization.
- **Do not rename the storage key** — existing users' data would appear lost. (The app was renamed from
  »Kopalni seznam«; the key intentionally kept the old name.)

**Scheduling** (`scheduler.js`): dates are ISO `YYYY-MM-DD` strings computed in UTC. Day capacity = date override,
else default by day kind (weekday / Saturday / Sunday-or-Slovenian-holiday); capacity 0 = no bathing.
`buildSchedule()` derives each person's last bath from *previous months' schedules* (so months should be built in
order), then fills days greedily by overdue-ness with a lookahead (`LOOKAHEAD_DAYS`). `analyzeSchedule()` produces
warnings from the actual (possibly hand-edited) schedule, so manual edits in the calendar are always re-validated.
See README »Kako deluje razporejanje« for the full rules.

## Conventions

- Line endings are mixed and there is no `.gitattributes`: `README.md`, `index.html`, `css/style.css` and `js/app.js`
  use **CRLF**, all other files LF. Keep each file's existing endings — edit with the Edit tool rather than `sed -i`,
  which converts CRLF to LF.
- User-facing text, comments, test names and commit messages are in Slovenian.
- Name comparisons use `localeCompare(..., 'sl')`; person search/filter is case- and diacritic-insensitive.
