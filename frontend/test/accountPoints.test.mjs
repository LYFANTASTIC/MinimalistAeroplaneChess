import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccountPointsTracker } from '../js/accountPoints.js';

test('pending rewards add per-match points once and show syncing text', () => {
  const messages = [];
  const tracker = createAccountPointsTracker({ notify: message => messages.push(message) });
  const pending = { idempotencyKey: 'event-1', player: 1, amount: 47.61 };

  tracker.handlePending(pending);
  tracker.handlePending(pending);

  assert.equal(tracker.getMatchPoints(1), 47.61);
  assert.equal(messages[0], '账户积分 +47.61（同步中）');
});

test('confirmed rewards reconcile the account balance without adding match points again', () => {
  const tracker = createAccountPointsTracker({ notify() {} });
  tracker.handlePending({ idempotencyKey: 'event-1', player: 1, amount: 47.61 });

  tracker.handleUpdated({ idempotencyKey: 'event-1', player: 1, amount: 47.61, balance: 147.61 });

  assert.equal(tracker.getMatchPoints(1), 47.61);
  assert.equal(tracker.getBalance(), 147.61);
  assert.equal(tracker.getEvent('event-1').status, 'confirmed');
});

test('failed synchronization keeps the earned amount visible as failed', () => {
  const tracker = createAccountPointsTracker({ notify() {} });
  tracker.handlePending({ idempotencyKey: 'event-1', player: 1, amount: 20 });
  tracker.handleFailed({ idempotencyKey: 'event-1' });
  assert.equal(tracker.getEvent('event-1').status, 'failed');
  assert.equal(tracker.getMatchPoints(1), 20);
});
