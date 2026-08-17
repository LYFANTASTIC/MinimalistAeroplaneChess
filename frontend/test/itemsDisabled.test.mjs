import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  ITEMS_ENABLED,
  applyItemsFeatureState,
  normalizeItemSettings
} from '../js/config/features.js';

const require = createRequire(import.meta.url);
const backendFeatures = require('../../backend/config/features.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('item flags are off in both browser and server', () => {
  assert.equal(ITEMS_ENABLED, false);
  assert.equal(backendFeatures.ITEMS_ENABLED, false);
});

test('room settings always force item mode off', () => {
  assert.deepEqual(normalizeItemSettings({ skillMode: true, happyMode: true }), {
    skillMode: false,
    happyMode: true
  });
});

test('feature-state helper hides retained item roots and disables controls', () => {
  const input = { checked: true, disabled: false };
  const node = {
    hidden: false,
    setAttribute(name, value) { this[name] = value; },
    querySelectorAll() { return [input]; }
  };
  const root = { querySelectorAll() { return [node]; } };

  applyItemsFeatureState(root);

  assert.equal(node.hidden, true);
  assert.equal(node['aria-hidden'], 'true');
  assert.equal(input.checked, false);
  assert.equal(input.disabled, true);
});

test('item markup and handlers remain in source behind feature gates', () => {
  const indexHtml = fs.readFileSync(path.join(projectRoot, 'frontend/index.html'), 'utf8');
  const gameHtml = fs.readFileSync(path.join(projectRoot, 'frontend/game.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(projectRoot, 'backend/server.cjs'), 'utf8');

  assert.ok((indexHtml.match(/data-items-feature/g) || []).length >= 4);
  assert.ok((gameHtml.match(/data-items-feature/g) || []).length >= 3);
  assert.match(gameHtml, /data-skill="mysteryBox"/);
  assert.match(gameHtml, /data-skill="remote-dice"/);
  assert.match(serverSource, /ITEM_MESSAGE_TYPES/);
  assert.match(serverSource, /type:\s*'itemsDisabled'/);
  assert.match(serverSource, /skillMode:\s*ITEMS_ENABLED/);
});
