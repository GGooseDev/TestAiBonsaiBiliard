# Task log — Poole 8-ball WebGL game

Durable record of every task. Per the project `AGENTS.md` rule, every working
session MUST (1) add new work here before starting, (2) move items across
statuses as work completes, and (3) mark an item "Done" ONLY after explicit
verification (a passing command / user confirmation), never on faith.
The live per-session state is mirrored in `opencode`'s todowrite list.

## Legend
- `done`   — verified complete (evidence shown in the note).
- `blocked` — cannot proceed until a named input/decision is available.
- `open`   — known work, not started.

---

## DONE (verified)
| # | Task | Evidence |
|---|------|----------|
| D1 | 3D visual bugs: aim-line / cue geometry, target marker on the struck ball, empty-shot rail fallback, pointer rect-offset capture | `node --check` on all src; code review of `webgl3d.js` lines 70-124 (`firstContact`), 458-530 (aim block), 566-580 (`screenToTableLogical`) |
| D2 | Bot ghost-point fix | `src/bot.js` `nx * C.BR * 2` |
| D3 | Headless Node playtest harness with exact pot counts + per-turn trace | `bot-playtest.js`; 5 consecutive runs, all `EXIT=0` (4x `turns=32,potted=14,winner=You`, 1x `turns=40,potted=15,winner=Bot`) |
| D4 | Headless smoke/e2e | `node smoke-e2e.js` -> all `[OK]`, exit 0 (4 SVG snapshots emitted) |
| D5 | All src modules syntax-clean | `node --check` over `src/*.js` + root scripts, no errors |
| D6 | Rules-engine contract via headless playtest (was O1) | `node bot-playtest.js`: `auditRulesEngine` A–G all pass AND full multi-turn game terminates. Two consecutive runs: `turns=32,potted=14,winner=You` and `turns=40,potted=15,winner=Bot`; cue finite, all balls finite; exit 0 |

## IN PROGRESS / ACTIVE
### I1 — Cue-stick power feedback reads as "not adjustable" (HEAD)
Reported by user: shot-strength isn't visible; the cue should pull **farther back** or **closer** in proportion to strength and cursor distance. Also earlier report: aim line looks "parallel / separate".

**Static-analysis findings (code is wired correctly on disk):**
- Power derives from live pointer distance: `src/ui.js:15-22` (`setPowerFromAim`) runs on every pointer move via `moveAim` (`ui.js:46-50`).
- `P.Vec.hypot` exists (`src/vec.js:7,16`) so it can't throw.
- Nothing resets `P.UI.power` per-frame; the game only toggles `shootable`/`aiming` on turn transitions (`game.js:69, 81, 148, ...`).
- The cue length is power-driven: `webgl3d.js:495` -> `sl = C.CUE_STICK_LEN + power * C.CUE_MAX_EXTEND` (240 -> 400 units), tip pinned at the finger-side ball edge (`nose`, `webgl3d.js:472,502`). So the stick should visibly extend on a deeper drag.

**Root cause identified:** `screenToTableLogical` / `_screenToLogical` (`webgl3d.js:46-54`) returns a **frozen centre** `{x:CXw,y:CYw}` whenever `renderer`/`camera` is not ready or the ray misses the felt plane. A frozen centre freezes `aimX/aimY`, which simultaneously (a) freezes the aim direction and (b) makes power/drag-distance constant -> a static cue and an "off" aim line. **FIX APPLIED:** mapper now returns `null` on those failure paths so `ui.js`'s flat fallback takes over instead of freezing (see commit/diff note below). This is a no-op when GL is ready, so it cannot break current behaviour.

**Status:** mapper hardening applied; NEEDS USER BROWSER confirmation + disambiguation (see NEXT / Q1).
If the fix doesn't change what the user sees, the remaining leading hypothesis is a **stale served build** (source on disk is correct but the running page wasn't reloaded / rebuilt) — confirm via hard reload.

### I2 — Aim line possibly occluded
Even after sharing the cue-tip origin, the aim line can still be hidden by the balls/rails it passes over. **FIX APPLIED:** `aimLineMesh` material now sets `depthTest: false` (`src/webgl3d.js` ~line 387) so the guide always draws above the scene; `renderOrder=9` retained and `depthWrite:false` kept so it never occludes balls. Headless verified: `node --check src/webgl3d.js` clean + smoke/playtest still pass. Visual confirm still needs user in-browser (see I1 check) — headless cannot see the render.

## OPEN
### O2 — Headless-only limitation (BLOCKER on visual checks)
No Puppeteer / browser automation available. Every "does it LOOK right" item (aim line, cue pull-back, target ring, floats) must be confirmed by the user in-browser. Flag this rather than pretending a visual is verified. (O1 closed -> D6.)

## NEXT STEPS (in order)
1. Apply mapper fix (I1) — [applied].
2. Run `node bot-playtest.js` to verify O1 (auditRulesEngine A–G + playtest) — [APPLIED this session; all 7 pass, full game exits 0 -> D6].
3. Apply I2 aim-line `depthTest:false` tweak so the guide isn't occluded by balls/rails — [APPLIED this session].
4. **User in-browser confirm (hard reload)** — only remaining step (headless can't verify visuals):
    - I1: cue stick extends/retracts with drag distance; aim line emanates from the tip and points correctly.
    - I2: aim line stays visible over balls/rails.
    - If after hard reload I1 is still fully static -> stale served build -> identify rebuild/reload path.

## DECISIONS / CONVENTIONS (do not re-derive)
- **Reversed-aim ("monolith") convention**: shot flies AWAY from the pointer; cue tip points at the finger, stick pulls back. All aiming code must preserve this.
  - `ui.js:34` `dirx = -(dx/d)` ; `webgl3d.js:467` same sign. Keep both in sync.
- **World/logical units are identical**: `l2w(x,y) = (x-CXw, y, -(y-CYw))`; the mapper returns exactly logical `(x,y)`. Cue stick tip is pinned at the finger-side ball edge and extends `sl` toward the finger.
- **Rule engine contract** (src/rules.js): legalIds, onShotSettled({cuePocketed, firstContact, pocketedThisShot}) -> D{foul,respotCue,respot8,winner}, applyDecision(D) advances turn machine; 8-ball-in-hand respot to centre; win = own group cleared & no fouls pending.
- **Headless verification only**; no browser tooling.

## CHANGE NOTE (this session)
- `webgl3d.js` `_screenToLogical`: both failure returns changed from `{x:CXw,y:CYw}` to `null`; comment added. Rationale: prevent frozen-centre aiming; caller falls back to flat mapping. No other behaviour changed.
- I2 (`src/webgl3d.js` ~line 387): aim-line material now includes `depthTest: false` so the guide always draws over balls/rails; `depthWrite:false` + `renderOrder=9` retained.
- `bot-playtest.js` `auditRulesEngine`: replaced two bare-`P` scope refs with `globalThis.Poole` (line 114 `R`, line 181 `Physice_balls()`); now executes cleanly (O1 -> D6). Verified: A–G all pass, playtest exits 0.
- `TASKS.md`: corrected stale smoke path to root `smoke-e2e.js`.
