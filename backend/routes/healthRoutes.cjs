'use strict';

function createHealthHandler({ checkDatabase }) {
  if (typeof checkDatabase !== 'function') throw new TypeError('checkDatabase is required');
  return async function healthHandler(_req, res) {
    try {
      const databaseTime = await checkDatabase();
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        databaseTime: new Date(databaseTime).toISOString()
      });
    } catch (_error) {
      res.status(503).json({ success: false, error: 'database_unavailable' });
    }
  };
}

module.exports = { createHealthHandler };
