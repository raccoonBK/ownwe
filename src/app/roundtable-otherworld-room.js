const fs = require("fs");
const path = require("path");

const OTHERWORLD_ROOM_ID = "otherworld";
const OTHERWORLD_ROOM_TITLE = "异世旅社";
const OTHERWORLD_TOPIC_TITLE = "固定｜异世旅社";
const OTHERWORLD_SESSION_EVENT = "otherworld.session";
const OTHERWORLD_SESSION_DIR = path.resolve(__dirname, "..", "otherworld-inn", "data", "sessions");

const PLAYER_BY_SPEAKER = {
  user: "A",
  codex: "B",
  claude: "C",
};

const PLAYER_LABELS = {
  A: "你",
  B: "Codex",
  C: "Claude",
};

async function createOtherworldGame(theme) {
  const [{ createSession }, { saveSession, loadSession }, { generateWorld }] = await Promise.all([
    import("../otherworld-inn/server/lib/rp-engine.js"),
    import("../otherworld-inn/server/lib/session.js"),
    import("../otherworld-inn/server/lib/world-gen.js"),
  ]);
  const session = createSession(theme);
  saveSession(session);
  await generateWorld(session);
  return loadSession(session.id) || session;
}

async function processOtherworldPlayerTurn({ sessionId, player, publicInput, hiddenInput }) {
  const [{ loadSession, saveSession }, { processPlayerTurn }] = await Promise.all([
    import("../otherworld-inn/server/lib/session.js"),
    import("../otherworld-inn/server/lib/world-workflow.js"),
  ]);
  const session = loadSession(sessionId);
  if (!session) throw new Error("旅社 session 不存在: " + sessionId);
  const result = await processPlayerTurn(session, player, publicInput || "", hiddenInput || "");
  saveSession(session);
  return result.views?.[player] || result[`view${player}`] || null;
}

function isOtherworldRoomState(state = {}) {
  const container = state.container || {};
  return container.type === "fixed_room" && container.id === OTHERWORLD_ROOM_ID;
}

function getOtherworldSessionId(state = {}) {
  const events = Array.isArray(state.events) ? state.events : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === OTHERWORLD_SESSION_EVENT && event.payload?.sessionId) {
      return String(event.payload.sessionId);
    }
  }
  const messages = Array.isArray(state.messages) ? state.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = String(messages[index]?.text || "");
    const match = text.match(/(?:[?&]session=|session\s*[：:=]\s*)([A-Za-z0-9_-]+)/);
    if (match?.[1]) return match[1];
  }
  return "";
}

function parseOtherworldCommand(text) {
  const raw = String(text || "").trim();
  const startMatch = raw.match(/(?:开|開始|开始|新开|来|创建|生成)\s*(?:一局|一把|个)?\s*([^\s，。,.]*)?\s*(?:主题|局)?/u);
  const explicitTheme = raw.match(/(?:主题|风格)\s*[：:]\s*([^\s，。,.]+)/u);
  const knownTheme = raw.match(/(休闲|刺激|恐怖|搞怪|梦幻|风格化)/u);
  const startsGame = /开|開始|开始|新开|来一局|创建|生成/u.test(raw) && /局|主题|旅社|游戏|世界/u.test(raw);
  if (startsGame) {
    return {
      type: "start",
      theme: (explicitTheme?.[1] || knownTheme?.[1] || startMatch?.[1] || "梦幻").replace(/主题$/u, "") || "梦幻",
      raw,
    };
  }
  const action = parseOtherworldAction(raw);
  return { type: "action", ...action, raw };
}

function parseOtherworldAction(text) {
  const raw = String(text || "").trim();
  const hiddenLabel = String.raw`(?:\*{0,2}\s*(?:隐藏行动|隐藏|秘密|暗中|私下)\s*[：:]\s*\*{0,2})`;
  const publicLabel = String.raw`(?:\*{0,2}\s*(?:公开行动|公开|公屏)\s*[：:]\s*\*{0,2})`;
  const hiddenMatch = raw.match(new RegExp(`(?:^|\\n)\\s*${hiddenLabel}\\s*([\\s\\S]+)$`, "u"));
  const publicMatch = raw.match(new RegExp(`(?:^|\\n)\\s*${publicLabel}\\s*([\\s\\S]*?)(?=\\n\\s*${hiddenLabel}|$)`, "u"));
  const hiddenInput = hiddenMatch ? hiddenMatch[1].trim() : "";
  let publicInput = publicMatch ? publicMatch[1].trim() : raw;
  if (hiddenMatch && !publicMatch) {
    publicInput = raw.slice(0, hiddenMatch.index).trim();
  }
  publicInput = publicInput
    .replace(new RegExp(`^\\s*${publicLabel}\\s*`, "u"), "")
    .replace(new RegExp(`\\n\\s*${hiddenLabel}[\\s\\S]*$`, "u"), "")
    .trim();
  return { publicInput, hiddenInput };
}

function formatOtherworldDisplayAction({ publicInput, hiddenInput }, fallback = "") {
  const publicText = String(publicInput || "").trim();
  const hasHidden = Boolean(String(hiddenInput || "").trim());
  if (publicText && hasHidden) return `${publicText}\n\n（另有隐藏行动）`;
  if (publicText) return publicText;
  if (hasHidden) return "（隐藏行动）";
  return String(fallback || "").trim();
}

function formatOtherworldWorldMessage(view) {
  if (!view) return "";
  return String(view.公屏内容 || "").trim();
}

function formatOtherworldOpeningMessage(session) {
  const opening = session?.history?.find?.((item) => item?.玩家 === "世界")?.公开输入
    || session?.playerA?.view?.[0]?.公屏内容
    || "";
  return opening || `旅社世界已经生成。Session: ${session?.id || ""}`;
}

function buildOtherworldRuntimeContext(state = {}, speaker = "") {
  if (!isOtherworldRoomState(state)) return "";
  const player = PLAYER_BY_SPEAKER[speaker];
  if (!player) return "";
  const sessionId = getOtherworldSessionId(state);
  if (!sessionId) {
    return [
      "You are in the fixed room \"异世旅社\", but no game has started yet.",
      "If the user asks to start a game, discuss the theme briefly. Do not invent a character card yet.",
    ].join("\n");
  }
  const session = readOtherworldSessionSync(sessionId);
  if (!session) return `You are in 异世旅社. The game session ${sessionId} could not be read.`;
  const playerData = session[`player${player}`] || {};
  const view = buildOtherworldViewForPrompt(session, player);
  return [
    `You are playing in the fixed room "异世旅社" as player${player} (${PLAYER_LABELS[player]}).`,
    "Stay in character for this room only. Outside this room, drop the roleplay mask.",
    "Reply with your game action only. Use this format:",
    "公开：what everyone can see",
    "隐藏：optional private action, omit this line if none",
    "Never reveal your hidden task or private feedback in the public line.",
    "",
    `Session: ${session.id}`,
    `Theme: ${session.主题 || ""}`,
    `State: ${session.状态 || ""} / Turn ${session.turnCount || 0} / ${session.gameTime || ""}`,
    "",
    "--- Your private character package ---",
    JSON.stringify(playerData.visiblePackage || {}, null, 2).slice(0, 5000),
    "",
    "--- Your current public status and inventory ---",
    JSON.stringify({
      publicStatus: session.publicStatus?.[player] || {},
      inventory: session.inventory?.[player] || {},
    }, null, 2).slice(0, 2500),
    "",
    "--- Other players public info ---",
    JSON.stringify(view.others, null, 2).slice(0, 2500),
    "",
    "--- Recent game view visible to you ---",
    view.recentViewText.slice(-5000),
  ].join("\n");
}

function readOtherworldSessionSync(sessionId) {
  const safeId = String(sessionId || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeId) return null;
  const filePath = path.join(OTHERWORLD_SESSION_DIR, `${safeId}.json`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function buildOtherworldViewForPrompt(session, player) {
  const others = ["A", "B", "C"]
    .filter((slot) => slot !== player)
    .map((slot) => ({
      player: slot,
      name: session[`player${slot}`]?.标识 || PLAYER_LABELS[slot],
      publicStatus: session.publicStatus?.[slot] || {},
      publicInventory: session.inventory?.[slot]?.公屏背包 || [],
    }));
  const recentViewText = (session[`player${player}`]?.view || [])
    .slice(-6)
    .map((item) => item?.合并显示 || item?.公屏内容 || "")
    .filter(Boolean)
    .join("\n\n");
  return { others, recentViewText };
}

module.exports = {
  OTHERWORLD_ROOM_ID,
  OTHERWORLD_ROOM_TITLE,
  OTHERWORLD_TOPIC_TITLE,
  OTHERWORLD_SESSION_EVENT,
  PLAYER_BY_SPEAKER,
  buildOtherworldRuntimeContext,
  createOtherworldGame,
  formatOtherworldDisplayAction,
  formatOtherworldOpeningMessage,
  formatOtherworldWorldMessage,
  getOtherworldSessionId,
  isOtherworldRoomState,
  parseOtherworldAction,
  parseOtherworldCommand,
  processOtherworldPlayerTurn,
};
