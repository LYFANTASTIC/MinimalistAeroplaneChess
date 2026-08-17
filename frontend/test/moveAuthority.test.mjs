import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDirectory, '../js/chessPiece.js'), 'utf8');

test('online finish and stack-crash branches publish a final move result', () => {
  assert.match(source, /syncFinalMoveResult\(player, chessIndex, 56, this\._currentMoveBeatenChesses\)/);
  assert.match(source, /syncFinalMoveResult\(player, chessIndex, -1, this\._currentMoveBeatenChesses\)/);
});
