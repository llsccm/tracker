# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

用户可见文案、注释与交流默认使用简体中文（zh-CN）。这是项目的既定偏好（见 `AGENTS.md`），生成新代码或文档时沿用。

## What this is

A browser **userscript** (`daxiaochao`) for the online card game 三国杀 (Sanguosha), built with Vite + `vite-plugin-monkey` (Tampermonkey/Greasemonkey output). It reads the host game's console-log message stream, reconstructs hidden game state, and renders a "card tracker" (记牌器) overlay. It does **not** have a backend, a normal DOM app entry, or automation — those capabilities were deliberately removed.

The script attaches by hijacking `window.console.log` in `src/index.js`, pushing itself into the host's `window.SGSMODULE` dispatch array, and routing each host message through `src/logic.js` → `src/handler/*`.

## Commands

Package manager is **pnpm only** (never npm/yarn/bun). There is no generic `pnpm test`.

```sh
pnpm dev               # Vite dev server
pnpm build             # dev-mode userscript build
pnpm build:prod        # production userscript build (run for release/packaging/high-risk tracker changes)
pnpm lint              # ESLint (flat config)
pnpm format            # Prettier --write over src
pnpm typecheck         # full-repo tsc --noEmit
pnpm typecheck:tracker # tsc -p tsconfig.tracker.json (src/tracker + tests/tracker only)
pnpm test:tracker      # vitest run tests/tracker
```

Run a **single** tracker test file or filter by name (bypass the wrapper script and call vitest directly):

```sh
pnpm exec vitest run tests/tracker/locationCandidates.test.ts
pnpm exec vitest run tests/tracker -t "hidden mark"
```

### Which checks to run (gated by what you changed)

- Docs only → nothing.
- Normal code → `pnpm lint` + `pnpm build`.
- Anything under `src/tracker/` or `tests/tracker/` → also `pnpm test:tracker`.
- TS type contracts, `tsconfig*`, ESLint TS coverage, or tracker type migration → `pnpm typecheck:tracker` (and `pnpm typecheck` when a full-repo entry needs confirming).
- Release/packaging config, userscript metadata, or high-risk tracker core paths → also `pnpm build:prod`.

## Architecture: message → state → view

```
host console.log
  → src/index.js (SGSMODULE dispatch)
  → src/logic.js (featureFlags whitelist, then route by ClassName)
  → src/handler/* (per-protocol handlers)
  → src/tracker/runtime/bridge.ts → runtime/trackerController.ts (syncTrackerMove / reveal / render scheduling)
  → src/tracker/Room.moveCards() → Room.resolveConstraints()
  → src/tracker/view/* (scheduleRender → next-frame flush)
```

- **`src/logic.js`** whitelists retained messages via `src/featureFlags.js`, then dispatches by `ClassName`.
- **`src/handler/PubGsCMoveCard.js`** is the hot path: protocol preprocessing, position normalization, `CardIDs` correction, and skill side-effects, then hands the real state move to the tracker through `src/tracker/runtime/bridge.ts` (a thin facade that delegates to `runtime/trackerController.ts`).
- **`src/handler/legacyMoveCard.js` and `src/handler/old/` are dead** — legacy linked-list tracker code, NOT exported from `src/handler/index.js`. Do not build new runtime paths on them.

## The card tracker (`src/tracker/`) — the core

`src/tracker/` is the single active tracker state source (it replaced the former `src/refactor/` and `src/context/`). Read [`docs/agents/card_tracker.md`](docs/agents/card_tracker.md) before non-trivial tracker work; it documents module boundaries, the hidden-mark candidate ledger, and a risk/verification checklist.

Key model concepts (these span multiple files and are the "why" behind the design):

- **`Room`** is the per-game state container: `cards`, `players`, public `zones`, `counter`, `constraintGroups`, the indexes, suspended-tracking set, and view dirty records. It mounts three **behavior modules** — `RoomMovement` (`roomMovement.ts` + `roomMovement/`), `RoomConstraints` (`roomConstraints.ts`), `RoomPublicZones` (`roomPublicZones.ts`) — which hold only a `room` reference and own no independent inference state. Hot entrypoints (`moveCards`, `resolveConstraints`, `shufflePile`, `getPublicZone`) stay on `Room`; new low-frequency helpers go into the behavior module with a thin `Room` entry.
- **`Card.locationCandidates` is the single writable candidate model.** `seats`, `subZoneCandidates`, and `publicCandidates` are **read-only projections** — never write them directly; go through `setLocationCandidates()` / `setSeats()` / `resolveLocationCandidate()`. `seats.size === 1` means *owner* is known, NOT that the sub-zone is resolved.
- **`ConstraintGroup`** expresses a *local* candidate-pack constraint from one move/deal/reveal event. It is deliberately NOT global elimination — "same group" ≠ "same owner". Candidate elimination when a hidden-card quota hits zero is scoped inside the relevant group only. Avoid introducing unbounded global convergence.
- **Indexes**: `CardLocationIndex` (zone→cards projections for the view; **incrementally maintained** via `dirtyCardEvents` cursors and `dirtyPublicZones` checks), `AmbiguousKnownIndex` (reverse lookup for ambiguous known-card tooltips; **incrementally maintained** via `dirtyCardEvents` cursors and `constraintGroupsDirty` checks), `CardCounter` (query counts; **incremental** via `markDirty`/clean-cache getters).
- **Protocol quirk**: `FromID`/`ToID` do not map directly to seats. Always combine with `FromZone`/`ToZone`, `*ZoneParam`, `SpellID`, and the normalized `fromSubZone`/`spellID` (see `MoveEventNormalizer.ts` / `protocolZones.ts`).

### Convergence regression guards

- `resolveConstraints()` has been traversal-optimized (A2 incremental player-snapshot, E2 skip-untouched-seats). Under `import.meta.env.DEV`, `assertPlayerSnapshotConsistency()` cross-checks the snapshot. Any new in-loop path that changes seats/candidates must emit an event carrying `previousSeats` through one of the three capture points, and any path changing `card.location` must set the loop's `changed` flag — otherwise the optimized skip/snapshot logic silently misses seats.
- `tests/tracker/traversalBaseline.test.ts` inline snapshots are a **traversal-count** guard. Numbers going *down* from a structural optimization is expected — refresh with `pnpm exec vitest run tests/tracker/traversalBaseline.test.ts -u`. Numbers going *up* from unrelated changes need a justification before you update the snapshot.

## Lifecycle (when Room/view actually exist)

The tracker is created per-game, not at script INIT. Two-phase view mount. See [`docs/agents/lifecycle.md`](docs/agents/lifecycle.md). Roughly: `GsCModifyUserseatNtf` creates the `Room` + registers players + early `view.mount` (clears panel, inits hand containers); `MsgGamePlayCardNtf` → `initDeck` builds the physical card pool + `CardCounter`, then a second `view.mount` does the full render; `MsgGameOver`/`ClientLeavetableRep` unmounts the view then destroys the `Room`.

## Conventions worth knowing

- **LF line endings everywhere** (enforced by convention; do not reintroduce CRLF). 2-space indent. Match neighboring style — no unrelated reformatting.
- Prettier: single quotes, no semicolons, no trailing commas, width 100.
- ESM throughout (`"type": "module"`). Vite alias `@` → `src/`.
- The host page provides globals (`Laya`, `JSZip`, `CtrUtil`, `SystemContext`, …) declared in `eslint.config.js`.
- `src/tracker/index.ts` only re-exports shared runtime state (`globalConfig`, `globalState`, `rogueMap`, `UI`, `user`, `Game`). Import `Room`/`Card`/`Player`/`Zone`/`ConstraintGroup` directly from their own submodules.
- **Do not commit `dist/` or `.env`.** `pnpm-lock.yaml` is tracked but should only change for dependency/version tasks — no incidental edits. `.env` is untracked/ignored. `html/iframe.html` is loaded from a remote URL at runtime; changing it means confirming the remote deploy.

## Further reading (progressive disclosure)

`AGENTS.md` is the always-on rule router; detailed docs live in `docs/agents/`: `overview.md` (module map + retained/removed scope), `card_tracker.md` (tracker internals + risks), `lifecycle.md`, `conventions.md`, `environment.md`, `commands.md`. `CONTRIBUTING.md` covers PR expectations. `plans/` holds active optimization proposals for the tracker.
