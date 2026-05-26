const PLAYER_SLOTS = ['A', 'B', 'C'];

const PLAYER_NAMES = {
  A: '你',
  B: 'Codex',
  C: 'Claude'
};

function normalizePlayer(value) {
  const player = String(value || '').trim().toUpperCase();
  return PLAYER_SLOTS.includes(player) ? player : null;
}

function playerKey(player) {
  return `player${player}`;
}

function playerName(session, player) {
  return session?.[playerKey(player)]?.标识 || PLAYER_NAMES[player] || `玩家${player}`;
}

function getPlayer(session, player) {
  return session?.[playerKey(player)] || {};
}

function ensureThreePlayerShape(session) {
  for (const player of PLAYER_SLOTS) {
    const key = playerKey(player);
    session[key] ||= {
      标识: PLAYER_NAMES[player] || `玩家${player}`,
      fullSetting: null,
      publicSetting: null,
      visiblePackage: null,
      view: []
    };
    session[key].标识 ||= PLAYER_NAMES[player] || `玩家${player}`;
    session[key].view ||= [];
  }
  session.publicStatus ||= {};
  session.inventory ||= {};
  for (const player of PLAYER_SLOTS) {
    session.publicStatus[player] ||= null;
    session.inventory[player] ||= { 公屏背包: [], 隐藏背包: [] };
    session.inventory[player].公屏背包 ||= [];
    session.inventory[player].隐藏背包 ||= [];
  }
  return session;
}

export {
  PLAYER_SLOTS,
  PLAYER_NAMES,
  normalizePlayer,
  playerKey,
  playerName,
  getPlayer,
  ensureThreePlayerShape
};
