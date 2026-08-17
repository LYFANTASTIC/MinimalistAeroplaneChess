'use strict';

const { closePool, healthCheck } = require('./pool.cjs');

healthCheck()
  .then(databaseTime => console.log(`[数据库] 连接正常，数据库时间 ${new Date(databaseTime).toISOString()}`))
  .catch(error => {
    console.error('[数据库] 连接失败:', error.message);
    process.exitCode = 1;
  })
  .finally(closePool);

