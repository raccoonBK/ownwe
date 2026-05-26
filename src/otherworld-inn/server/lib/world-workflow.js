/**
 * 世界回复的程序化工作流
 * 四步分离：公屏回复 → 隐藏判定 → 组装分发
 * 每步独立调用DS，不混在一起
 */

import { callDS } from './ds-api.js';
import { assemblePublicReplyPrompt, assembleHiddenJudgePrompt, loadPrompt } from './prompts.js';
import { assembleViewForPlayer } from './visibility.js';
import { checkEvent, pickEvent, loadConfig } from './rp-engine.js';
import { calculateTime, trackStatus, getWeatherForTime } from './time-tracker.js';
import { saveSession } from './session.js';
import { PLAYER_SLOTS, ensureThreePlayerShape, getPlayer, playerName } from './players.js';

/**
 * 剥离DS思维链——DS有时会把内部推理过程泄露到输出里
 * 过滤掉"好的，我发出消息后"、"好了，等我"、"嗯，"等开头的思维链段落
 */
function stripThinkingChain(text) {
  if (!text) return text;
  // 移除常见的思维链开头模式
  let cleaned = text
    .replace(/^好的[，,].*?(?=\n\n|\n[^\n])/s, '')
    .replace(/^好了[，,].*?(?=\n\n|\n[^\n])/s, '')
    .replace(/^嗯[，,].*?(?=\n\n|\n[^\n])/s, '')
    .replace(/^我发出消息后.*?(?=\n\n)/s, '')
    .replace(/^我其实很清楚.*?(?=\n\n)/s, '')
    .trim();
  // 如果清理后为空，返回原文（宁可有思维链也不能返回空）
  if (!cleaned) return text.trim();
  return cleaned;
}

/**
 * 处理一轮玩家消息
 * @param {object} session - 会话数据
 * @param {string} player - 'A'、'B' 或 'C'
 * @param {string} publicInput - 公开消息（可能为空字符串）
 * @param {string} hiddenInput - 隐藏消息（可能为空字符串）
 * @returns {object} { views, viewA, viewB, viewC, log }
 */
async function processPlayerTurn(session, player, publicInput, hiddenInput) {
  const config = loadConfig();
  ensureThreePlayerShape(session);

  // 记录轮次
  session.turnCount++;

  // 存入历史
  const historyEntry = {
    轮次: session.turnCount,
    玩家: player,
    公开输入: publicInput,
    有隐藏输入: !!hiddenInput
  };
  session.history.push(historyEntry);

  // ---- 步骤一：世界处理公屏消息 ----

  const { 完整提示词: publicSystemPrompt, 动态上下文, 分块 } = assemblePublicReplyPrompt(session);

  // 构建对话历史：先注入动态上下文，再接公屏对话
  const publicHistory = [
    // 动态上下文作为第一条消息，每轮变但不影响system prompt缓存
    { role: 'user', content: `[系统上下文更新]\n${动态上下文}` },
    { role: 'assistant', content: '已更新上下文。' },
    // 公屏对话历史
    ...session.history
      .slice(-config.游戏.历史消息保留条数)
      .filter(h => h.公开输入)
      .map(h => ({
        role: 'user',
        content: `${h.玩家 === '世界' ? '世界' : playerName(session, h.玩家)}：${h.公开输入}`
      }))
  ];

  const userMsg = publicInput
    ? `${playerName(session, player)}：${publicInput}`
    : `（${playerName(session, player)}本轮没有公开发言，请补充一条环境氛围描述）`;

  const rawPublicReply = await callDS(publicSystemPrompt, userMsg, publicHistory, 'flash');
  const publicReply = stripThinkingChain(rawPublicReply);

  // ---- 步骤二：世界处理隐藏消息（如有） ----

  const hiddenByPlayer = {};
  if (hiddenInput) {
    hiddenByPlayer[player] = await processHiddenAction(session, player, hiddenInput);
  }

  // ---- 步骤三：组装分发 ----

  const views = {};
  for (const slot of PLAYER_SLOTS) {
    views[slot] = assembleViewForPlayer(publicReply, hiddenByPlayer, slot);
    getPlayer(session, slot).view.push(views[slot]);
  }

  // ---- 步骤五：事件检查（度假模式跳过） ----

  if (session.状态 !== '度假中') {
    const eventCheck = checkEvent(session);
    if (eventCheck.应该触发) {
      const picked = pickEvent(session, eventCheck.事件类型);
      if (picked) {
        session.events.待注入事件 = picked;
      }
    }
  }

  // ---- 步骤六：状态更新 ----
  // 异步计算时间推进（不阻塞返回）
  calculateTime(session.gameTime, publicInput || hiddenInput || '').then(newTime => {
    session.gameTime = newTime;
    // 更新天气
    if (session.weather) {
      session.currentWeather = getWeatherForTime(session.weather, newTime);
    }
    saveSession(session);
  }).catch(() => {});

  // 异步追踪状态变化（不阻塞返回，传入隐藏行动和发言玩家）
  trackStatus(session, publicInput || '', hiddenInput || '', publicReply, player).catch(e => console.error('[trackStatus调用失败]', e.message));

  // ---- 写日志 ----

  const logEntry = {
    轮次: session.turnCount,
    游戏时间: session.gameTime,
    发言玩家: player,
    折叠一_上下文: {
      玩家公开输入: publicInput,
      玩家隐藏输入: hiddenInput || '无',
      对话历史条数: publicHistory.length,
      世界公屏回复: publicReply
    },
    折叠二_提示词: 分块,
    折叠三_分发: Object.fromEntries(PLAYER_SLOTS.map(slot => [
      `给${slot}的内容`,
      {
        公屏部分: views[slot].公屏内容,
        隐藏部分: views[slot].隐藏内容 || '无',
        对方渗透的信息: views[slot].渗透内容 || '无'
      }
    ]))
  };
  session.log.push(logEntry);

  return { views, viewA: views.A, viewB: views.B, viewC: views.C, log: logEntry };
}

/**
 * 处理单个玩家的隐藏行为
 * @returns {object} { 判定层级, 给行动方的回复, 给对方渗透的信息 }
 */
async function processHiddenAction(session, player, hiddenInput) {
  // 判定提示词
  const judgePrompt = assembleHiddenJudgePrompt(session, player);
  const name = playerName(session, player);

  const judgeResult = await callDS(
    judgePrompt,
    `${name}的隐藏行为：${hiddenInput}\n\n请按照判定规则判定此行为属于第几层，并按指定格式输出。`,
    [],
    'flash'
  );

  // 解析判定结果
  const parsed = parseHiddenJudge(judgeResult);

  // 如果需要生成详细的隐藏回复（第二层渗透信息等）
  // 判定结果本身已经包含了回复内容，直接使用

  return parsed;
}

/**
 * 解析隐藏行为判定结果
 * 从结构化输出中提取各字段
 */
function parseHiddenJudge(text) {
  const result = {
    判定层级: '第一层',
    判定理由: '',
    给行动方的回复: '',
    给对方渗透的信息: '无'
  };

  const layerMatch = text.match(/【判定层级[：:]】(.+)/);
  if (layerMatch) result.判定层级 = layerMatch[1].trim();

  const reasonMatch = text.match(/【判定理由[：:]】(.+)/);
  if (reasonMatch) result.判定理由 = reasonMatch[1].trim();

  const replyMatch = text.match(/【给行动方的回复[：:]】([\s\S]*?)(?=【|$)/);
  if (replyMatch) result.给行动方的回复 = replyMatch[1].trim();

  const leakMatch = text.match(/【给对方渗透的信息[：:]】([\s\S]*?)(?=【|$)/);
  if (leakMatch) result.给对方渗透的信息 = leakMatch[1].trim();

  return result;
}

export { processPlayerTurn };
