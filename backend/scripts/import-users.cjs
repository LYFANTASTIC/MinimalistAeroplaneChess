'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { closePool } = require('../db/pool.cjs');
const { createUserRepository } = require('../repositories/userRepository.cjs');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`Invalid user field: ${field}`);
  return value;
}

function requireIsoDate(value, field) {
  requireString(value, field);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid user field: ${field}`);
  return date.toISOString();
}

function buildImportUser(user) {
  const id = requireString(user?.id, 'id');
  if (!UUID_PATTERN.test(id)) throw new TypeError('Invalid user field: id');
  return {
    id,
    username: requireString(user.username, 'username'),
    email: requireString(user.email, 'email'),
    displayName: requireString(user.displayName, 'displayName'),
    passwordSalt: requireString(user.passwordSalt, 'passwordSalt'),
    passwordHash: requireString(user.passwordHash, 'passwordHash'),
    createdAt: requireIsoDate(user.createdAt, 'createdAt'),
    updatedAt: requireIsoDate(user.updatedAt, 'updatedAt')
  };
}

async function importUsers({ users, apply, insertUser }) {
  if (!Array.isArray(users)) throw new TypeError('User import source must contain a users array');
  const normalizedUsers = users.map(buildImportUser);
  const result = { validated: normalizedUsers.length, inserted: 0, skipped: 0 };
  if (!apply) return result;

  for (const user of normalizedUsers) {
    if (await insertUser(user)) result.inserted += 1;
    else result.skipped += 1;
  }
  return result;
}

async function runCli() {
  const apply = process.argv.includes('--apply');
  const sourcePath = path.resolve(
    process.env.USER_DATA_FILE || path.join(__dirname, '../data/users.json')
  );
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const repository = createUserRepository();
  const result = await importUsers({
    users: source.users,
    apply,
    insertUser: user => repository.importUser(user)
  });
  const mode = apply ? '写入完成' : '仅校验（添加 --apply 才会写入）';
  console.log(`[账户迁移] ${mode}: 校验 ${result.validated}，新增 ${result.inserted}，跳过 ${result.skipped}`);
}

if (require.main === module) {
  runCli()
    .catch(error => {
      console.error('[账户迁移] 失败:', error.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}

module.exports = {
  buildImportUser,
  importUsers,
  runCli
};

