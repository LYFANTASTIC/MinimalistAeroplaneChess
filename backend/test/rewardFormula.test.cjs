const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculatePlaneDefeatReward,
  calculateHappyCollisionReward
} = require('../services/rewardFormula.cjs');

test('four-piece defeat reward keeps two decimals', () => {
  assert.equal(
    calculatePlaneDefeatReward({ progressBefore: 58.37, progressAfter: 20, pieceCount: 4 }),
    47.61
  );
});

test('two-piece defeat reward applies the 1.35 multiplier', () => {
  assert.equal(
    calculatePlaneDefeatReward({ progressBefore: 50, progressAfter: 10, pieceCount: 2 }),
    66.15
  );
});

test('three-piece defeat reward applies the 1.15 multiplier', () => {
  assert.equal(
    calculatePlaneDefeatReward({ progressBefore: 50, progressAfter: 10, pieceCount: 3 }),
    56.35
  );
});

test('one-piece mode uses the baseline multiplier', () => {
  assert.equal(
    calculatePlaneDefeatReward({ progressBefore: 50, progressAfter: 10, pieceCount: 1 }),
    49
  );
});

test('happy collision awards 20 points per enemy plane', () => {
  assert.equal(calculateHappyCollisionReward({ enemyPieceCount: 3 }), 60);
});

test('invalid plane-defeat facts are rejected', () => {
  assert.throws(
    () => calculatePlaneDefeatReward({ progressBefore: 20, progressAfter: 30, pieceCount: 4 }),
    /Invalid plane defeat reward facts/
  );
  assert.throws(
    () => calculatePlaneDefeatReward({ progressBefore: 50, progressAfter: 10, pieceCount: 5 }),
    /Invalid plane defeat reward facts/
  );
});

test('invalid happy-collision facts are rejected', () => {
  assert.throws(
    () => calculateHappyCollisionReward({ enemyPieceCount: 0 }),
    /Invalid happy collision reward facts/
  );
  assert.throws(
    () => calculateHappyCollisionReward({ enemyPieceCount: 1.5 }),
    /Invalid happy collision reward facts/
  );
});
