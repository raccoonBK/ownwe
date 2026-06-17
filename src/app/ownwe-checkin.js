// OwnWe 主动 check-in (§5.4 witnessing payoff).
//
// A character occasionally reaches out first when you've been quiet for a while.
// Design constraints from §6.3 (anti-needy / anti-reverse-PUA):
//   - SPARSE: high threshold, low probability — rare = real.
//   - NOT guilt-trippy: warm, light, never "你为什么不理我".
//   - Rate-limited: at most one undelivered ping per character, min spacing.
//   - Delivered lazily when the user next opens the chat (no push needed).

const { getDb } = require("../db/connection");
const { callDeepSeek } = require("./roundtable-deepseek");

const MIN_GAP_H = Number(process.env.OWNWE_CHECKIN_MIN_GAP_H || 3);     // quiet for >3h
const MAX_GAP_H = Number(process.env.OWNWE_CHECKIN_MAX_GAP_H || 24 * 30); // stop pinging the abandoned
const MIN_SPACING_H = Number(process.env.OWNWE_CHECKIN_SPACING_H || 8);  // ≥8h between pings per char
const BASE_PROB = Number(process.env.OWNWE_CHECKIN_PROB || 0.5);        // sparse gate

function hoursSince(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 3_600_000;
}

function partOfDay() {
  const h = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" })).getHours();
  if (h >= 5 && h < 11) return "早上";
  if (h >= 11 && h < 13) return "中午";
  if (h >= 13 && h < 18) return "下午";
  if (h >= 18 && h < 23) return "晚上";
  return "深夜";
}

// Generate proactive pings for characters who've been left quiet. Best-effort.
async function maybeGenerateCheckins(dbPath, { force = false } = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return 0;
  let rows = [];
  try {
    // only characters the user has actually talked to (have a relationship row)
    rows = getDb(dbPath).prepare(`
      SELECT c.id, c.name, c.persona_prompt, r.attachment, r.tension, r.last_interaction_at
      FROM ownwe_characters c
      JOIN char_relationship_state r ON r.char_id = c.id
    `).all();
  } catch {
    return 0;
  }

  let made = 0;
  for (const ch of rows) {
    try {
      const gapH = hoursSince(ch.last_interaction_at);
      if (!force) {
        if (gapH < MIN_GAP_H || gapH > MAX_GAP_H) continue;
        // already a pending ping?
        const pending = getDb(dbPath).prepare(
          "SELECT 1 FROM ownwe_pending_checkins WHERE char_id = ? AND delivered = 0"
        ).get(ch.id);
        if (pending) continue;
        // min spacing since last ping (delivered or not)
        const last = getDb(dbPath).prepare(
          "SELECT created_at FROM ownwe_pending_checkins WHERE char_id = ? ORDER BY id DESC LIMIT 1"
        ).get(ch.id);
        if (last && hoursSince(last.created_at) < MIN_SPACING_H) continue;
        // sparse gate — more attached → a bit more likely, but still rare
        const prob = Math.min(0.85, BASE_PROB * (0.6 + (ch.attachment || 0.5)));
        if (Math.random() > prob) continue;
      }

      const text = await composeCheckin(apiKey, ch, gapH);
      if (text) {
        getDb(dbPath).prepare(
          "INSERT INTO ownwe_pending_checkins (char_id, text) VALUES (?, ?)"
        ).run(ch.id, text);
        made += 1;
      }
    } catch {
      // best effort per character
    }
  }
  return made;
}

async function composeCheckin(apiKey, ch, gapH) {
  const persona = (ch.persona_prompt || "").slice(0, 1200);
  const gapDesc = gapH > 24 * 3 ? "好些天" : gapH > 24 ? "一两天" : "几个小时";
  const messages = [
    {
      role: "system",
      content: [
        persona ? `你的人设：\n${persona}` : `你是「${ch.name}」。`,
        `现在是${partOfDay()}。你和这个人${gapDesc}没说话了，你忽然想起TA，想主动发条消息。`,
        "用你自己的语气，自然、短、像真人随手发的。",
        "绝不要质问、卖惨、或让对方愧疚（不要“你怎么都不理我”这种）。就是轻轻地起个头。",
        "不要解释你为什么发、不要提“系统/记忆/时间”。直接说那句话本身，一两句即可。",
      ].join("\n"),
    },
    { role: "user", content: "（主动开口）" },
  ];
  const raw = await callDeepSeek({ messages, apiKey });
  return (raw || "").trim().slice(0, 300);
}

// Pull undelivered pings for a character (called when the user opens the chat).
function takePendingCheckins(dbPath, charId) {
  try {
    const db = getDb(dbPath);
    const rows = db.prepare(
      "SELECT id, text, created_at FROM ownwe_pending_checkins WHERE char_id = ? AND delivered = 0 ORDER BY id ASC"
    ).all(charId);
    if (rows.length) {
      db.prepare(
        "UPDATE ownwe_pending_checkins SET delivered = 1 WHERE char_id = ? AND delivered = 0"
      ).run(charId);
    }
    return rows;
  } catch {
    return [];
  }
}

function unreadCounts(dbPath) {
  try {
    const rows = getDb(dbPath).prepare(
      "SELECT char_id, COUNT(*) AS n FROM ownwe_pending_checkins WHERE delivered = 0 GROUP BY char_id"
    ).all();
    return Object.fromEntries(rows.map((r) => [r.char_id, r.n]));
  } catch {
    return {};
  }
}

module.exports = { maybeGenerateCheckins, takePendingCheckins, unreadCounts };
