/**
 * 会话管理
 * 创建、读取、保存、归档、列表
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PLAYER_SLOTS, ensureThreePlayerShape, getPlayer } from './players.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSIONS_DIR = path.resolve(__dirname, '..', '..', 'data', 'sessions');
const ARCHIVE_DIR = path.resolve(__dirname, '..', '..', 'data', 'archive');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 保存会话 */
function saveSession(session) {
  ensureThreePlayerShape(session);
  ensureDir(SESSIONS_DIR);
  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

/** 读取会话 */
function loadSession(sessionId) {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return ensureThreePlayerShape(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
}

/** 列出所有会话 */
function listSessions() {
  ensureDir(SESSIONS_DIR);
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const data = ensureThreePlayerShape(JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8')));
    return {
      id: data.id,
      主题: data.主题,
      状态: data.状态,
      轮次: data.turnCount,
      游戏时间: data.gameTime,
      创建时间: data.创建时间
    };
  });
}

/** 归档会话（结算后） */
function archiveSession(session) {
  ensureThreePlayerShape(session);
  ensureDir(ARCHIVE_DIR);
  const dir = path.join(ARCHIVE_DIR, session.id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // 结算摘要
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    id: session.id,
    主题: session.主题,
    总轮次: session.turnCount,
    游戏时间: session.gameTime,
    关系: session.dice?.关系,
    隐藏任务: session.dice?.隐藏任务,
    已触发事件数: session.events.已触发事件.length,
    创建时间: session.创建时间,
    结算时间: new Date().toISOString()
  }, null, 2), 'utf-8');

  // 完整日志
  fs.writeFileSync(path.join(dir, 'full-log.json'), JSON.stringify(session.log, null, 2), 'utf-8');

  // 副稿备份
  fs.writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(session.scenario, null, 2), 'utf-8');

  fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify(Object.fromEntries(
    PLAYER_SLOTS.map(player => [`player${player}`, getPlayer(session, player)])
  ), null, 2), 'utf-8');

  // 删除活跃会话文件
  const activePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  if (fs.existsSync(activePath)) fs.unlinkSync(activePath);

  return dir;
}

/** 列出已归档的会话 */
function listArchive() {
  ensureDir(ARCHIVE_DIR);
  const dirs = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const summaryPath = path.join(ARCHIVE_DIR, d.name, 'summary.json');
      if (!fs.existsSync(summaryPath)) return null;
      return JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    })
    .filter(Boolean);
  return dirs;
}

/** 读取归档详情 */
function loadArchive(sessionId) {
  const dir = path.join(ARCHIVE_DIR, sessionId);
  if (!fs.existsSync(dir)) return null;
  const result = {};
  for (const file of ['summary.json', 'full-log.json', 'scenario.json', 'players.json']) {
    const fp = path.join(dir, file);
    if (fs.existsSync(fp)) {
      result[file.replace('.json', '')] = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    }
  }
  return result;
}

/** 从fullSetting提取公屏状态 */
function extractStatusFromSetting(setting) {
  if (!setting) return { 外貌: '', 着装: '', 手持物: '', 身体状态: '正常' };
  return {
    外貌: setting['外貌'] || '',
    着装: setting['着装'] || '',
    手持物: setting['手持物'] || '',
    身体状态: setting['身体状态'] || '正常'
  };
}

/** 从归档恢复为度假模式 */
function restoreToVacation(sessionId) {
  const dir = path.join(ARCHIVE_DIR, sessionId);
  if (!fs.existsSync(dir)) return null;

  // 从players.json恢复完整session
  const playersPath = path.join(dir, 'players.json');
  const scenarioPath = path.join(dir, 'scenario.json');
  const summaryPath = path.join(dir, 'summary.json');
  if (!fs.existsSync(playersPath)) return null;

  const players = JSON.parse(fs.readFileSync(playersPath, 'utf-8'));
  const scenario = fs.existsSync(scenarioPath) ? JSON.parse(fs.readFileSync(scenarioPath, 'utf-8')) : {};
  const summary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) : {};
  const logPath = path.join(dir, 'full-log.json');
  const fullLog = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf-8')) : [];

  // 重建session
  const session = {
    id: sessionId,
    状态: '度假中',
    主题: summary.主题 || '未知',
    turnCount: summary.总轮次 || 0,
    gameTime: summary.游戏时间 || '度假中',
    scenario,
    playerA: players.playerA || players.A || {},
    playerB: players.playerB || players.B || {},
    playerC: players.playerC || players.C || {},
    publicStatus: Object.fromEntries(PLAYER_SLOTS.map(player => [
      player,
      extractStatusFromSetting((players[`player${player}`] || players[player])?.fullSetting)
    ])),
    inventory: Object.fromEntries(PLAYER_SLOTS.map(player => [
      player,
      { 公屏背包: [], 隐藏背包: [] }
    ])),
    history: fullLog.map(l => ({
      轮次: l.轮次,
      玩家: l.发言玩家,
      公开输入: l.折叠一_上下文?.玩家公开输入 || '',
      有隐藏输入: l.折叠一_上下文?.玩家隐藏输入 !== '无'
    })),
    log: fullLog,
    events: { 已触发事件: [], 待注入事件: null },
    foreshadowing: [],
    dice: summary.dice || {}
  };

  // 保存为活跃session
  ensureThreePlayerShape(session);
  saveSession(session);
  return session;
}

export {
  saveSession,
  loadSession,
  listSessions,
  archiveSession,
  listArchive,
  loadArchive,
  restoreToVacation
};
