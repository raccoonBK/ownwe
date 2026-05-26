/**
 * 信息可见度过滤
 * 给三位玩家看的内容怎么拆
 */

/**
 * 从完整角色设定中提取公屏可见部分
 * @param {object} fullSetting - 完整角色设定
 * @returns {object} 公屏设定（去掉隐藏部分）
 */
function extractPublicSetting(fullSetting) {
  if (!fullSetting) return {};
  const pub = { ...fullSetting };
  delete pub['隐藏设定'];
  delete pub['隐藏道具'];
  delete pub['隐藏任务'];
  delete pub['隐藏任务目标'];
  return pub;
}

/**
 * 提取公屏状态（外显信息）
 * @param {object} fullSetting
 * @returns {object}
 */
function extractPublicStatus(fullSetting) {
  return {
    外貌: fullSetting?.['外貌'] || '',
    着装: fullSetting?.['着装'] || '',
    手持物: fullSetting?.['手持物'] || '',
    身体状态: fullSetting?.['身体状态'] || '正常'
  };
}

function assembleViewForPlayer(publicReply, hiddenByPlayer, player) {
  let 公屏内容 = publicReply;
  let 隐藏内容 = '';
  let 渗透内容 = '';

  const ownHidden = hiddenByPlayer?.[player];
  if (ownHidden?.给行动方的回复) {
    隐藏内容 = ownHidden.给行动方的回复;
  }

  const leaked = Object.entries(hiddenByPlayer || {})
    .filter(([source, hidden]) => source !== player && hidden?.给对方渗透的信息 && hidden.给对方渗透的信息 !== '无')
    .map(([, hidden]) => hidden.给对方渗透的信息);
  if (leaked.length) {
    渗透内容 = leaked.join(' ');
    公屏内容 = `${公屏内容} ${渗透内容}`;
  }

  return {
    公屏内容,
    隐藏内容: 隐藏内容 ? `【隐藏】${隐藏内容}` : '',
    渗透内容,
    合并显示: [
      公屏内容,
      隐藏内容 ? `\n【隐藏】${隐藏内容}` : ''
    ].filter(Boolean).join('')
  };
}

const assembleViewForA = (publicReply, hiddenA, hiddenB, hiddenC = null) =>
  assembleViewForPlayer(publicReply, { A: hiddenA, B: hiddenB, C: hiddenC }, 'A');
const assembleViewForB = (publicReply, hiddenA, hiddenB, hiddenC = null) =>
  assembleViewForPlayer(publicReply, { A: hiddenA, B: hiddenB, C: hiddenC }, 'B');
const assembleViewForC = (publicReply, hiddenA, hiddenB, hiddenC = null) =>
  assembleViewForPlayer(publicReply, { A: hiddenA, B: hiddenB, C: hiddenC }, 'C');

export {
  extractPublicSetting,
  extractPublicStatus,
  assembleViewForPlayer,
  assembleViewForA,
  assembleViewForB,
  assembleViewForC
};
