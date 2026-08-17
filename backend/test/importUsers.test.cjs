const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImportUser,
  importUsers
} = require('../scripts/import-users.cjs');

const JSON_USER = Object.freeze({
  id: 'dc16af26-51f8-4d78-a1c4-4e8c71e04b1c',
  username: 'Pilot',
  usernameKey: 'pilot',
  email: 'pilot@example.com',
  displayName: '飞行员',
  passwordSalt: 'salt-value',
  passwordHash: 'hash-value',
  createdAt: '2026-08-01T01:02:03.000Z',
  updatedAt: '2026-08-02T01:02:03.000Z'
});

test('JSON import preserves identity, hash, and timestamps', () => {
  assert.deepEqual(buildImportUser(JSON_USER), {
    id: JSON_USER.id,
    username: 'Pilot',
    email: 'pilot@example.com',
    displayName: '飞行员',
    passwordSalt: 'salt-value',
    passwordHash: 'hash-value',
    createdAt: '2026-08-01T01:02:03.000Z',
    updatedAt: '2026-08-02T01:02:03.000Z'
  });
});

test('dry-run validates users without writing', async () => {
  let writes = 0;
  const result = await importUsers({
    users: [JSON_USER],
    apply: false,
    insertUser: async () => { writes += 1; }
  });

  assert.deepEqual(result, { validated: 1, inserted: 0, skipped: 0 });
  assert.equal(writes, 0);
});

test('apply mode reports inserted and skipped users', async () => {
  const result = await importUsers({
    users: [JSON_USER, { ...JSON_USER, id: '554b0d5a-1e13-45e1-a176-2e91be970de3', username: 'Pilot2', email: 'pilot2@example.com' }],
    apply: true,
    insertUser: async user => user.username === 'Pilot'
  });

  assert.deepEqual(result, { validated: 2, inserted: 1, skipped: 1 });
});
