# Account Points Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist custom accounts, match summaries, collision events, and permanent account points in Supabase PostgreSQL while preserving low-latency WebSocket gameplay and disabling—without deleting—the existing item system.

**Architecture:** Keep rooms, turns, and board animation in the current Node process. Add a PostgreSQL pool plus small repositories for accounts and matches, and a transaction-based points service for auditable, idempotent rewards. WebSocket collision messages continue immediately; persistence runs asynchronously and later sends `accountPointsUpdated` to reconcile the player's balance.

**Tech Stack:** Node.js 20 CommonJS, Express 4, `ws`, PostgreSQL via `pg`, Supabase PostgreSQL, Vite, browser-native JavaScript, Node's built-in `node:test`.

---

## File map

New backend files:

- `backend/config/features.cjs` — authoritative server-side item feature flag.
- `backend/db/pool.cjs` — PostgreSQL pool creation, transactions, and health check.
- `backend/db/migrate.cjs` — ordered SQL migration runner.
- `backend/migrations/001_account_points.sql` — `app` schema, tables, indexes, and constraints.
- `backend/repositories/userRepository.cjs` — custom-account CRUD and account summaries.
- `backend/repositories/matchRepository.cjs` — match creation, result settlement, and paginated history.
- `backend/services/rewardFormula.cjs` — pure, validated reward calculations.
- `backend/services/pointsService.cjs` — idempotent reward transaction and retry queue.
- `backend/scripts/import-users.cjs` — one-time import of `backend/data/users.json`.
- `backend/test/*.test.cjs` — formula, repository contract, points transaction, and migration tests.
- `frontend/js/config/features.js` — browser-side item feature flag and DOM gating helpers.
- `frontend/js/accountPoints.js` — account-point toast/state reconciliation.

Changed files:

- `backend/package.json`, root `package.json`, `.env.example` — dependencies and operational scripts.
- `backend/server.cjs` — async auth, account APIs, match lifecycle hooks, reward events, and item message gating.
- `frontend/index.html`, `frontend/game.html` — retained item markup hidden behind a feature marker; account stats markup.
- `frontend/js/indexMain.js`, `frontend/js/multiplayerManager.js` — hide and force-disable item configuration.
- `frontend/js/gameMain.js`, `frontend/js/spectateMain.js`, `frontend/js/aiTakeoverManager.js` — short-circuit item subsystem initialization.
- `frontend/js/energyManager.js`, `frontend/js/skillManager.js`, `frontend/js/energyDisplay.js` — preserve implementation but return immediately when items are disabled.
- `frontend/js/utils.js`, `frontend/js/chessPiece.js`, `frontend/js/multiplayerGameManager.js` — send collision facts and display pending/confirmed account points.
- `frontend/js/settlementModal.js`, `frontend/js/titleManager.js` — rename per-match points and exclude item-only titles.
- `frontend/account.html`, `frontend/css/account.css`, `frontend/js/account.js` — account summary, recent matches, and points ledger.
- `README.md` — Supabase/Render Singapore setup and migration workflow.

## Task 1: Add test harness, feature flags, and reward formula

**Files:**

- Create: `backend/config/features.cjs`
- Create: `backend/services/rewardFormula.cjs`
- Create: `backend/test/rewardFormula.test.cjs`
- Create: `frontend/js/config/features.js`
- Modify: `backend/package.json`
- Modify: root `package.json`

- [x] Write the formula tests first.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculatePlaneDefeatReward,
  calculateHappyCollisionReward
} = require('../services/rewardFormula.cjs');

test('four-piece defeat reward keeps two decimals', () => {
  assert.equal(calculatePlaneDefeatReward({ progressBefore: 58.37, progressAfter: 20, pieceCount: 4 }), 47.61);
});

test('two-piece defeat reward applies the 1.35 multiplier', () => {
  assert.equal(calculatePlaneDefeatReward({ progressBefore: 50, progressAfter: 10, pieceCount: 2 }), 66.15);
});

test('happy collision awards 20 points per enemy plane', () => {
  assert.equal(calculateHappyCollisionReward({ enemyPieceCount: 3 }), 60);
});

test('invalid reward facts are rejected', () => {
  assert.throws(() => calculatePlaneDefeatReward({ progressBefore: 20, progressAfter: 30, pieceCount: 4 }));
  assert.throws(() => calculateHappyCollisionReward({ enemyPieceCount: 0 }));
});
```

- [x] Run `npm --workspace backend test` and confirm it fails because the module/script does not exist.
- [x] Implement the pure reward module. It must accept facts, never a client-supplied reward, validate finite values and allowed piece counts, and round with `Math.round((value + Number.EPSILON) * 100) / 100`.

```js
const PIECE_MULTIPLIERS = Object.freeze({ 1: 1, 2: 1.35, 3: 1.15, 4: 1 });

function calculatePlaneDefeatReward({ progressBefore, progressAfter, pieceCount }) {
  const loss = Number(progressBefore) - Number(progressAfter);
  const multiplier = PIECE_MULTIPLIERS[Number(pieceCount)];
  if (!Number.isFinite(loss) || loss <= 0 || multiplier === undefined) {
    throw new RangeError('Invalid plane defeat reward facts');
  }
  return Math.round(((15 + loss * 0.85) * multiplier + Number.EPSILON) * 100) / 100;
}
```

- [x] Add `ITEMS_ENABLED = false` in both feature files with a short comment that restoring items requires enabling both server and browser flags.
- [x] Add backend scripts: `"test": "node --test test/*.test.cjs"` and root scripts `"test:backend"`, `"test"`.
- [x] Run the formula tests and expect all cases to pass.
- [x] Commit: `test: define account reward rules`

## Task 2: Add the PostgreSQL schema and migration runner

**Files:**

- Create: `backend/migrations/001_account_points.sql`
- Create: `backend/db/pool.cjs`
- Create: `backend/db/migrate.cjs`
- Create: `backend/test/migration.test.cjs`
- Modify: `backend/package.json`
- Modify: `.env.example`

- [x] Write a migration structure test that loads the SQL as text and asserts all seven tables, required unique indexes, foreign keys, numeric scales, and constraints are present.
- [x] Run the test and confirm it fails because the migration is absent.
- [x] Add `pg` to backend dependencies and create a lazy pool. Production must require `DATABASE_URL`; tests may inject a pool. Configure `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, and SSL from `DATABASE_SSL`.

```js
const { Pool } = require('pg');

function createPool(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: Number(env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
}
```

- [x] Create `app.schema_migrations`, enable `citext` and `pgcrypto`, then create `app.users`, `app.user_wallets`, `app.user_stats`, `app.matches`, `app.match_players`, `app.match_events`, and `app.points_ledger` exactly as approved in the design spec.
- [x] Add an ordered migration runner that uses a PostgreSQL advisory lock, applies each file once in a transaction, and records its filename and checksum.
- [x] Add `db:migrate` and `db:health` scripts. Document `DATABASE_URL`, `DATABASE_SSL`, and `DATABASE_POOL_MAX` in `.env.example` without real credentials.
- [x] Run `npm --workspace backend test` and confirm schema structure tests pass.
- [x] Commit: `feat: add account persistence schema`

## Task 3: Replace JSON account access with an asynchronous repository

**Files:**

- Create: `backend/repositories/userRepository.cjs`
- Create: `backend/scripts/import-users.cjs`
- Create: `backend/test/userRepository.test.cjs`
- Create: `backend/test/importUsers.test.cjs`
- Modify: `backend/server.cjs:56-225`
- Modify: `backend/server.cjs:4835-4985`
- Modify: `backend/package.json`

- [x] Write repository tests with an injected query adapter for username/email lookup, ID lookup, registration transaction, profile update, password update, and account summary mapping.
- [x] Write importer tests proving UUID, salt, hash, username, email, and timestamps are preserved and a zero wallet/stat row is created with `ON CONFLICT DO NOTHING`.
- [x] Run the tests and confirm they fail before implementation.
- [x] Implement repository methods using snake-case SQL and camel-case application objects. Registration must insert the user, wallet, and stats in one transaction and translate PostgreSQL unique violations to a typed conflict error.

```js
async function createUser(input) {
  return withTransaction(pool, async client => {
    const { rows: [user] } = await client.query(
      `INSERT INTO app.users
       (id, username, email, display_name, password_salt, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.id, input.username, input.email, input.displayName, input.passwordSalt, input.passwordHash]
    );
    await client.query('INSERT INTO app.user_wallets (user_id) VALUES ($1)', [user.id]);
    await client.query('INSERT INTO app.user_stats (user_id) VALUES ($1)', [user.id]);
    return mapUser(user);
  });
}
```

- [x] Convert `getAuthContext`, `getAccountDisplayName`, and `requireAuth` to async-safe code. `requireAuth` loads the user from PostgreSQL after validating the in-memory session token.
- [x] Convert register, login, profile, password, logout, and `/api/auth/me` handlers to async functions. Preserve all current validation, cookies, password hashing, response shapes, and session behavior.
- [x] Remove runtime reads/writes to `userStore` and `persistUserStore`; keep `backend/data/users.json` only as the import source.
- [x] Add `db:import-users` script with dry-run default and an explicit `--apply` requirement.
- [x] Run backend tests and `node --check backend/server.cjs`.
- [x] Commit: `feat: persist custom accounts in postgres`

## Task 4: Add account summary, match history, and points-ledger APIs

**Files:**

- Create: `backend/repositories/matchRepository.cjs`
- Create: `backend/test/accountApi.test.cjs`
- Modify: `backend/repositories/userRepository.cjs`
- Modify: `backend/server.cjs` near the auth routes

- [x] Write API handler tests for authenticated summary and cursor pagination. Cover 401, a valid next cursor, a malformed cursor returning 400, and page-size clamping.
- [x] Implement opaque cursors as base64url-encoded JSON containing `createdAt` and `id`; use `(created_at, id) < ($1, $2)` ordering to make pagination stable.
- [x] Implement:

```text
GET /api/account/summary
GET /api/account/matches?limit=20&cursor=...
GET /api/account/points?limit=20&cursor=...
```

- [x] Return decimal database values as JSON numbers only after validating they are finite; otherwise fail the request rather than exposing corrupt balances.
- [x] Ensure each query is scoped to `req.auth.user.id`; AI records and other users' data must never appear.
- [x] Run backend tests and confirm all account API cases pass.
- [x] Commit: `feat: expose account history APIs`

## Task 5: Persist match creation and settlement

**Files:**

- Modify: `backend/repositories/matchRepository.cjs`
- Create: `backend/test/matchLifecycle.test.cjs`
- Modify: `backend/server.cjs:472-690`
- Modify: `backend/server.cjs:2780-2880`
- Modify: `backend/server.cjs:4520-4630`

- [x] Write lifecycle tests for a match with two logged-in users and one AI: creation writes one match plus three players, AI gets `user_id = null`, settlement writes placement/stats once, and repeated settlement is idempotent.
- [x] Add `matchId`, `eventSequence`, `pendingPersistence`, and `startedAt` to `GameSession`. Use a UUID match ID independent of the transient `gameSessionId`.
- [x] Resolve each real player's account UUID from authenticated WebSocket identity. Snapshot seat, nickname, team number, and AI status at match start.
- [x] Fire `matchRepository.createMatch(...)` after the session is created. Do not await it in the start-game broadcast path; record the promise so reward persistence can await match creation ordering.
- [x] Normalize both `gameEnd` and `forceSettlement` into one idempotent settlement payload. Persist placements, non-item titles, movement/bounce metrics, dice statistics, match winner, duration, and end reason.
- [x] When a room with an active match is destroyed, mark the match `abandoned` without blocking room cleanup.
- [x] Run lifecycle tests and `node --check backend/server.cjs`.
- [x] Commit: `feat: persist match lifecycle`

## Task 6: Implement idempotent account-point transactions and retries

**Files:**

- Create: `backend/services/pointsService.cjs`
- Create: `backend/test/pointsService.test.cjs`
- Modify: `backend/repositories/matchRepository.cjs`

- [x] Write transaction tests with an injectable transaction client. Cover first reward, repeated reward, parallel duplicate attempts, ledger failure rollback, AI/no-account skip, invalid facts, and database retry classification.
- [x] Implement one transaction that locks the wallet row, inserts the event, computes the reward on the server, updates wallet and stats, inserts the ledger, and updates the match player.

```sql
SELECT points_balance
FROM app.user_wallets
WHERE user_id = $1
FOR UPDATE;
```

```js
const idempotencyKey = `match:${matchId}:event:${sequenceNo}:user:${userId}`;
```

- [x] On `(match_id, sequence_no)` or `idempotency_key` conflict, query and return the original ledger amount and balance without updating any aggregate.
- [x] Add an in-memory retry queue keyed by idempotency key. Retry transient database errors at 250 ms, 1 s, and 4 s; expose `flushPendingForMatch(matchId)` for settlement. Keep permanent validation errors out of the retry queue.
- [x] Make the service emit structured success/failure callbacks rather than importing WebSocket code.
- [x] Run all backend tests, including a deliberate failure after wallet update that proves transaction rollback.
- [x] Commit: `feat: add idempotent points ledger`

## Task 7: Connect collision facts to the server without adding gameplay latency

**Files:**

- Create: `frontend/js/accountPoints.js`
- Create: `backend/test/rewardMessage.test.cjs`
- Modify: `backend/server.cjs:1698-1920`
- Modify: `backend/server.cjs:4470-4510`
- Modify: `frontend/js/utils.js:230-360`
- Modify: `frontend/js/chessPiece.js:960-1010`
- Modify: `frontend/js/multiplayerGameManager.js:2670-2805`
- Modify: `frontend/js/gameMain.js`

- [x] Write message-handler tests proving the board/collision broadcast occurs before a delayed points promise completes, AI rewards are skipped, only the actor can claim its seat, and duplicate sequence numbers do not double-pay.
- [x] Add a single client message, `accountRewardEvent`, containing only facts:

```js
{
  eventType: 'plane_defeated',
  targetPlayer: 2,
  targetPieceIndex: 1,
  progressBefore: 61.25,
  progressAfter: 18.75
}
```

For欢乐模式 send `eventType: 'happy_collision'`, target seat/pieces, and enemy piece count. Never send a final reward or account balance.
- [x] In the server handler, bind the sender to its authenticated match player, allocate the next server-side sequence number, validate target seats and mode, calculate a preview reward, and immediately send `accountPointsPending` to the actor.
- [x] Start `pointsService.award(...)` without awaiting it. On success send `accountPointsUpdated` with `amount`, `balance`, `matchId`, `sequenceNo`, and `idempotencyKey`; on retryable failure leave the event visibly pending.
- [x] Add a small frontend state module that deduplicates by idempotency key, shows `账户积分 +X（同步中）`, and changes to confirmed balance on `accountPointsUpdated`.
- [x] Keep existing defeat counts and happy-mode movement rewards unchanged.
- [x] Flush pending rewards before final match persistence; settlement itself must still render immediately.
- [ ] Run backend tests, frontend build, and a manual two-tab collision check with artificial database delay.
- [x] Commit: `feat: award permanent points for collisions`

## Task 8: Disable item mode while retaining implementation code

**Files:**

- Modify: `frontend/index.html:420-455` and other two item-toggle sections
- Modify: `frontend/game.html:470-590`
- Modify: `frontend/js/indexMain.js`
- Modify: `frontend/js/multiplayerManager.js:398-425, 1330-1340, 2120-2140, 4350-4395`
- Modify: `frontend/js/gameMain.js`
- Modify: `frontend/js/spectateMain.js`
- Modify: `frontend/js/aiTakeoverManager.js`
- Modify: `frontend/js/energyManager.js`
- Modify: `frontend/js/energyDisplay.js`
- Modify: `frontend/js/skillManager.js`
- Modify: `backend/server.cjs:720-940, 1698-1875`
- Create: `frontend/test/itemsDisabled.test.mjs`

- [x] Write a source/DOM test that verifies item UI roots use a `data-items-feature` marker, the browser flag is false, room serialization forces `skillMode: false`, and the server rejects or ignores item messages while disabled.
- [x] Add `data-items-feature hidden aria-hidden="true"` to retained item settings, rules, progress bars, and skill panels. Do not remove the child markup.
- [x] At the browser entry points, call a helper that hides every `[data-items-feature]` node and forces stored/configured `skillMode` to false.
- [x] At manager entry points, use explicit guards:

```js
import { ITEMS_ENABLED } from './config/features.js';

if (!ITEMS_ENABLED) {
  // 道具实现保留；同时打开前后端开关后才恢复初始化。
  return;
}
```

- [x] Force all room creation, updates, public listings, session setup, reconnect payloads, and spectator payloads to expose `skillMode: false` while the flag is off.
- [x] Group retained item WebSocket types in the server and return an `itemsDisabled` response before their handlers run. Leave handler functions untouched.
- [x] Remove no item modules or implementation functions. Do not turn whole files into comments.
- [x] Run item-disabled tests, backend tests, and the frontend build.
- [ ] Commit: `feat: disable item mode behind feature flag`

## Task 9: Update account and settlement interfaces

**Files:**

- Modify: `frontend/account.html`
- Modify: `frontend/css/account.css`
- Modify: `frontend/js/account.js`
- Modify: `frontend/js/settlementModal.js:620-675`
- Modify: `frontend/js/titleManager.js`
- Create: `frontend/test/accountView.test.mjs`

- [ ] Write view tests for summary formatting, empty history, pagination append, item-title filtering, and the label `本局账户积分`.
- [ ] Add profile statistic cards for current points, lifetime points, games, wins, and planes defeated. Use `Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })`.
- [ ] Add recent-match and points-ledger sections with load-more buttons. Fetch summary/history only after `/api/auth/me` succeeds; handle either history request failing without hiding the profile.
- [ ] Change the settlement energy chart label to `本局账户积分`. Its data source must be the new per-match account-points state, not the disabled capped `energyManager` balance.
- [ ] Add an item-title predicate in `titleManager.js`; when `ITEMS_ENABLED` is false, item-spending/energy titles remain in source but are excluded from result arrays and carousel display.
- [ ] Preserve responsive behavior and include visible empty/loading/error states.
- [ ] Run view tests and `npm --workspace frontend run build`.
- [ ] Commit: `feat: show persistent account progress`

## Task 10: Operational documentation and full verification

**Files:**

- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-08-17-account-points-persistence-design.md` only if implementation revealed a necessary, approved correction

- [ ] Document Supabase Singapore project creation, connection-string choice (direct IPv6 or Supavisor Session mode for IPv4 hosts), SSL, migrations, JSON import dry-run/apply, and Render Singapore deployment.
- [ ] Document the cutover order: backup JSON, migrate schema, import users, verify login, deploy backend/frontend, then monitor failed reward retries.
- [ ] Document rollback: redeploy old code without dropping new tables; note that new points are not dual-written to JSON.
- [ ] Run `npm install` to update the lockfile after adding `pg`.
- [ ] Run `npm test` and expect every backend/frontend test to pass.
- [ ] Run `npm run build:frontend` and expect Vite to complete without errors.
- [ ] Run `node --check backend/server.cjs` and all new backend modules.
- [ ] Run `git diff --check` and expect no whitespace errors.
- [ ] Start the app locally with a test PostgreSQL database and verify register, login, create room, normal collision, happy collision, reconnect, force settlement, account summary, match history, and points history.
- [ ] Confirm with an artificial 2-second database delay that collision animation/broadcast remains immediate and balance later reconciles.
- [ ] Confirm no item mode controls or item panels are usable, while the original implementation files and handlers remain present.
- [ ] Commit: `docs: add supabase deployment runbook`

## Completion evidence

- [ ] Capture the final test/build command outputs in the task handoff.
- [ ] Record the migration filename and imported-user count.
- [ ] Record one normal collision ledger row and one happy-collision ledger row from the local verification database, with credentials and personal data redacted.
- [ ] Confirm `git status --short` contains only intentional changes.
