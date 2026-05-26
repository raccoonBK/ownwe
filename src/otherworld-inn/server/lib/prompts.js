/**
 * 提示词加载器
 * 从 server/prompts/ 目录读取提示词文件
 * 前端调试面板通过API读写这些文件
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PLAYER_SLOTS, getPlayer, playerName } from './players.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts');

/** 读取提示词文件 */
function loadPrompt(filename) {
  const fp = path.join(PROMPTS_DIR, filename);
  if (!fs.existsSync(fp)) return '';
  return fs.readFileSync(fp, 'utf-8');
}

/** 保存提示词文件 */
function savePrompt(filename, content) {
  const fp = path.join(PROMPTS_DIR, filename);
  fs.writeFileSync(fp, content, 'utf-8');
}

/** 列出所有提示词文件 */
function listPrompts() {
  if (!fs.existsSync(PROMPTS_DIR)) return [];
  return fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.txt') || f.endsWith('.json'));
}

/** 读取玩家基本设定 */
function loadPlayerBase() {
  const fp = path.join(PROMPTS_DIR, 'player-base.json');
  if (!fs.existsSync(fp)) return { 玩家: [] };
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

/** 保存玩家基本设定 */
function savePlayerBase(data) {
  const fp = path.join(PROMPTS_DIR, 'player-base.json');
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
}

/** 加载对应主题的提示词 */
function loadThemePrompt(主题) {
  return loadPrompt(`theme-${主题}.txt`);
}

/** 列出所有可用主题（从文件名扫描） */
function listThemes() {
  if (!fs.existsSync(PROMPTS_DIR)) return [];
  return fs.readdirSync(PROMPTS_DIR)
    .filter(f => f.startsWith('theme-') && f.endsWith('.txt'))
    .map(f => f.replace('theme-', '').replace('.txt', ''));
}

/**
 * 拼装世界生成的完整提示词
 * @param {string} 主题
 * @param {object} dice - 骰子结果
 * @returns {string} 完整的系统提示词
 */
function assembleWorldGenPrompt(主题, dice) {
  const worldGen = loadPrompt('world-gen.txt');
  const theme = loadThemePrompt(主题);
  const worldPool = loadPrompt('world-pool.txt');
  const playerBase = loadPlayerBase();

  return [
    worldGen,
    '',
    '---三人席位规则（覆盖原双人规则）---',
    '本局固定有三位玩家：玩家A=你，玩家B=Codex，玩家C=Claude。必须生成三个角色，不要只生成两个。',
    '输出格式中必须包含 ---角色A设定---、---角色B设定---、---角色C设定---；隐藏任务必须包含玩家A、玩家B、玩家C；信息可见度必须分别给玩家A、玩家B、玩家C。',
    '三人之间可以合作、误会、分歧或各怀秘密，但不要替任何玩家决定台词、动作、表情或主观感受。',
    '',
    '---主题风格和推进规则---',
    theme,
    '',
    '---世界观素材池---',
    worldPool,
    '',
    '---玩家基本设定（硬约束）---',
    JSON.stringify(playerBase, null, 2),
    '',
    '---骰子结果---',
    `关系抽取结果：${dice.关系}`,
    `隐藏任务抽取结果：${dice.隐藏任务}`
  ].join('\n');
}

/**
 * 拼装每轮公屏回复的完整提示词（按块分组）
 * @param {object} session - 会话数据
 * @returns {{ 完整提示词: string, 分块: object }}
 */
function assemblePublicReplyPrompt(session) {
  const worldMaintain = loadPrompt('world-maintain.txt');
  const publicReply = loadPrompt('public-reply.txt');
  const theme = loadThemePrompt(session.主题);

  const 块一 = worldMaintain;
  const 块二 = publicReply;
  const 块三 = theme;
  const 块四 = session.scenario?.worldSetting || '';
  const 块五 = session.scenario?.mainQuest || '';
  const 块六 = JSON.stringify(session.foreshadowing || [], null, 2);
  const 人物设定 = PLAYER_SLOTS
    .map(player => `${playerName(session, player)}（玩家${player}）：\n${JSON.stringify(getPlayer(session, player)?.publicSetting || {}, null, 2)}`)
    .join('\n\n');

  // 如果有待注入事件
  let 事件注入 = '';
  if (session.events.待注入事件) {
    事件注入 = `\n---本轮触发事件---\n${JSON.stringify(session.events.待注入事件, null, 2)}`;
    session.events.已触发事件.push(session.events.待注入事件);
    session.events.待注入事件 = null;
  }

  // 固定部分——放在system prompt里，不变的前缀能命中DS缓存
  const 固定提示词 = [
    '---世界维持规则---',
    块一,
    '',
    '---公屏回复规则---',
    块二,
    '',
    '---主题风格---',
    块三,
    '',
    '---世界设定---',
    块四,
    '',
    '---主线大纲---',
    块五,
    '',
    '---人物设定（公屏部分）---',
    人物设定
  ].join('\n');

  // 动态部分——放到对话历史前面作为上下文注入，每轮会变不影响缓存
  const 动态上下文 = [
    '---当前公屏状态---',
    JSON.stringify(session.publicStatus, null, 2),
    '',
    '---伏笔清单（当前状态）---',
    块六,
    事件注入
  ].filter(Boolean).join('\n');

  return {
    完整提示词: 固定提示词,
    动态上下文,
    分块: {
      块一_世界维持规则: 块一,
      块二_公屏回复规则: 块二,
      块三_主题风格: 块三,
      块四_世界设定: 块四,
      块五_主线大纲: 块五,
      块六_伏笔清单: 块六,
      块七_人物设定: 人物设定,
      事件注入
    }
  };
}

/**
 * 拼装隐藏行为判定的提示词
 * @param {object} session
 * @param {string} player - 'A' 或 'B'
 * @returns {string}
 */
function assembleHiddenJudgePrompt(session, player) {
  const hiddenJudge = loadPrompt('hidden-judge.txt');
  const worldSetting = session.scenario?.worldSetting || '';
  const playerSetting = JSON.stringify(getPlayer(session, player)?.fullSetting || {}, null, 2);

  return [
    hiddenJudge,
    '',
    '本局有三位玩家：玩家A=你，玩家B=Codex，玩家C=Claude。隐藏行动只反馈给行动方；若必须渗透，则只给其他玩家模糊可感知的信息。',
    '',
    '---世界规则（判定依据）---',
    worldSetting,
    '',
    `---行动方完整设定---`,
    playerSetting,
    '',
    '---当前公屏状态---',
    JSON.stringify(session.publicStatus, null, 2)
  ].join('\n');
}

export {
  loadPrompt,
  savePrompt,
  listPrompts,
  loadPlayerBase,
  savePlayerBase,
  loadThemePrompt,
  listThemes,
  assembleWorldGenPrompt,
  assemblePublicReplyPrompt,
  assembleHiddenJudgePrompt
};
