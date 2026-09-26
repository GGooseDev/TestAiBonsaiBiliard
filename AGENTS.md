# Project rules — Poole 8-ball WebGL game

## Task tracking (REQUIRED)
1. Keep **`TASKS.md`** (repo root) as the single durable log of all work.
2. Before starting any multi-file task, add a new item to `TASKS.md` AND register
   it in `opencode`'s todowrite list; mark exactly one item `in_progress`.
3. Move items `open -> in_progress -> done` as you go; never "done" on faith —
   an item is `done` only after explicit verification (passing command / user
   confirmed it in the browser). Record the verification in the note.
4. Update `TASKS.md` + todowrite again immediately after each completed chunk,
   so no work is ever lost or silently dropped.
5. If a task needs a human decision/input, mark it `blocked` with the exact
   question — do not guess and do not fabricate a "fix" for a visual symptom
   you cannot observe.
6. Headless-only environment: no browser/Puppeteer. Never claim a visual bug is
   "fixed"; state it is fixed-in-code and *needs user in-browser confirmation*.

## Conventions
- English only in all code strings, comments, and generated text/docs.
- Constants over magic numbers; short methods; reuse existing libs.
- Reversed-aim ("monolith") convention: shot flies AWAY from the pointer; the cue
  tip points at the finger and the stick pulls back. Keep `ui.js` and
  `webgl3d.js` sign conventions in sync if this ever changes.
- Prefer headless Node verification (`node --check`, smoke-e2e, bot-playtest)
  for anything that can be tested without a browser.
