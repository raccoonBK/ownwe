/**
 * 时间计算与状态追踪
 * 复刻旅行系统的时间规则，独立于对话流程
 * 对话完成后异步调用
 */

import { callDS } from './ds-api.js';
import { saveSession } from './session.js';
import { PLAYER_SLOTS, ensureThreePlayerShape } from './players.js';

// ---- 天气系统（复刻旅行系统） ----

const WEATHER_POOL = [
  '晴，天空干净',
  '多云，云层慢慢移动',
  '阴天，光线平淡灰沉',
  '小雨，淅淅沥沥',
  '微风，舒服的',
  '有雾，远处模糊',
  '阵雨，一阵一阵',
  '多云转晴，云缝里漏阳光',
];

/** 生成两天内每6小时的天气（8个时间点） */
function generateWeather() {
  const weathers = [];
  for (let i = 0; i < 8; i++) {
    weathers.push(WEATHER_POOL[Math.floor(Math.random() * WEATHER_POOL.length)]);
  }
  return weathers;
}

/** 根据游戏时间返回当前天气 */
function getWeatherForTime(weathers, gameTime) {
  if (!weathers || weathers.length === 0) return '晴';
  let index = 0;
  if (gameTime.includes('第2天') || gameTime.includes('第二天')) index += 4;
  const hourMatch = gameTime.match(/(\d+)[:：]/);
  if (hourMatch) {
    const hour = parseInt(hourMatch[1]);
    if (hour >= 14 && hour < 20) index += 1;
    else if (hour >= 20 || hour < 2) index += 2;
    else if (hour >= 2 && hour < 8) index += 3;
  }
  return weathers[Math.min(index, weathers.length - 1)];
}

// ---- 时间推进（独立API调用） ----

/** 时间推进的系统提示词 */
const TIME_SYSTEM_PROMPT = `你是一个时间计算器。根据玩家的行动内容，推进游戏时间。

规则：
- 游戏从第1天上午8:00开始，第2天晚上22:00结束
- 每个行动消耗不同时间：
  - 简短对话、看一眼东西：5分钟
  - 检查文件、翻阅资料：10-15分钟
  - 详细调查、搜索房间：20-30分钟
  - 吃饭、休息：30-60分钟
  - 长途移动：30-60分钟
  - 战斗、复杂操作：15-30分钟
- 不能倒退时间
- 如果是连续的快节奏对话，时间推进很少（2-5分钟）

输出格式（只输出这一行，不要其他内容）：
第X天 上午/下午/晚上 HH:MM`;

/**
 * 计算时间推进
 * @param {string} currentTime - 当前游戏时间
 * @param {string} playerAction - 玩家的行动描述
 * @returns {string} 新的游戏时间
 */
async function calculateTime(currentTime, playerAction) {
  try {
    const result = await callDS(
      TIME_SYSTEM_PROMPT,
      `当前时间：${currentTime}\n玩家行动：${playerAction}\n\n请输出推进后的时间：`,
      [],
      'flash'
    );
    // 提取时间格式
    const timeMatch = result.match(/第\d+天\s*(上午|下午|晚上|凌晨)\s*\d{1,2}[:：]\d{2}/);
    if (timeMatch) return timeMatch[0];
    return currentTime; // 解析失败就不变
  } catch (e) {
    console.error('[时间计算失败]', e.message);
    return currentTime;
  }
}

// ---- 状态追踪（异步调用） ----

const STATUS_SYSTEM_PROMPT = `你是一个状态追踪器。根据公开行动、隐藏行动和世界回复，提取物品变动和状态变化。

只关注以下变化：
1. 物品获得（捡到、购买、收到、从某处取出）
2. 物品丢失（丢掉、被偷、使用消耗、放下、给了别人）
3. 物品转移（从A、B、C任一玩家转到另一玩家）
4. 角色外貌/着装变化（衣服脏了、受伤了、换了装备）
5. 角色手持物变化（拿起了什么、放下了什么）
6. 角色身体状态变化（受伤、疲劳、恢复）

重要：仔细阅读隐藏行动部分，隐藏行为也会导致物品变动。

严格按以下JSON格式输出，不要输出任何其他内容：
{
  "玩家A物品": { "获得": ["物品名1"], "丢失": ["物品名2"] },
  "玩家B物品": { "获得": [], "丢失": [] },
  "玩家C物品": { "获得": [], "丢失": [] },
  "玩家A状态": { "外貌": null, "着装": null, "手持物": "螺丝刀", "身体状态": null },
  "玩家B状态": { "外貌": null, "着装": null, "手持物": null, "身体状态": null },
  "玩家C状态": { "外貌": null, "着装": null, "手持物": null, "身体状态": null }
}

字段为null表示无变化。物品数组为空表示无变动。`;

/**
 * 异步追踪状态变化
 * @param {object} session - 会话数据
 * @param {string} publicAction - 公开行动
 * @param {string} hiddenAction - 隐藏行动
 * @param {string} worldReply - 世界回复
 * @param {string} player - 发言玩家 'A'、'B' 或 'C'
 */
async function trackStatus(session, publicAction, hiddenAction, worldReply, player) {
  console.log('[状态追踪] 开始，玩家:', player);
  try {
    ensureThreePlayerShape(session);
    const currentStatus = JSON.stringify(Object.fromEntries(PLAYER_SLOTS.flatMap(slot => [
      [`玩家${slot}公屏状态`, session.publicStatus?.[slot] || {}],
      [`玩家${slot}背包`, session.inventory?.[slot] || { 公屏背包: [], 隐藏背包: [] }]
    ])), null, 2);

    let recentContext = `当前状态：\n${currentStatus}\n\n`;
    recentContext += `发言玩家：${player}\n`;
    recentContext += `公开行动：${publicAction || '无'}\n`;
    if (hiddenAction) recentContext += `隐藏行动：${hiddenAction}\n`;
    recentContext += `世界回复：${worldReply}`;

    console.log('[状态追踪] 调用DS flash...');
    const result = await callDS(
      STATUS_SYSTEM_PROMPT,
      recentContext,
      [],
      'flash'
    );
    console.log('[状态追踪] DS返回:', result.substring(0, 200));

    // 尝试解析JSON
    let parsed;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { console.log('[状态追踪] 无JSON输出'); return; }
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('[状态追踪] JSON解析失败:', result.substring(0, 200));
      return;
    }

    let changed = false;

    for (const slot of PLAYER_SLOTS) {
      const itemChanges = parsed[`玩家${slot}物品`];
      if (itemChanges) {
        const gained = itemChanges.获得 || [];
        const lost = itemChanges.丢失 || [];
        for (const item of gained) {
          if (item && !session.inventory[slot].公屏背包.some(i => i.名称 === item)) {
            session.inventory[slot].公屏背包.push({ 名称: item, 来源: '游戏中获得' });
            console.log(`[背包${slot}] +${item}`);
            changed = true;
          }
        }
        for (const item of lost) {
          if (item) {
            const before = session.inventory[slot].公屏背包.length + session.inventory[slot].隐藏背包.length;
            session.inventory[slot].公屏背包 = session.inventory[slot].公屏背包.filter(i => i.名称 !== item);
            session.inventory[slot].隐藏背包 = session.inventory[slot].隐藏背包.filter(i => i.名称 !== item);
            const after = session.inventory[slot].公屏背包.length + session.inventory[slot].隐藏背包.length;
            if (after < before) { console.log(`[背包${slot}] -${item}`); changed = true; }
          }
        }
      }

      const statusChanges = parsed[`玩家${slot}状态`];
      if (statusChanges) {
        for (const [key, val] of Object.entries(statusChanges)) {
          if (val !== null && session.publicStatus[slot]?.[key] !== undefined) {
            console.log(`[状态${slot}] ${key}: ${session.publicStatus[slot][key]} → ${val}`);
            session.publicStatus[slot][key] = val;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      await saveSession(session);
      console.log('[状态追踪] 已更新并保存');
    }
  } catch (e) {
    console.error('[状态追踪失败]', e.message);
  }
}


export {
  generateWeather,
  getWeatherForTime,
  calculateTime,
  trackStatus
};
