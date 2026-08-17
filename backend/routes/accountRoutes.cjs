'use strict';

const { CursorError, decodeCursor } = require('../repositories/matchRepository.cjs');

function requireUser(req, res) {
  if (req.auth?.user?.id) return req.auth.user;
  res.status(401).json({ success: false, message: '请先登录后再继续' });
  return null;
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(50, Math.max(1, parsed));
}

function sendError(res, error, label) {
  if (error instanceof CursorError) {
    return res.status(400).json({ success: false, message: error.message });
  }
  console.error(`[账户系统] ${label}失败:`, error);
  return res.status(503).json({ success: false, message: `${label}暂时不可用，请稍后重试` });
}

function createAccountHandlers({ userRepository, matchRepository }) {
  return {
    async summary(req, res) {
      const user = requireUser(req, res);
      if (!user) return;
      try {
        const summary = await userRepository.getAccountSummary(user.id);
        if (!summary) return res.status(404).json({ success: false, message: '账号不存在' });
        return res.json({ success: true, summary });
      } catch (error) {
        return sendError(res, error, '账户摘要');
      }
    },

    async matches(req, res) {
      const user = requireUser(req, res);
      if (!user) return;
      try {
        const page = await matchRepository.getUserMatches(user.id, {
          limit: parseLimit(req.query?.limit),
          cursor: decodeCursor(req.query?.cursor)
        });
        return res.json({ success: true, ...page });
      } catch (error) {
        return sendError(res, error, '对局记录');
      }
    },

    async points(req, res) {
      const user = requireUser(req, res);
      if (!user) return;
      try {
        const page = await matchRepository.getUserPoints(user.id, {
          limit: parseLimit(req.query?.limit),
          cursor: decodeCursor(req.query?.cursor)
        });
        return res.json({ success: true, ...page });
      } catch (error) {
        return sendError(res, error, '积分流水');
      }
    }
  };
}

module.exports = {
  createAccountHandlers,
  parseLimit
};
