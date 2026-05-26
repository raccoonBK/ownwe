/**
 * 角色扮演系统 API 路由
 */

import express from 'express';
import { createSession, loadConfig, makePublicConfig, saveLocalConfig } from '../lib/rp-engine.js';
import { saveSession, loadSession, listSessions, archiveSession, listArchive, loadArchive, restoreToVacation } from '../lib/session.js';
import { generateWorld } from '../lib/world-gen.js';
import { processPlayerTurn } from '../lib/world-workflow.js';
import { loadPrompt, savePrompt, listPrompts, loadPlayerBase, savePlayerBase, listThemes } from '../lib/prompts.js';
import { PLAYER_SLOTS, ensureThreePlayerShape, getPlayer, normalizePlayer, playerName } from '../lib/players.js';

const router = express.Router();

function normalizeIncomingConfig(incoming) {
  const currentLocal = loadConfig({ includeEnv: false });
  const next = JSON.parse(JSON.stringify(incoming || {}));
  for (const [tier, apiConfig] of Object.entries(next.api || {})) {
    delete apiConfig.keyConfigured;
    delete apiConfig.keyEnv;
    if (!apiConfig.key) apiConfig.key = currentLocal.api?.[tier]?.key || '';
  }
  return next;
}

// ---- 游戏流程 ----

/** 获取可用主题列表 */
router.get('/themes', (req, res) => {
  res.json(listThemes());
});

/** 创建新游戏 */
router.post('/create', async (req, res) => {
  try {
    const { 主题 } = req.body;
    if (!主题) return res.status(400).json({ error: '需要选择主题' });

    const session = createSession(主题);
    saveSession(session);

    // 异步生成世界（可能比较慢）
    generateWorld(session).then(() => {
      console.log(`[世界生成完毕] ${session.id}`);
    }).catch(err => {
      console.error(`[世界生成失败] ${session.id}:`, err.message);
      session.状态 = '生成失败';
      session.错误 = err.message;
      saveSession(session);
    });

    res.json({ id: session.id, 状态: '生成中' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取游戏状态 */
router.get('/session/:id', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  res.json(session);
});

/** 获取玩家视角（只返回该玩家能看到的内容） */
router.get('/session/:id/view/:player', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  ensureThreePlayerShape(session);

  const player = normalizePlayer(req.params.player);
  if (!player) {
    return res.status(400).json({ error: '玩家必须是A、B或C' });
  }

  const playerData = getPlayer(session, player);
  const otherPlayers = PLAYER_SLOTS
    .filter(slot => slot !== player)
    .map(slot => ({
      玩家: slot,
      玩家名: playerName(session, slot),
      角色名: getPlayer(session, slot)?.fullSetting?.名字 || '',
      公屏状态: session.publicStatus[slot],
      公屏背包: session.inventory[slot]?.公屏背包 || []
    }));

  res.json({
    状态: session.状态,
    轮次: session.turnCount,
    游戏时间: session.gameTime,
    世界观: session.scenario?.worldSetting || '',
    当前玩家: player,
    当前玩家名: playerName(session, player),
    玩家列表: PLAYER_SLOTS.map(slot => ({
      玩家: slot,
      玩家名: playerName(session, slot),
      角色名: getPlayer(session, slot)?.fullSetting?.名字 || ''
    })),
    我的设定: playerData.visiblePackage,
    我的公屏状态: session.publicStatus[player],
    我的背包: session.inventory[player],
    其他玩家: otherPlayers,
    对方公屏状态: otherPlayers[0]?.公屏状态 || null,
    对方公屏背包: otherPlayers[0]?.公屏背包 || [],
    我的视角历史: playerData.view,
    对话历史: session.history.map(h => ({
      轮次: h.轮次,
      玩家: h.玩家,
      玩家名: h.玩家 === '世界' ? '世界' : playerName(session, h.玩家),
      公开输入: h.公开输入 || ''
    })),
    伏笔状态: session.foreshadowing.map(f => ({
      名称: f.名称,
      状态: f.状态
    })),
    事件: {
      距下次骰子: session.turnCount % (loadConfig().骰子.事件.掷骰间隔轮数) || 0,
      已触发事件数: session.events.已触发事件.length
    }
  });
});

/** 发送消息（玩家行动） */
router.post('/session/:id/action', async (req, res) => {
  try {
    const session = loadSession(req.params.id);
    if (!session) return res.status(404).json({ error: '会话不存在' });
    ensureThreePlayerShape(session);
    if (session.状态 !== '进行中' && session.状态 !== '度假中') {
      return res.status(400).json({ error: `当前状态不允许行动：${session.状态}` });
    }

    const player = normalizePlayer(req.body.player);
    const { publicInput, hiddenInput } = req.body;
    if (!player) {
      return res.status(400).json({ error: '玩家必须是A、B或C' });
    }
    if (!publicInput && !hiddenInput) {
      return res.status(400).json({ error: '至少需要一条消息（公开或隐藏）' });
    }

    const result = await processPlayerTurn(session, player, publicInput || '', hiddenInput || '');
    saveSession(session);

    // 返回该玩家的视角
    const view = result.views?.[player] || result[`view${player}`];
    res.json({
      轮次: session.turnCount,
      游戏时间: session.gameTime,
      view,
      事件触发: session.events.待注入事件 ? true : false
    });
  } catch (err) {
    console.error('[行动处理失败]', err);
    res.status(500).json({ error: err.message });
  }
});

/** 结算游戏 */
router.post('/session/:id/end', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });

  const { mode } = req.body; // 'archive' 或 'vacation'

  if (mode === 'vacation') {
    session.状态 = '度假中';
    saveSession(session);
    return res.json({ 状态: '度假中', message: '骰子和事件已停止，世界仍然活着' });
  }

  // 归档
  session.状态 = '已结算';
  const archivePath = archiveSession(session);
  res.json({ 状态: '已结算', 归档路径: archivePath });
});

// ---- 总览 ----

/** 列出所有进行中的游戏 */
router.get('/sessions', (req, res) => {
  res.json(listSessions());
});

/** 列出所有归档游戏 */
router.get('/archive', (req, res) => {
  res.json(listArchive());
});

/** 获取归档详情 */
router.get('/archive/:id', (req, res) => {
  const data = loadArchive(req.params.id);
  if (!data) return res.status(404).json({ error: '归档不存在' });
  res.json(data);
});

/** 从归档进入度假模式 */
router.post('/archive/:id/vacation', (req, res) => {
  const session = restoreToVacation(req.params.id);
  if (!session) return res.status(404).json({ error: '归档不存在或无法恢复' });
  res.json({ 状态: '度假中', id: session.id, message: '欢迎回来。骰子和事件已停止，世界仍然活着。' });
});

// ---- 日志 ----

/** 获取游戏日志 */
router.get('/session/:id/logs', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  res.json(session.log || []);
});

// ---- 提示词管理（调试面板） ----

/** 列出所有提示词文件 */
router.get('/prompts', (req, res) => {
  res.json(listPrompts());
});

/** 读取提示词 */
router.get('/prompts/:filename', (req, res) => {
  const content = loadPrompt(req.params.filename);
  res.json({ filename: req.params.filename, content });
});

/** 保存提示词 */
router.post('/prompts/:filename', (req, res) => {
  const { content } = req.body;
  savePrompt(req.params.filename, content);
  res.json({ ok: true });
});

/** 读取玩家基本设定 */
router.get('/player-base', (req, res) => {
  res.json(loadPlayerBase());
});

/** 保存玩家基本设定 */
router.post('/player-base', (req, res) => {
  savePlayerBase(req.body);
  res.json({ ok: true });
});

// ---- 配置管理（设置面板） ----

/** 读取配置 */
router.get('/config', (req, res) => {
  res.json(makePublicConfig(loadConfig()));
});

/** 保存配置 */
router.post('/config', (req, res) => {
  saveLocalConfig(normalizeIncomingConfig(req.body));
  res.json({ ok: true });
});

export default router;
