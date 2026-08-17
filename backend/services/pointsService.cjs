'use strict';

const { getPool, withTransaction } = require('../db/pool.cjs');
const { toFiniteNumber } = require('../repositories/userRepository.cjs');
const {
  calculateHappyCollisionReward,
  calculatePlaneDefeatReward
} = require('./rewardFormula.cjs');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRYABLE_CODES = new Set([
  '40001', '40P01', '55P03', '57P01', '57P02', '57P03',
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED',
  'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'
]);

function calculateReward(input) {
  if (input.eventType === 'plane_defeated') return calculatePlaneDefeatReward(input);
  if (input.eventType === 'happy_collision') return calculateHappyCollisionReward(input);
  throw new RangeError('Invalid reward event type');
}

function validateRewardInput(input) {
  if (!UUID_PATTERN.test(String(input.matchId || ''))) throw new RangeError('Invalid match id');
  if (!UUID_PATTERN.test(String(input.userId || ''))) throw new RangeError('Invalid user id');
  if (!Number.isInteger(input.sequenceNo) || input.sequenceNo < 1) throw new RangeError('Invalid event sequence');
  if (input.targetPieceIndex != null && (!Number.isInteger(input.targetPieceIndex) || input.targetPieceIndex < 0 || input.targetPieceIndex > 3)) {
    throw new RangeError('Invalid target piece index');
  }
}

function makeIdempotencyKey(input) {
  validateRewardInput(input);
  return `match:${input.matchId}:event:${input.sequenceNo}:user:${input.userId}`;
}

function isRetryableDatabaseError(error) {
  const code = String(error?.code || '');
  return RETRYABLE_CODES.has(code) || code.startsWith('08');
}

async function findExistingLedger(client, idempotencyKey) {
  const { rows: [row] } = await client.query(
    `SELECT amount, balance_after
     FROM app.points_ledger WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  if (!row) return null;
  return {
    amount: toFiniteNumber(row.amount, 'amount'),
    balance: toFiniteNumber(row.balance_after, 'balance_after'),
    duplicate: true,
    idempotencyKey
  };
}

function createRewardRetryQueue({
  award,
  retryDelays = [250, 1000, 4000],
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay))
}) {
  const pending = new Map();
  const deferredFailures = new Map();

  function enqueue(input, callbacks = {}) {
    const key = makeIdempotencyKey(input);
    const existing = pending.get(key);
    if (existing) return existing.promise;

    const promise = (async () => {
      let lastError;
      for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        if (attempt > 0) await sleep(retryDelays[attempt - 1]);
        try {
          const result = await award(input);
          try { callbacks.onSuccess?.(result); } catch (callbackError) {
            console.error('[账户积分] 成功回调失败:', callbackError);
          }
          return result;
        } catch (error) {
          lastError = error;
          if (!isRetryableDatabaseError(error) || attempt === retryDelays.length) break;
        }
      }
      if (isRetryableDatabaseError(lastError)) {
        deferredFailures.set(key, { matchId: input.matchId, input, callbacks });
      }
      try { callbacks.onFailure?.(lastError); } catch (callbackError) {
        console.error('[账户积分] 失败回调失败:', callbackError);
      }
      throw lastError;
    })().finally(() => pending.delete(key));

    pending.set(key, { matchId: input.matchId, promise });
    promise.catch(() => {});
    return promise;
  }

  async function flushPendingForMatch(matchId, { retryUntilAvailable = false } = {}) {
    let retryIndex = 0;
    while (true) {
      const promises = Array.from(pending.values())
        .filter(entry => entry.matchId === matchId)
        .map(entry => entry.promise);
      await Promise.allSettled(promises);

      const retries = Array.from(deferredFailures.entries())
        .filter(([, entry]) => entry.matchId === matchId);
      if (retries.length === 0) return;

      let transientFailure = null;
      let permanentFailure = null;
      for (const [key, entry] of retries) {
        try {
          const result = await award(entry.input);
          deferredFailures.delete(key);
          try { entry.callbacks.onSuccess?.(result); } catch (callbackError) {
            console.error('[账户积分] 结算重试成功回调失败:', callbackError);
          }
        } catch (error) {
          if (isRetryableDatabaseError(error)) transientFailure ||= error;
          else {
            deferredFailures.delete(key);
            permanentFailure ||= error;
          }
          try { entry.callbacks.onFailure?.(error); } catch (callbackError) {
            console.error('[账户积分] 结算重试失败回调失败:', callbackError);
          }
        }
      }
      if (permanentFailure) throw permanentFailure;
      if (!transientFailure || !retryUntilAvailable) return;
      const delayIndex = Math.min(retryIndex, Math.max(0, retryDelays.length - 1));
      await sleep(retryDelays[delayIndex] ?? 0);
      retryIndex += 1;
    }
  }

  return {
    enqueue,
    flushPendingForMatch,
    pendingCount: () => pending.size + deferredFailures.size
  };
}

function createPointsService({
  poolProvider = getPool,
  transactionRunner = withTransaction,
  retryDelays,
  sleep
} = {}) {
  async function award(input) {
    if (!input.userId) return { skipped: true, reason: 'no_account' };
    validateRewardInput(input);
    const amount = calculateReward(input);
    const amountValue = amount.toFixed(2);
    const idempotencyKey = makeIdempotencyKey(input);

    return transactionRunner(poolProvider(), async client => {
      const existing = await findExistingLedger(client, idempotencyKey);
      if (existing) return existing;

      const { rows: [matchPlayer] } = await client.query(
        `SELECT id FROM app.match_players
         WHERE match_id = $1 AND user_id = $2 AND is_ai = false`,
        [input.matchId, input.userId]
      );
      if (!matchPlayer) return { skipped: true, reason: 'match_player_not_found' };

      const payload = {
        pieceCount: input.pieceCount,
        progressBefore: input.progressBefore,
        progressAfter: input.progressAfter,
        enemyPieceCount: input.enemyPieceCount,
        ...input.metadata
      };
      const { rows: [event] } = await client.query(
        `INSERT INTO app.match_events
         (match_id, sequence_no, event_type, actor_user_id, target_user_id,
          target_piece_index, reward_points, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (match_id, sequence_no) DO NOTHING
         RETURNING id`,
        [
          input.matchId,
          input.sequenceNo,
          input.eventType,
          input.userId,
          input.targetUserId || null,
          input.targetPieceIndex ?? null,
          amountValue,
          JSON.stringify(payload)
        ]
      );
      if (!event) {
        const duplicate = await findExistingLedger(client, idempotencyKey);
        if (duplicate) return duplicate;
        throw Object.assign(new Error('Reward event exists without a ledger entry'), { code: '40001' });
      }

      const { rows: [wallet] } = await client.query(
        `SELECT points_balance FROM app.user_wallets
         WHERE user_id = $1 FOR UPDATE`,
        [input.userId]
      );
      if (!wallet) throw new Error('Account wallet not found');

      const { rows: [updatedWallet] } = await client.query(
        `UPDATE app.user_wallets
         SET points_balance = points_balance + $2,
             version = version + 1,
             updated_at = now()
         WHERE user_id = $1
         RETURNING points_balance, version`,
        [input.userId, amountValue]
      );
      const balance = toFiniteNumber(updatedWallet.points_balance, 'points_balance');

      await client.query(
        `INSERT INTO app.points_ledger
         (user_id, amount, reason, match_id, match_event_id, balance_after,
          idempotency_key, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id`,
        [
          input.userId,
          amountValue,
          input.eventType,
          input.matchId,
          event.id,
          balance.toFixed(2),
          idempotencyKey,
          JSON.stringify(input.metadata || {})
        ]
      );

      const planeDelta = input.eventType === 'plane_defeated' ? 1 : 0;
      const happyDelta = input.eventType === 'happy_collision' ? 1 : 0;
      await client.query(
        `UPDATE app.match_players
         SET account_points_earned = account_points_earned + $2,
             planes_defeated = planes_defeated + $3,
             happy_collisions = happy_collisions + $4
         WHERE match_id = $1 AND user_id = $5`,
        [input.matchId, amountValue, planeDelta, happyDelta, input.userId]
      );
      await client.query(
        `UPDATE app.user_stats
         SET lifetime_points_earned = lifetime_points_earned + $2,
             planes_defeated = planes_defeated + $3,
             happy_collisions = happy_collisions + $4,
             updated_at = now()
         WHERE user_id = $1`,
        [input.userId, amountValue, planeDelta, happyDelta]
      );

      return { amount, balance, duplicate: false, idempotencyKey };
    });
  }

  const queue = createRewardRetryQueue({ award, retryDelays, sleep });
  return {
    award,
    enqueue: queue.enqueue,
    flushPendingForMatch: queue.flushPendingForMatch,
    pendingCount: queue.pendingCount,
    previewReward(input) {
      if (!input.userId) return { skipped: true, reason: 'no_account' };
      return { amount: calculateReward(input), idempotencyKey: makeIdempotencyKey(input) };
    }
  };
}

module.exports = {
  calculateReward,
  createPointsService,
  createRewardRetryQueue,
  isRetryableDatabaseError,
  makeIdempotencyKey,
  validateRewardInput
};
