import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    formatAccountNumber,
    mergeHistoryItems,
    renderMatchHistory,
    renderPointsHistory
} from '../js/accountView.js';
import { filterAvailableTitles, isItemTitle } from '../js/titleManager.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '..');

test('summary values use Chinese number formatting with at most two decimals', () => {
    assert.equal(formatAccountNumber(12345.678), '12,345.68');
    assert.equal(formatAccountNumber(null), '0');
});

test('empty account histories show visible friendly states', () => {
    assert.match(renderMatchHistory([]), /还没有对局记录/);
    assert.match(renderPointsHistory([]), /还没有积分记录/);
});

test('pagination appends new rows without duplicating an existing id', () => {
    assert.deepEqual(
        mergeHistoryItems([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]),
        [{ id: 'a' }, { id: 'b' }]
    );
});

test('match and points rows expose the persisted values', () => {
    const matches = renderMatchHistory([{
        id: 'match-1', placement: 1, planesDefeated: 3,
        accountPointsEarned: 47.25, startedAt: '2026-08-17T04:00:00.000Z'
    }]);
    assert.match(matches, /第 1 名/);
    assert.match(matches, /47\.25/);

    const points = renderPointsHistory([{
        id: 'point-1', amount: 20, reason: 'happy_collision',
        balanceAfter: 125.5, createdAt: '2026-08-17T04:00:00.000Z'
    }]);
    assert.match(points, /欢乐碰撞/);
    assert.match(points, /余额 125\.5/);
});

test('item titles remain defined but are filtered while items are disabled', () => {
    const titles = [
        { id: 'skill_master', name: '道具大师' },
        { id: 'chess_king', name: '棋王' }
    ];
    assert.equal(isItemTitle(titles[0]), true);
    assert.deepEqual(filterAvailableTitles(titles), [titles[1]]);
});

test('settlement source labels persistent rewards as per-match account points', () => {
    const source = fs.readFileSync(path.join(frontendRoot, 'js', 'settlementModal.js'), 'utf8');
    assert.match(source, /本局账户积分/);
    assert.match(source, /accountPoints\.getMatchPoints/);
});
