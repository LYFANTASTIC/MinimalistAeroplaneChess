'use strict';

const PIECE_MULTIPLIERS = Object.freeze({
  1: 1,
  2: 1.35,
  3: 1.15,
  4: 1
});

function roundPoints(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculatePlaneDefeatReward({ progressBefore, progressAfter, pieceCount }) {
  const before = Number(progressBefore);
  const after = Number(progressAfter);
  const multiplier = PIECE_MULTIPLIERS[Number(pieceCount)];
  const progressLoss = before - after;

  if (
    !Number.isFinite(before)
    || !Number.isFinite(after)
    || before < 0
    || after < 0
    || progressLoss <= 0
    || multiplier === undefined
  ) {
    throw new RangeError('Invalid plane defeat reward facts');
  }

  return roundPoints((15 + progressLoss * 0.85) * multiplier);
}

function calculateHappyCollisionReward({ enemyPieceCount }) {
  const count = Number(enemyPieceCount);
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new RangeError('Invalid happy collision reward facts');
  }
  return roundPoints(20 * count);
}

module.exports = {
  PIECE_MULTIPLIERS,
  calculateHappyCollisionReward,
  calculatePlaneDefeatReward,
  roundPoints
};
