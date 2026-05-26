/**
 * 角色扮演核心引擎
 * 骰子、轮次计数、事件触发、保底检查
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PLAYER_NAMES, PLAYER_SLOTS, playerKey } from './players.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXAMPLE_CONFIG_PATH = path.join(__dirname, '..', 'config.example.json');
const LOCAL_CONFIG_PATH = path.join(__dirname, '..', 'config.local.json');

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      deepMerge(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

function applyEnvConfig(config) {
  const commonKey = process.env.DEEPSEEK_API_KEY || '';
  if (config.api?.pro) {
    config.api.pro.key = process.env.DEEPSEEK_PRO_KEY || commonKey || config.api.pro.key;
    config.api.pro.model = process.env.DEEPSEEK_PRO_MODEL || config.api.pro.model;
    config.api.pro.baseUrl = process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_PRO_BASE_URL || config.api.pro.baseUrl;
  }
  if (config.api?.flash) {
    config.api.flash.key = process.env.DEEPSEEK_FLASH_KEY || commonKey || config.api.flash.key;
    config.api.flash.model = process.env.DEEPSEEK_FLASH_MODEL || config.api.flash.model;
    config.api.flash.baseUrl = process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_FLASH_BASE_URL || config.api.flash.baseUrl;
  }
  return config;
}

function loadConfig({ includeEnv = true } = {}) {
  const example = readJsonIfExists(EXAMPLE_CONFIG_PATH);
  if (!example) throw new Error('缺少 server/config.example.json');

  const config = deepMerge(example, readJsonIfExists(LOCAL_CONFIG_PATH));
  return includeEnv ? applyEnvConfig(config) : config;
}

function saveLocalConfig(config) {
  fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function makePublicConfig(config = loadConfig()) {
  const publicConfig = JSON.parse(JSON.stringify(config));
  for (const [tier, apiConfig] of Object.entries(publicConfig.api || {})) {
    apiConfig.keyConfigured = Boolean(config.api?.[tier]?.key);
    apiConfig.keyEnv = tier === 'pro' ? 'DEEPSEEK_PRO_KEY' : 'DEEPSEEK_FLASH_KEY';
    apiConfig.key = '';
  }
  return publicConfig;
}

// ---- 骰子 ----

/** 关系抽取：70%陌生人 / 20%合作 / 10%敌对 */
function rollRelation() {
  const config = loadConfig();
  const { 陌生人, 合作, 敌对 } = config.骰子.关系;
  const roll = Math.random() * 100;
  if (roll < 陌生人) return '陌生人';
  if (roll < 陌生人 + 合作) return '合作';
  return '敌对';
}

/** 隐藏任务抽取：20%单人 / 10%双方 / 70%无 */
function rollHiddenQuest() {
  const config = loadConfig();
  const { 单人概率, 双方概率 } = config.骰子.隐藏任务;
  const roll = Math.random() * 100;
  if (roll < 双方概率) return '多人';
  if (roll < 双方概率 + 单人概率) {
    const slot = PLAYER_SLOTS[Math.floor(Math.random() * PLAYER_SLOTS.length)];
    return `玩家${slot}`;
  }
  return '无';
}

/** 事件骰子：30%大事件 / 70%小事件 */
function rollEvent() {
  const config = loadConfig();
  const roll = Math.random() * 100;
  if (roll < config.骰子.事件.大事件概率) return '大事件';
  return '小事件';
}

// ---- 事件检查 ----

/**
 * 检查是否应该触发事件
 * @param {object} session - 会话数据
 * @returns {{ 应该触发: boolean, 事件类型: string|null, 原因: string }}
 */
function checkEvent(session) {
  const config = loadConfig();
  const { 掷骰间隔轮数, 大事件硬保底轮数, 小事件硬保底轮数 } = config.骰子.事件;
  const events = session.events;

  // 不到掷骰轮数，不掷
  if (session.turnCount % 掷骰间隔轮数 !== 0 || session.turnCount === 0) {
    // 但检查硬保底
    const 距上次大事件 = session.turnCount - events.上次大事件轮次;
    const 距上次小事件 = session.turnCount - events.上次小事件轮次;

    if (距上次大事件 >= 大事件硬保底轮数) {
      return { 应该触发: true, 事件类型: '大事件', 原因: '硬保底触发' };
    }
    if (距上次小事件 >= 小事件硬保底轮数) {
      return { 应该触发: true, 事件类型: '小事件', 原因: '硬保底触发' };
    }
    return { 应该触发: false, 事件类型: null, 原因: '未到掷骰轮数' };
  }

  // 到了掷骰轮数，掷骰子
  let 事件类型 = rollEvent();

  // 保底覆盖
  const 距上次大事件 = session.turnCount - events.上次大事件轮次;
  if (距上次大事件 >= 大事件硬保底轮数) {
    事件类型 = '大事件';
  }

  // 三次保底
  if (事件类型 === '小事件') {
    events.连续非大事件次数++;
    if (events.连续非大事件次数 >= 3) {
      事件类型 = '大事件';
    }
  }

  if (事件类型 === '大事件') {
    events.连续非大事件次数 = 0;
    events.上次大事件轮次 = session.turnCount;
  } else {
    events.上次小事件轮次 = session.turnCount;
  }

  return { 应该触发: true, 事件类型, 原因: '正常掷骰' };
}

/**
 * 从事件池中选取事件
 * @param {object} session - 会话数据
 * @param {string} 事件类型 - '大事件' 或 '小事件'
 * @returns {object|null} 选中的事件节点
 */
function pickEvent(session, 事件类型) {
  const pool = session.scenario.eventNodes.filter(
    e => e.类型 === 事件类型 && e.状态 === '未触发'
  );
  if (pool.length === 0) return null;
  const idx = Math.floor(Math.random() * pool.length);
  const picked = pool[idx];
  picked.状态 = '已触发';
  picked.触发轮次 = session.turnCount;
  return picked;
}

// ---- 开局骰子一次性掷完 ----

function rollAllStartDice() {
  return {
    关系: rollRelation(),
    隐藏任务: rollHiddenQuest(),
    掷骰时间: new Date().toISOString()
  };
}

// ---- 会话初始化 ----

function createSession(主题) {
  const id = `rp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const players = {};
  const publicStatus = {};
  const inventory = {};
  for (const player of PLAYER_SLOTS) {
    players[playerKey(player)] = {
      标识: PLAYER_NAMES[player],
      fullSetting: null,
      publicSetting: null,
      visiblePackage: null,
      view: []
    };
    publicStatus[player] = null;
    inventory[player] = { 公屏背包: [], 隐藏背包: [] };
  }
  return {
    id,
    主题,
    状态: '生成中',
    dice: null,
    scenario: null,
    ...players,
    publicStatus,
    inventory,
    foreshadowing: [],
    events: {
      上次大事件轮次: 0,
      上次小事件轮次: 0,
      连续非大事件次数: 0,
      已触发事件: [],
      待注入事件: null
    },
    history: [],
    turnCount: 0,
    gameTime: '第一天 上午 8:00',
    log: [],
    创建时间: new Date().toISOString()
  };
}

export {
  loadConfig,
  saveLocalConfig,
  makePublicConfig,
  rollRelation,
  rollHiddenQuest,
  rollEvent,
  rollAllStartDice,
  checkEvent,
  pickEvent,
  createSession
};
