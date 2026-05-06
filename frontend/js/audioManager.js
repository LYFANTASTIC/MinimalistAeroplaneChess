// 音效管理器
class AudioManager {
    constructor() {
        this.sounds = {};
        this.isEnabled = true;
        this.volume = 1;
        this.isLoaded = false;
        this.isMultiplayerMode = false;
        this.allPlayersAudioLoaded = false;
        this.preloadStarted = false; // 添加预加载状态标记

        // 音效文件路径配置
        this.soundPaths = {
            rolling: 'audio/rolling.wav',
            move: 'audio/move.wav',
            fly: 'audio/fly.wav',
            beat: 'audio/beat.wav',
            shake: 'audio/shake.wav',
            gameover: 'audio/gameover.wav',
            finish: 'audio/finish.wav',
            skill: 'audio/skill.wav',
        };

        // 显示加载提示并隐藏游戏控件
        this.showLoadingIndicator();
    }

    /**
     * 设置多人游戏模式
     */
    setMultiplayerMode(isMultiplayer) {
        this.isMultiplayerMode = isMultiplayer;

        // 设置游戏模式后立即开始预加载
        if (!this.preloadStarted) {
            this.preloadSounds();
        }
    }

    /**
     * 设置单机游戏模式并开始预加载
     */
    setSinglePlayerMode() {
        this.isMultiplayerMode = false;

        // 设置游戏模式后立即开始预加载
        if (!this.preloadStarted) {
            this.preloadSounds();
        }
    }
    updateLoadingText(text) {
        const loadingText = document.querySelector('#loadingIndicator .loading-text');
        if (loadingText) {
            loadingText.textContent = text;
        }
    }

    /**
     * 预加载所有音效文件
     */
    async preloadSounds() {
        if (this.preloadStarted) {
            return;
        }

        this.preloadStarted = true;
        this.updateLoadingText('正在加载... 0%');

        try {
            const totalSounds = Object.keys(this.soundPaths).length;
            let loadedCount = 0;

            const updateProgress = () => {
                loadedCount++;
                const percentage = Math.floor((loadedCount / totalSounds) * 100);
                this.updateLoadingText(`正在加载... ${percentage}%`);
            };

            const loadPromises = Object.entries(this.soundPaths).map(([key, path]) => {
                return new Promise((resolve, reject) => {
                    const audio = new Audio(path);
                    audio.preload = 'auto';
                    audio.volume = this.volume;

                    audio.addEventListener('canplaythrough', () => {
                        this.sounds[key] = audio;
                        updateProgress();
                        resolve();
                    });

                    audio.addEventListener('error', (e) => {
                        console.warn(`音效 ${key} 加载失败:`, e);
                        updateProgress();
                        resolve();
                    });

                    // 开始加载
                    audio.load();
                });
            });

            await Promise.all(loadPromises);
            this.isLoaded = true;

            // 如果是联机模式，通知其他玩家音频加载完成
            if (this.isMultiplayerMode && window.multiplayerGameManager) {
                // 标志位由 multiplayerGameManager 根据服务器信号严格控制
                if (this.allPlayersAudioLoaded) {
                    console.log('[音频加载] 收到全员就位信号，隐藏遮罩');
                    this.hideLoadingIndicator();
                } else {
                    console.log('[音频加载] 尚未全员就绪，显示等待文字');
                    this.updateLoadingText('等待其他玩家加载...');
                }
                window.multiplayerGameManager.notifyAudioLoaded();
            } else {
                // 单机模式直接隐藏加载提示
                this.hideLoadingIndicator();
            }
        } catch (error) {
            console.error('音效预加载失败:', error);
            this.isLoaded = true; // 即使失败也标记为已加载，避免阻塞

            // 如果是联机模式，通知其他玩家音频加载完成（即使失败）
            if (this.isMultiplayerMode && window.multiplayerGameManager) {
                if (this.allPlayersAudioLoaded) {
                    this.hideLoadingIndicator();
                } else {
                    this.updateLoadingText('等待其他玩家加载...');
                }
                window.multiplayerGameManager.notifyAudioLoaded();
            } else {
                // 单机模式直接隐藏加载提示（即使失败）
                this.hideLoadingIndicator();
            }
        }
    }

    /**
     * 处理所有玩家音频加载完成
     */
    onAllPlayersAudioLoaded() {
        console.log('[音频] 所有玩家音频加载完成，开始游戏');
        this.allPlayersAudioLoaded = true;
        this.hideLoadingIndicator();
    }

    /**
     * 播放指定音效
     * @param {string} soundName - 音效名称 (rolling, move, fly)
     * @param {number} volume - 音量 (0-1)，可选
     */
    playSound(soundName, volume = null) {
        if (!this.isEnabled || !this.isLoaded) {
            return;
        }

        const sound = this.sounds[soundName];
        if (!sound) {
            console.warn(`音效 ${soundName} 不存在`);
            return;
        }

        try {
            // 克隆音频对象以支持同时播放多个相同音效
            const audioClone = sound.cloneNode();
            audioClone.volume = volume !== null ? volume : this.volume;

            // 播放音效
            const playPromise = audioClone.play();

            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn(`播放音效 ${soundName} 失败:`, error);
                });
            }
        } catch (error) {
            console.warn(`播放音效 ${soundName} 出错:`, error);
        }
    }

    /**
     * 播放投骰子音效
     */
    playRollingSound() {
        this.playSound('rolling');
    }

    /**
     * 播放移动音效
     */
    playMoveSound() {
        this.playSound('move');
    }

    /**
     * 播放飞行音效（起飞、跳子、飞棋）
     */
    playFlySound() {
        this.playSound('fly');
    }
    playBeatSound() {
        this.playSound('beat');
    }
    playShakeSound() {
        this.playSound('shake');
    }

    /**
     * 播放游戏结束音效
     */
    playGameOverSound() {
        this.playSound('gameover');
    }
    /**
     * 播放达到终点返回基地后
     */
    playFinishSound() {
        this.playSound('finish');
    }
    /**
     * 播放道具音效
     */
    playSkillSound() {
        this.playSound('skill');
    }
    /**
     * 获取当前音效状态
     */
    getStatus() {
        return {
            isEnabled: this.isEnabled,
            isLoaded: this.isLoaded,
            volume: this.volume,
            loadedSounds: Object.keys(this.sounds)
        };
    }

    /**
     * 停止所有音效
     */
    stopAllSounds() {
        Object.values(this.sounds).forEach(sound => {
            if (sound && !sound.paused) {
                sound.pause();
                sound.currentTime = 0;
            }
        });
    }
    // 静音
    mute() {
        this.isEnabled = false;
        this.stopAllSounds();
    }
    // 取消静音
    unmute() {
        this.isEnabled = true;
    }

    /**
     * 显示加载提示并隐藏游戏控件
     */
    showLoadingIndicator() {
        const loadingIndicator = document.getElementById('loadingIndicator');
        const diceDisplay = document.getElementById('diceDisplay');
        const thinkingProgressContainer = document.getElementById('thinkingProgressContainer');
        const chatBtn = document.getElementById('chatBtn');
        const skillBtn = document.getElementById('skillBtn');

        if (loadingIndicator) {
            loadingIndicator.style.display = 'flex';
        }

        // 如果游戏处于暂停状态，不需要执行隐藏骰子等操作，因为暂停逻辑已经处理了
        const isPaused = window.gameState && window.gameState.getIsPaused();
        if (isPaused) {
            return;
        }

        // 检查聊天输入框是否正在显示，如果是则不隐藏骰子
        const chatInputArea = document.getElementById('chatInputArea');
        if (diceDisplay && !(chatInputArea && chatInputArea.style.display === 'flex')) {
            diceDisplay.style.display = 'none';
        }

        if (thinkingProgressContainer) {
            thinkingProgressContainer.style.display = 'none';
        }

        // 隐藏聊天图标
        if (chatBtn) {
            chatBtn.style.display = 'none';
        }

        // 隐藏道具图标
        if (skillBtn) {
            skillBtn.style.display = 'none';
        }

    }

    /**
     * 隐藏加载提示并显示游戏控件
     */
    hideLoadingIndicator() {
        const loadingIndicator = document.getElementById('loadingIndicator');
        
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }

        // 只有下面的 UI 恢复逻辑才受暂停状态影响
        const isPaused = window.gameState && window.gameState.getIsPaused();
        if (isPaused) {
            return;
        }

        const diceDisplay = document.getElementById('diceDisplay');
        const thinkingProgressContainer = document.getElementById('thinkingProgressContainer');
        const chatBtn = document.getElementById('chatBtn');
        const skillBtn = document.getElementById('skillBtn');

        // 如果游戏未暂停，显示骰子和进度条
        // 使用 uiUpdater 统一管理骰子显示逻辑，避免与其他UI（聊天、道具等）冲突
        if (window.uiUpdater && typeof window.uiUpdater.updateDiceDisplay === 'function') {
            window.uiUpdater.updateDiceDisplay();
        } else if (diceDisplay) {
            const chatInputArea = document.getElementById('chatInputArea');
            if (!(chatInputArea && window.getComputedStyle(chatInputArea).display !== 'none')) {
                diceDisplay.style.display = 'flex';
            }
        }

        if (thinkingProgressContainer) {
            thinkingProgressContainer.style.display = 'block';
        }

        // 检查是否为在线多人模式
        const isOnlineMultiplayer = window.gameState && window.gameState.getIsOnlineMultiplayer();
        const isLocalMultiplayer = window.gameState && window.gameState.getIsLocalMultiplayer();

        // 只在在线多人模式下显示聊天图标（本地多人不需要聊天）
        if (chatBtn) {
            if (isOnlineMultiplayer) {
                chatBtn.style.display = 'block';
            } else {
                chatBtn.style.display = 'none';
            }
        }

        // 闪电模式按钮：只在人机模式（非本地多人且非在线多人）下显示
        const lightningBtn = document.getElementById('lightningBtn');
        if (lightningBtn) {
            const isManMachine = !isOnlineMultiplayer && !isLocalMultiplayer;
            if (isManMachine) {
                // 确保已初始化
                if (window.gameInstance && window.gameInstance.lightningManager) {
                    window.gameInstance.lightningManager.init();
                }
                lightningBtn.style.display = 'block';
            } else {
                lightningBtn.style.display = 'none';
            }
        }

        // 根据道具模式显示或隐藏道具图标
        if (skillBtn) {
            // 观战模式永远隐藏道具按钮
            const isSpectator = window.multiplayerGameManager && window.multiplayerGameManager.isSpectator;
            if (isSpectator) {
                skillBtn.style.display = 'none';
            } else {
                // 检查是否启用道具模式
                const gameConfig = sessionStorage.getItem('gameConfig');
                const localGameConfig = sessionStorage.getItem('localGameConfig');
                let skillMode = false;

                // 优先检查localGameConfig（本地多人模式）
                if (localGameConfig) {
                    try {
                        const config = JSON.parse(localGameConfig);
                        skillMode = config.skillMode === true;
                    } catch (e) {
                        console.error('解析localGameConfig失败:', e);
                    }
                }
                // 其次检查gameConfig（人机模式和在线多人模式）
                else if (gameConfig) {
                    try {
                        const config = JSON.parse(gameConfig);
                        skillMode = config.skillMode === true;
                    } catch (e) {
                        console.error('解析gameConfig失败:', e);
                    }
                }

                // 只要启用了道具模式就显示道具按钮（不限制游戏模式）
                if (skillMode) {
                    skillBtn.style.display = 'block';
                } else {
                    skillBtn.style.display = 'none';
                }
            }
        }
    }
}

// 创建全局音效管理器实例
export const audioManager = new AudioManager();
export default AudioManager;