/**
 * 称号管理器 - 负责计算和分配玩家结算称号
 * 称号优先级：概率称号 > 唯一称号 > 默认称号
 */
import { activePlayerManager } from './activePlayerManager.js';

class TitleManager {
    constructor() {
        // 称号配置
        this.TITLES = {
            // 概率称号 (优先级 1)
            PROBABILITY: {
                REVERSE_LUCKY: { id: 'reverse_lucky', name: '反向欧皇', desc: '连着三回合都摇到 1 点' },
                UNLUCKY_START: { id: 'unlucky_takeoff', name: '非酋', desc: '连着三回合无法起飞' },
                LUCKY_KING: { id: 'lucky_king', name: '欧皇', desc: '连投三次 6' },
                INVISIBLE: { id: 'invisible', name: '不死传说', desc: '整局未被击败过' },
                TAILWIND_WALKER: { id: 'tailwind_walker', name: '顺风行者', desc: '在整局未发生过反弹的情况下获胜' },
                BOUNCE_KING: { id: 'wind_walker', name: '逆风行者', desc: '反弹总格数超过 50 格' }
            },
            // 唯一称号 (优先级 2)
            UNIQUE: {
                MARATHON: { id: 'marathon', name: '长跑冠军', desc: '移动格数全场最多' },
                SPEED_LEGEND: { id: 'speed_legend', name: '最速传说', desc: '首个使棋子抵达终点' },
                SIX_MASTER: { id: 'six_master', name: '六点狂魔', desc: '摇到 6 的次数全场最多' },
                KILLER: { id: 'killer', name: '收割者', desc: '击败对手次数最多' },
                HOME_VISITOR: { id: 'home_visitor', name: '回家常客', desc: '被对手击败次数最多' },
                CHESS_KING: { id: 'chess_king', name: '棋王', desc: '本局第一名' },
                COMEBACK: { id: 'comeback', name: '逆风翻盘', desc: '整局 60% 时间处于垫底，最后反败为胜' },
                STEADY_DOG: { id: 'steady_dog', name: '避战大师', desc: '被击败次数全场最少' }
            },
            // 默认称号
            DEFAULT: { id: 'default', name: '平凡棋手', desc: '平平淡淡才是真' }
        };
    }

    /**
     * 计算所有玩家的称号
     * @param {Object} gameState - 游戏状态对象
     * @param {Array} rankings - 排名数据 [{player: 1, position: 1, ...}]
     * @returns {Object} { playerNumber: { name, desc } }
     */
    calculateTitles(gameState, rankings) {
        const playerTitles = {};
        const activePlayers = activePlayerManager.getActivePlayers();
        
        // 预计算统计数据
        const stats = this._prepareStats(gameState, activePlayers, rankings);
        const uniqueWinners = this._computeUniqueWinners(stats, gameState, rankings, activePlayers);

        // 为每个玩家确定称号
        activePlayers.forEach(player => {
            playerTitles[player] = this._determinePlayerTitle(player, gameState, stats, rankings, uniqueWinners);
        });

        return playerTitles;
    }

    /**
     * 预计算每项唯一称号的唯一得主
     * 平局时以玩家编号小者为胜（确定性裁决）
     */
    _computeUniqueWinners(stats, gameState, rankings, activePlayers) {
        const winners = {};

        // 最速传说 - 仅首个完成者，不可能有平局
        winners.speedLegend = stats.firstFinished;
        
        // 长跑冠军 - 距离最高，平局取编号小者
        winners.marathon = this._findTiebreakWinner(activePlayers, stats.totalDistances, 'max', 1);
        
        // 收割者 - 击败最多，平局取编号小者
        winners.killer = this._findTiebreakWinner(activePlayers, stats.defeatOthersCounts, 'max', 1);
        
        // 六点狂魔 - 六点最多，平局取编号小者
        winners.sixMaster = this._findTiebreakWinner(activePlayers, stats.diceSixCounts, 'max', 1);
        
        // 回家常客 - 被击败最多，平局取编号小者
        winners.homeVisitor = this._findTiebreakWinner(activePlayers, stats.beenDefeatedCounts, 'max', 1);
        
        // 避战大师 - 被击败最少（且>0），平局取编号小者
        winners.steadyDog = this._findTiebreakWinner(activePlayers, stats.beenDefeatedCounts, 'min', 1);

        // 棋王 - 第一名，且必须在完成度上独占第一（与第二名同分时视为并列，不授予）
        if (rankings && rankings.length > 0) {
            const firstPlayer = rankings.find(r => r.position === 1);
            const secondPlayer = rankings.find(r => r.position === 2);
            // 没有第二名 / 第一名完成度严格大于第二名 → 真正领先
            const isSoleLeader = firstPlayer && (!secondPlayer || firstPlayer.progress > secondPlayer.progress);
            winners.chessKing = isSoleLeader ? firstPlayer.player : null;
        }

        // 逆风翻盘 - 需要额外逻辑，单独计算
        winners.comeback = this._findComebackWinner(activePlayers, gameState, rankings);

        return winners;
    }

    /**
     * 寻找指定统计维度中胜出的玩家（带确定性平局裁决）
     * @param {Array} players - 活跃玩家列表
     * @param {Object} statsMap - 统计数据 { player: value }
     * @param {'max'|'min'} mode - 取最大值还是最小值
     * @param {number} minValue - 有效参与的最小值
     * @returns {number|null} 胜出的玩家编号，无合格者返回 null
     */
    _findTiebreakWinner(players, statsMap, mode, minValue) {
        const valid = players.filter(p => statsMap[p] !== undefined && statsMap[p] >= minValue);
        if (valid.length === 0) return null;

        let bestValue;
        if (mode === 'max') {
            bestValue = Math.max(...valid.map(p => statsMap[p]));
        } else {
            bestValue = Math.min(...valid.map(p => statsMap[p]));
        }

        // 找出所有达到最佳值的玩家，取编号最小者
        const tied = valid.filter(p => statsMap[p] === bestValue);
        return tied.length > 0 ? Math.min(...tied) : null;
    }

    /**
     * 计算逆风翻盘称号的得主
     */
    _findComebackWinner(activePlayers, gameState, rankings) {
        if (!gameState.progressHistory || gameState.progressHistory.length < 5) return null;
        
        const history = gameState.progressHistory;
        if (!rankings) return null;
        
        const champion = rankings.find(r => r.position === 1);
        if (!champion) return null;
        
        const player = champion.player;
        let behindCount = 0;

        history.forEach(snapshot => {
            const playerProgress = snapshot.players[player] || 0;
            const progresses = Object.values(snapshot.players);
            const minProgress = Math.min(...progresses);
            if (playerProgress === minProgress) {
                behindCount++;
            }
        });

        return behindCount / history.length >= 0.6 ? player : null;
    }

    /**
     * 预计算统计数据，用于唯一称号判定
     */
    _prepareStats(gameState, activePlayers, rankings) {
        const stats = {
            totalDistances: {},
            diceSixCounts: {},
            defeatOthersCounts: {},
            beenDefeatedCounts: {},
            firstFinished: gameState.titleStats.firstFinishedPlayer,
            // 是否正常结束游戏（至少有一名玩家所有棋子到达终点）
            // 强制结算时没有任何玩家完成全部棋子，不应触发某些称号
            isNormalGameEnd: false
        };

        // 检查是否正常结束：有玩家的全部棋子都到达终点
        for (const p of activePlayers) {
            const chesses = gameState.playerChess?.[p];
            if (chesses && chesses.length > 0) {
                const allFinished = chesses.every(c => c.finished || c.position === 56);
                if (allFinished) {
                    stats.isNormalGameEnd = true;
                    break;
                }
            }
        }

        activePlayers.forEach(player => {
            // 前进距离
            stats.totalDistances[player] = gameState.getTotalDistance(player);
            
            // 6点次数
            stats.diceSixCounts[player] = gameState.diceStatistics[player]?.[6] || 0;
            
            // 击败他人次数
            let defeatOthers = 0;
            for (let target = 1; target <= 4; target++) {
                if (target !== player) {
                    defeatOthers += gameState.defeatCounts[player]?.[target] || 0;
                }
            }
            stats.defeatOthersCounts[player] = defeatOthers;

            // 被击败次数 (从其他玩家的 defeatCounts 中汇总)
            let beenDefeated = 0;
            activePlayers.forEach(other => {
                if (other !== player) {
                    beenDefeated += gameState.defeatCounts[other]?.[player] || 0;
                }
            });
            stats.beenDefeatedCounts[player] = beenDefeated;
        });

        return stats;
    }

    /**
     * 为单个玩家确定优先级最高的称号
     */
    _determinePlayerTitle(player, gameState, stats, rankings, uniqueWinners) {
        const titleStats = gameState.titleStats;
        const ranking = rankings.find(r => r.player === player);

        // --- 1. 概率称号 (最高优先级) ---

        // 反向欧皇：连着三回合 1 点
        if (titleStats.consecutiveOnes[player] >= 3) {
            return this.TITLES.PROBABILITY.REVERSE_LUCKY;
        }

        // 非酋：连着三回合无法起飞
        if (titleStats.consecutiveNoTakeoff[player] >= 3) {
            return this.TITLES.PROBABILITY.UNLUCKY_START;
        }

        // 欧皇：连投三次 6
        if (titleStats.maxConsecutiveSixes[player] >= 3) {
            return this.TITLES.PROBABILITY.LUCKY_KING;
        }

        // 不死传说：正常结束游戏且整局未被击败过（强制结算时未完成全程，不授予）
        if (stats.isNormalGameEnd && stats.beenDefeatedCounts[player] === 0) {
            return this.TITLES.PROBABILITY.INVISIBLE;
        }

        // 顺风行者：正常结束游戏，整局未发生过反弹且获胜（强制结算时未完成全程，不授予）
        if (stats.isNormalGameEnd && titleStats.bounceSteps && titleStats.bounceSteps[player] === 0 && ranking && ranking.position === 1) {
            return this.TITLES.PROBABILITY.TAILWIND_WALKER;
        }

        // 逆风行者：反弹格数超过 50 格
        if (titleStats.bounceSteps && titleStats.bounceSteps[player] > 50) {
            return this.TITLES.PROBABILITY.BOUNCE_KING;
        }

        // --- 2. 唯一称号 ---
        // 使用预计算的唯一称号得主表，平局时由 lowest player number 裁决，确保不重复

        // 最速传说 (首个完成)
        if (uniqueWinners.speedLegend === player) {
            return this.TITLES.UNIQUE.SPEED_LEGEND;
        }

        // 长跑冠军 (距离最多)
        if (uniqueWinners.marathon === player && stats.totalDistances[player] > 0) {
            return this.TITLES.UNIQUE.MARATHON;
        }

        // 收割者 (击败最多)
        if (uniqueWinners.killer === player && stats.defeatOthersCounts[player] > 0) {
            return this.TITLES.UNIQUE.KILLER;
        }

        // 六点狂魔 (6点最多)
        if (uniqueWinners.sixMaster === player && stats.diceSixCounts[player] > 0) {
            return this.TITLES.UNIQUE.SIX_MASTER;
        }

        // 回家常客 (被击败最多)
        if (uniqueWinners.homeVisitor === player && stats.beenDefeatedCounts[player] > 0) {
            return this.TITLES.UNIQUE.HOME_VISITOR;
        }

        // 避战大师 (被击败最少，且>0)
        if (uniqueWinners.steadyDog === player && stats.beenDefeatedCounts[player] > 0) {
            return this.TITLES.UNIQUE.STEADY_DOG;
        }

        // 逆风翻盘
        if (uniqueWinners.comeback === player) {
            return this.TITLES.UNIQUE.COMEBACK;
        }

        // 棋王 (第一名)
        if (uniqueWinners.chessKing === player) {
            return this.TITLES.UNIQUE.CHESS_KING;
        }

        // --- 3. 默认称号 ---
        return this.TITLES.DEFAULT;
    }

}

export const titleManager = new TitleManager();
