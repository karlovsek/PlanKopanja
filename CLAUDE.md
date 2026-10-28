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

Scripts load in this order in `index.html`: `holidays.js` → `scheduler.js` → `storage.js` → `rules.js` → `csv.js` →
`app.js`. Each file is an IIFE. `holidays.js`, `scheduler.js`, `rules.js` and `csv.js` are DOM-free and are what the
tests cover; keep them that way. In the browser they expose `KSHolidays`, `KSScheduler`, `KSRules`, `KSCsv` on
`window`; under Node they export the same
API via `module.exports` instead, so the tests can `require` them. `storage.js` (`KSStorage`: `localStorage`, JSON
export/import via `document`, `Blob`, `FileReader`) uses browser APIs only inside its functions, never at load, so it
follows the same export pattern; under Node only `normalize()` is usable and tested. `app.js` (UI: tabs, dialogs,
calendar, print; no global) is browser-only.

**State** (one object, persisted as JSON in `localStorage` under key `kopalniSeznam.v1`):
`{ version: 1, corridors: [], persons: [], schedules: {}, ui: {} }`.
- `schedules` is keyed by `corridorId + '|' + 'YYYY-MM'` (`KSScheduler.scheduleKey`); each value is
  `{ days: { 'YYYY-MM-DD': [personId, ...] }, edited }`.
- `persons[].blockedDates` (sorted ISO dates) are days the person cannot bathe; `personAllows()` treats them as
  disallowed, so the algorithm and analysis honour them. Edited in the calendar (− button on a day, × on a
  blocked tile) and as from–to periods in the person form.
- `ui` holds the selected tab / corridor / month so the app reopens where the user left it.
- `storage.js` `normalize()` migrates older corridor formats (`capacityPerDay`, `excludedWeekdays`, …) to
  `capacity: { weekday, saturday, sundayHoliday }` + `dayOverrides: { date: n }`, and sanitizes hand-made JSON
  (schedule `days`/`locked` become `{ ISO date: [string ids] }`, `allowedWeekdays` integers 0–6). Keep it backward
  compatible; JSON import goes through the same normalization.
- **Do not rename the storage key** — existing users' data would appear lost. (The app was renamed from
  »Kopalni seznam«; the key intentionally kept the old name.)

**Scheduling** (`scheduler.js`): dates are ISO `YYYY-MM-DD` strings computed in UTC. Day capacity = date override,
else default by day kind (weekday / Saturday / Sunday-or-Slovenian-holiday); capacity 0 = no bathing.
`buildSchedule()` derives each person's last bath from *previous months' schedules* (so months should be built in
order), then fills days greedily by overdue-ness with a lookahead (`LOOKAHEAD_DAYS`). `analyzeSchedule()` produces
warnings from the actual (possibly hand-edited) schedule, so manual edits in the calendar are always re-validated.
The full rules are in `js/rules.js` (see below).

**Rules tab** (`rules.js`, tab »Pravila razporejanja«): the scheduling rules as user-facing Slovenian text, grouped by
section, each with a validity period `{ id, from, to, text }` (`from` is required; no `to` = still valid).
- **Whenever behaviour described there changes, update `rules.js` in the same commit** — not only `scheduler.js`, but
  also holidays (`holidays.js`), defaults (`DEFAULT_CAPACITY`, `DEFAULT_INTERVAL`, which also pre-fill the forms),
  manual editing / rebuild behaviour and the ✎ day editor (`app.js`). Set `to` on the old entry (last day it
  applied) and add a new entry with the same `id` and `from` = the next day; a new rule gets `from` = today.
- Never delete or rewrite entries to change what a rule *was* — they are the history users see. Exception: a text
  that never matched the code may be corrected in place (it is a documentation fix, not a rule change).
- Rule history starts at `START` (2026-10-07); earlier entries were dropped once, before the app was first used in
  production. From then on, entries are never deleted.
- Tests check current texts against the code (`DEFAULT_CAPACITY`, `DEFAULT_INTERVAL`, `LOOKAHEAD_DAYS`,
  `historyLimit`, `pullForwardDays`, `shortGap`, holiday names) and that versions of one `id` follow each other
  without gaps. Keep numbers in rule texts tied to these named helpers rather than inline literals in `scheduler.js`.

## Conventions

- Line endings: `.gitattributes` (`* text=auto eol=crlf`) stores every text file as **LF in the repo** and checks it
  out as **CRLF in the working tree**, regardless of `core.autocrlf`. Git converts on commit, so the endings of edited
  or new files do not matter.
- User-facing text, comments, test names and commit messages are in Slovenian.
- Name comparisons use `localeCompare(..., 'sl')`; person search/filter is case- and diacritic-insensitive.
