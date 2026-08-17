const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadEnvironment } = require('../config/loadEnv.cjs');

test('environment loader reads root then backend env without overwriting process values', () => {
  const calls = [];
  const rootDirectory = path.resolve('C:/example/project');
  loadEnvironment({
    rootDirectory,
    dotenv: { config(options) { calls.push(options); return {}; } }
  });

  assert.deepEqual(calls, [
    { path: path.join(rootDirectory, '.env'), override: false, quiet: true },
    { path: path.join(rootDirectory, 'backend/.env'), override: false, quiet: true }
  ]);
});
