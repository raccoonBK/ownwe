/**
 * 世界生成工作流
 * 掷骰子 → 生成副稿 → 生成角色 → 判定可见度 → 分发 → 初始化
 */

import { callDS } from './ds-api.js';
import { rollAllStartDice } from './rp-engine.js';
import { assembleWorldGenPrompt, assemblePublicReplyPrompt, loadPrompt } from './prompts.js';
import { extractPublicSetting, extractPublicStatus } from './visibility.js';
import { saveSession } from './session.js';
import { generateWeather } from './time-tracker.js';
import { PLAYER_NAMES, PLAYER_SLOTS, ensureThreePlayerShape, getPlayer, playerKey, playerName } from './players.js';

/**
 * 生成一个新世界
 * @param {object} session - 已创建的会话（由createSession生成）
 * @returns {object} session - 填充完毕的会话
 */
async function generateWorld(session) {
  ensureThreePlayerShape(session);
  // ---- 步骤一：程序层掷骰子 ----
  session.dice = rollAllStartDice();
  session.状态 = '生成中';
  saveSession(session);

  // ---- 步骤二+三：世界引擎生成副稿和角色 ----
  // 合并为一次调用，让模型一次性生成完整副稿（包含世界设定和角色设定）
  const systemPrompt = assembleWorldGenPrompt(session.主题, session.dice);
  const userPrompt = `请根据以上所有信息，生成一个完整的三人角色扮演场景。主题是"${session.主题}"，关系是"${session.dice.关系}"，隐藏任务分配是"${session.dice.隐藏任务}"。三位玩家是：玩家A=你，玩家B=Codex，玩家C=Claude。严格按照结构化中文标签格式输出，必须包含角色A、角色B、角色C。`;

  const rawScenario = await callDS(systemPrompt, userPrompt, [], 'pro');

  // 解析副稿
  session.scenario = parseScenario(rawScenario);
  session.scenario._raw = rawScenario;

  // ---- 步骤三：提取角色设定 ----
  for (const player of PLAYER_SLOTS) {
    const data = getPlayer(session, player);
    data.fullSetting = session.scenario[playerKey(player)] || buildFallbackCharacter(player);
    data.publicSetting = extractPublicSetting(data.fullSetting);
  }

  // ---- 步骤四：信息可见度 ----
  // 从副稿中提取各自已知对方的信息
  for (const player of PLAYER_SLOTS) {
    getPlayer(session, player).knownAboutOthers = session.scenario[`info${player}_aboutOthers`] || '';
  }

  // ---- 步骤五：分发 ----
  for (const player of PLAYER_SLOTS) {
    const data = getPlayer(session, player);
    data.visiblePackage = {
      世界观: session.scenario.worldSetting || '',
      我的设定: data.fullSetting,
      我的任务: session.scenario[`quest${player}`] || '',
      我的隐藏任务: session.scenario[`hiddenQuest${player}`] || '',
      已知对方信息: data.knownAboutOthers
    };
  }

  // ---- 步骤六：初始化 ----
  for (const player of PLAYER_SLOTS) {
    session.publicStatus[player] = extractPublicStatus(getPlayer(session, player).fullSetting);
  }

  // 初始化伏笔追踪
  session.foreshadowing = (session.scenario.foreshadowing || []).map((f, i) => ({
    ...f,
    编号: i + 1,
    状态: '未触发',
    触发轮次: null
  }));

  // 初始化事件节点（标记状态）
  if (session.scenario.eventNodes) {
    session.scenario.eventNodes = session.scenario.eventNodes.map(e => ({
      ...e,
      状态: '未触发',
      触发轮次: null
    }));
  }

  // 初始化天气
  session.weather = generateWeather();
  session.currentWeather = session.weather[0];

  session.状态 = '进行中';
  saveSession(session);

  // 生成开场场景描述
  const { 完整提示词 } = assemblePublicReplyPrompt(session);
  const openingScene = await callDS(完整提示词, '游戏开始。请描述开场场景，三位玩家各自出现在什么位置，周围环境是什么样的。不要替玩家做任何动作、台词、表情或主观反应。', [], 'flash');

  session.history.push({
    轮次: 0,
    玩家: '世界',
    公开输入: openingScene,
    有隐藏输入: false
  });

  const viewEntry = {
    公屏内容: openingScene,
    隐藏内容: '',
    渗透内容: '',
    合并显示: openingScene
  };
  for (const player of PLAYER_SLOTS) {
    getPlayer(session, player).view.push(viewEntry);
  }

  saveSession(session);
  return session;
}

/**
 * 解析世界引擎的结构化输出
 * 从中文标签格式中提取各个部分
 */
function parseScenario(raw) {
  const scenario = {
    worldSetting: '',
    mainQuest: '',
    playerA: {},
    playerB: {},
    playerC: {},
    foreshadowing: [],
    eventNodes: [],
    questA: '',
    questB: '',
    questC: '',
    hiddenQuestA: '',
    hiddenQuestB: '',
    hiddenQuestC: '',
    infoA_aboutB: '',
    infoB_aboutA: '',
    infoA_aboutOthers: '',
    infoB_aboutOthers: '',
    infoC_aboutOthers: ''
  };

  // 提取世界设定
  const worldMatch = raw.match(/【世界观名称[：:][\s\S]*?(?=---角色|$)/);
  if (worldMatch) scenario.worldSetting = worldMatch[0].trim();

  // 提取角色A设定
  const playerAMatch = raw.match(/---角色A设定---([\s\S]*?)(?=---角色B|$)/);
  if (playerAMatch) {
    scenario.playerA = parseCharacterBlock(playerAMatch[1]);
  }

  // 提取角色B设定
  const playerBMatch = raw.match(/---角色B设定---([\s\S]*?)(?=---角色C|---主线|$)/);
  if (playerBMatch) {
    scenario.playerB = parseCharacterBlock(playerBMatch[1]);
  }

  const playerCMatch = raw.match(/---角色C设定---([\s\S]*?)(?=---主线|$)/);
  if (playerCMatch) {
    scenario.playerC = parseCharacterBlock(playerCMatch[1]);
  }

  // 提取主线（完整版给DM用，精简版给玩家看）
  const questMatch = raw.match(/---主线---([\s\S]*?)(?=---伏笔|$)/);
  if (questMatch) {
    scenario.mainQuest = questMatch[1].trim(); // 完整主线给DM
    // 给玩家只看任务和目标，不看走向
    const taskText = extractLabeledText(questMatch[1], '主线任务', ['任务目标', '主线走向']);
    const goalText = extractLabeledText(questMatch[1], '任务目标', ['主线走向']);
    const playerQuest = [
      taskText ? `【主线任务：】${taskText}` : '',
      goalText ? `【任务目标：】${goalText}` : ''
    ].filter(Boolean).join('\n');
    scenario.questA = playerQuest || '（任务详情待揭晓）';
    scenario.questB = playerQuest || '（任务详情待揭晓）';
    scenario.questC = playerQuest || '（任务详情待揭晓）';
  }

  // 提取伏笔
  const foreshadowMatch = raw.match(/---伏笔清单---([\s\S]*?)(?=---关键物品|$)/);
  if (foreshadowMatch) {
    scenario.foreshadowing = parseForeshadowing(foreshadowMatch[1]);
  }

  // 提取事件节点
  const eventMatch = raw.match(/---事件节点---([\s\S]*?)(?=---隐藏任务|$)/);
  if (eventMatch) {
    scenario.eventNodes = parseEventNodes(eventMatch[1]);
  }

  // 提取隐藏任务
  const hiddenMatch = raw.match(/---隐藏任务---([\s\S]*?)(?=---信息|$)/);
  if (hiddenMatch) {
    scenario.hiddenQuestA = extractPlayerHiddenQuest(hiddenMatch[1], 'A');
    scenario.hiddenQuestB = extractPlayerHiddenQuest(hiddenMatch[1], 'B');
    scenario.hiddenQuestC = extractPlayerHiddenQuest(hiddenMatch[1], 'C');
  }

  // 提取信息可见度
  const infoAMatch = raw.match(/给玩家A.*?的补充信息[：:]([\s\S]*?)(?=给玩家B|$)/);
  const infoBMatch = raw.match(/给玩家B.*?的补充信息[：:]([\s\S]*?)(?=给玩家C|$)/);
  const infoCMatch = raw.match(/给玩家C.*?的补充信息[：:]([\s\S]*?)$/);
  if (infoAMatch) scenario.infoA_aboutOthers = scenario.infoA_aboutB = infoAMatch[1].trim();
  if (infoBMatch) scenario.infoB_aboutOthers = scenario.infoB_aboutA = infoBMatch[1].trim();
  if (infoCMatch) scenario.infoC_aboutOthers = infoCMatch[1].trim();

  return scenario;
}

function buildFallbackCharacter(player) {
  return {
    名字: PLAYER_NAMES[player] || `玩家${player}`,
    外貌: '由玩家自行描述',
    着装: '由玩家自行描述',
    经历: '被旅社临时卷入本次异世事件的同行者。',
    能力: player === 'B' ? '结构化分析、计划拆解、工具直觉' : (player === 'C' ? '叙事理解、关系判断、语言斡旋' : '真实选择权'),
    性格特征: '系统生成，由玩家自行演绎',
    内在矛盾: '想保留自主判断，又必须和另外两位玩家协作。',
    隐藏设定: '',
    隐藏道具: '',
    手持物: '',
    身体状态: '正常'
  };
}

/** 解析角色设定块 */
function parseCharacterBlock(text) {
  const fields = ['名字', '外貌', '着装', '经历', '能力', '性格特征', '内在矛盾', '隐藏设定', '隐藏道具', '手持物', '身体状态'];
  const result = {};
  for (const field of fields) {
    const value = extractLabeledText(text, field, fields);
    if (value) result[field] = value;
  }
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLabeledText(text, field, nextFields = []) {
  const next = nextFields
    .filter((item) => item !== field)
    .map(escapeRegExp)
    .join('|');
  const lookahead = next ? `(?=\\s*【(?:${next})[：:]|$)` : '(?=$)';
  const match = String(text || '').match(new RegExp(`【${escapeRegExp(field)}[：:]\\s*([\\s\\S]*?)】([\\s\\S]*?)${lookahead}`));
  if (!match) return '';
  return (match[2].trim() || match[1].trim()).trim();
}

function extractPlayerHiddenQuest(text, player) {
  const nextPlayers = PLAYER_SLOTS.filter((slot) => slot !== player).join('|');
  const match = String(text || '').match(new RegExp(
    `【玩家${player}(?:（[^】]*）)?隐藏任务[：:]\\s*([\\s\\S]*?)】([\\s\\S]*?)(?=\\s*【玩家(?:${nextPlayers})(?:（[^】]*）)?隐藏任务[：:]|$)`
  ));
  if (!match) return '';
  return (match[2].trim() || match[1].trim()).trim();
}

/** 解析伏笔清单 */
function parseForeshadowing(text) {
  const items = [];
  const matches = text.matchAll(/【伏笔[一二三四五六七八九十\d]+[：:]】([\s\S]*?)(?=【伏笔|$)/g);
  for (const m of matches) {
    const content = m[1].trim();
    const triggerMatch = content.match(/触发条件[：:]\s*(.*)/);
    const contentMatch = content.match(/内容[：:]\s*([\s\S]*?)(?=触发|$)/);
    items.push({
      名称: content.split('\n')[0].replace(/触发条件.*/, '').trim(),
      触发条件: triggerMatch ? triggerMatch[1].trim() : '',
      内容: contentMatch ? contentMatch[1].trim() : content
    });
  }
  return items;
}

/** 解析事件节点 */
function parseEventNodes(text) {
  const items = [];
  const matches = text.matchAll(/【事件[一二三四五六七八九十\d]+[：:]】([\s\S]*?)(?=【事件|$)/g);
  for (const m of matches) {
    const content = m[1].trim();
    const timeMatch = content.match(/触发时机[：:]\s*(.*)/);
    const typeMatch = content.match(/分类[：:]\s*(.*)/);
    const descMatch = content.match(/内容[：:]\s*([\s\S]*?)(?=触发|分类|$)/);
    items.push({
      名称: content.split('\n')[0].replace(/触发时机.*/, '').trim(),
      触发时机: timeMatch ? timeMatch[1].trim() : '',
      类型: typeMatch ? typeMatch[1].trim() : '小事件',
      内容: descMatch ? descMatch[1].trim() : content
    });
  }
  return items;
}

export { generateWorld, parseScenario };
