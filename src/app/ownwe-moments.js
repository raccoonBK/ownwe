// OwnWe 朋友圈 (Moments) — feed of posts + likes + comments.
// Authors are either the user ('self') or a character.

const { getDb } = require("../db/connection");
const { callDeepSeek } = require("./roundtable-deepseek");
const { writeMemory } = require("./ownwe-context");

// 朋友圈也发生在手机屏幕上 — 评论里不该出现线下动作。
const MOMENT_CHANNEL_RULE =
  "这一切都在手机朋友圈里。不要写「走过去/坐到身边/递东西」这类线下动作，也不要写括号旁白。只发文字。";

// 朋友圈是所有角色共享可见的。一个角色（actor）在某条动态下评论后，把"看到的"
// 写进其他角色的记忆 —— 于是 A 能记得 "B 在我朋友圈下说过什么"（跨角色见证）。
function recordMomentObservation(dbPath, { momentText, actorId, actorName, commentText }) {
  if (!actorId || !commentText) return;
  let others = [];
  try {
    others = getDb(dbPath).prepare("SELECT id FROM ownwe_characters WHERE id != ?").all(actorId);
  } catch {
    return;
  }
  const content = `（朋友圈里看到的）在「${String(momentText || "").slice(0, 30)}」这条下面，${actorName}回了一句：「${String(commentText).slice(0, 50)}」`;
  for (const o of others) {
    try {
      writeMemory(dbPath, { charId: o.id, content, context: "moments", valence: 0.5, keywords: [] });
    } catch {
      // best effort
    }
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

function listMoments(dbPath, { limit = 50, excludeBlocked = true } = {}) {
  try {
    const db = getDb(dbPath);
    const moments = db.prepare(
      "SELECT * FROM ownwe_moments ORDER BY id DESC LIMIT ?"
    ).all(limit);
    const chars = db.prepare("SELECT id, name, avatar_emoji FROM ownwe_characters").all();
    const charById = Object.fromEntries(chars.map((c) => [c.id, c]));

    // Build blocked set
    let blocked = new Set();
    if (excludeBlocked) {
      try {
        const rows = db.prepare("SELECT char_id FROM ownwe_moments_blocked").all();
        blocked = new Set(rows.map((r) => r.char_id));
      } catch {}
    }

    return moments
      .filter((m) => !(excludeBlocked && m.author_type === "char" && blocked.has(m.author_id)))
      .map((m) => {
        const likes = db.prepare("SELECT liker FROM ownwe_moment_likes WHERE moment_id = ?").all(m.id).map((r) => r.liker);
        const comments = db.prepare(
          "SELECT * FROM ownwe_moment_comments WHERE moment_id = ? ORDER BY id ASC"
        ).all(m.id).map((c) => ({
          ...c,
          authorName: c.author_type === "user" ? "我" : (charById[c.author_id]?.name || "角色"),
          authorEmoji: c.author_type === "user" ? "🙂" : (charById[c.author_id]?.avatar_emoji || "🤖"),
          replyToId: c.reply_to_id || 0,
          replyToName: c.reply_to_name || "",
        }));
        return {
          ...m,
          authorName: m.author_type === "user" ? "我" : (charById[m.author_id]?.name || "角色"),
          authorEmoji: m.author_type === "user" ? "🙂" : (charById[m.author_id]?.avatar_emoji || "🤖"),
          likes,
          likeNames: likes.map((l) => (l === "self" ? "我" : (charById[l]?.name || "角色"))),
          comments,
          isBlocked: blocked.has(m.author_id),
        };
      });
  } catch {
    return [];
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

function createMoment(dbPath, { authorType = "user", authorId = "self", text = "" }) {
  const db = getDb(dbPath);
  const info = db.prepare(
    "INSERT INTO ownwe_moments (author_type, author_id, text) VALUES (?, ?, ?)"
  ).run(authorType, authorId, String(text).slice(0, 2000));
  return info.lastInsertRowid;
}

function toggleLike(dbPath, { momentId, liker = "self" }) {
  const db = getDb(dbPath);
  const existing = db.prepare("SELECT 1 FROM ownwe_moment_likes WHERE moment_id = ? AND liker = ?").get(momentId, liker);
  if (existing) {
    db.prepare("DELETE FROM ownwe_moment_likes WHERE moment_id = ? AND liker = ?").run(momentId, liker);
    return false;
  }
  db.prepare("INSERT INTO ownwe_moment_likes (moment_id, liker) VALUES (?, ?)").run(momentId, liker);
  return true;
}

function addComment(dbPath, { momentId, authorType = "user", authorId = "self", text = "", replyToId = 0, replyToName = "" }) {
  const db = getDb(dbPath);
  db.prepare(
    "INSERT INTO ownwe_moment_comments (moment_id, author_type, author_id, text, reply_to_id, reply_to_name) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(momentId, authorType, authorId, String(text).slice(0, 1000), replyToId || 0, replyToName || "");
}

// ── Blocking ─────────────────────────────────────────────────────────────────

function toggleBlock(dbPath, charId) {
  const db = getDb(dbPath);
  const existing = db.prepare("SELECT 1 FROM ownwe_moments_blocked WHERE char_id = ?").get(charId);
  if (existing) {
    db.prepare("DELETE FROM ownwe_moments_blocked WHERE char_id = ?").run(charId);
    return false; // unblocked
  }
  db.prepare("INSERT INTO ownwe_moments_blocked (char_id) VALUES (?)").run(charId);
  return true; // blocked
}

function listBlockedCharIds(dbPath) {
  try {
    return getDb(dbPath).prepare("SELECT char_id FROM ownwe_moments_blocked").all().map((r) => r.char_id);
  } catch {
    return [];
  }
}

// ── Character reactions to user moments ──────────────────────────────────────

// Characters react to a user's moment. Each independently decides whether to
// like and/or comment — most of the time they won't, so the feed feels real.
async function reactToMoment(dbPath, momentId, text) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return;
  let chars = [];
  try {
    chars = getDb(dbPath).prepare(
      "SELECT id, name, persona_prompt FROM ownwe_characters ORDER BY sort_order ASC LIMIT 6"
    ).all();
  } catch {
    return;
  }
  for (const ch of chars) {
    try {
      const persona = (ch.persona_prompt || "").slice(0, 1200);
      const messages = [
        {
          role: "system",
          content: [
            persona ? `你的人设：\n${persona}` : `你是「${ch.name}」。`,
            "你的朋友（用户）刚发了一条朋友圈。你看到了。",
            "按你的人设、你和TA的关系，真实地决定要不要点赞、要不要评论。",
            "大多数时候普通的动态你可能只点个赞或什么都不做——别每条都长篇大论，那样很假。",
            "评论要短、像真人随口说的、是你自己的语气。绝不要引用「我记得/根据资料」之类，把了解演成自然。",
            MOMENT_CHANNEL_RULE,
            '严格输出 JSON，无 markdown：{"like": true/false, "comment": ""}。不想评论就 comment 给空字符串。',
          ].join("\n"),
        },
        { role: "user", content: `朋友圈内容：${String(text).slice(0, 500)}` },
      ];
      const raw = await callDeepSeek({ messages, apiKey });
      const m = raw && raw.match(/\{[\s\S]*\}/);
      if (!m) continue;
      let parsed;
      try { parsed = JSON.parse(m[0]); } catch { continue; }
      const db = getDb(dbPath);
      if (parsed.like) {
        try {
          db.prepare("INSERT OR IGNORE INTO ownwe_moment_likes (moment_id, liker) VALUES (?, ?)").run(momentId, ch.id);
        } catch {}
      }
      const comment = typeof parsed.comment === "string" ? parsed.comment.trim() : "";
      if (comment) {
        try {
          db.prepare(
            "INSERT INTO ownwe_moment_comments (moment_id, author_type, author_id, text) VALUES (?, 'char', ?, ?)"
          ).run(momentId, ch.id, comment.slice(0, 500));
          // other characters "see" this comment in the shared feed → memory
          recordMomentObservation(dbPath, { momentText: text, actorId: ch.id, actorName: ch.name, commentText: comment });
        } catch {}
      }
    } catch {
      // best effort per character
    }
  }
}

// ── Characters post their own moments ────────────────────────────────────────

const CHAR_MOMENT_MIN_GAP_H = Number(process.env.OWNWE_CHAR_MOMENT_MIN_GAP_H || 8);
const CHAR_MOMENT_PROB = Number(process.env.OWNWE_CHAR_MOMENT_PROB || 0.3);

function hoursSince(iso) {
  const t = Date.parse((iso || "").replace(" ", "T") + (iso && iso.includes("Z") ? "" : "Z"));
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

async function maybeCharacterPostMoments(dbPath, { force = false } = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return 0;
  let chars = [];
  try {
    chars = getDb(dbPath).prepare(
      "SELECT id, name, persona_prompt, last_moment_at FROM ownwe_characters"
    ).all();
  } catch {
    return 0;
  }

  let posted = 0;
  for (const ch of chars) {
    try {
      if (!force) {
        const gapH = hoursSince(ch.last_moment_at);
        if (gapH < CHAR_MOMENT_MIN_GAP_H) continue;
        if (Math.random() > CHAR_MOMENT_PROB) continue;
      }

      const text = await composeCharMoment(apiKey, ch);
      if (!text) continue;

      const db = getDb(dbPath);
      const info = db.prepare(
        "INSERT INTO ownwe_moments (author_type, author_id, text) VALUES ('char', ?, ?)"
      ).run(ch.id, text);
      db.prepare(
        "UPDATE ownwe_characters SET last_moment_at = datetime('now') WHERE id = ?"
      ).run(ch.id);
      posted += 1;

      // other characters react to this char's moment too
      reactToMoment(dbPath, info.lastInsertRowid, text).catch(() => {});
    } catch {
      // best effort per character
    }
  }
  return posted;
}

async function composeCharMoment(apiKey, ch) {
  const persona = (ch.persona_prompt || "").slice(0, 1200);
  const tod = partOfDay();
  const messages = [
    {
      role: "system",
      content: [
        persona ? `你的人设：\n${persona}` : `你是「${ch.name}」。`,
        `现在是${tod}。你想发一条朋友圈，分享你此刻的状态、想法、或生活片段。`,
        "要完全符合你的人设和生活背景，短小自然，像真人随手发的。",
        "可以带点情绪、可以有小事件、可以是随想——不要鸡汤，不要说教。",
        "直接输出朋友圈正文，不要解释，不要加引号，不超过150字。",
      ].join("\n"),
    },
    { role: "user", content: "（发朋友圈）" },
  ];
  const raw = await callDeepSeek({ messages, apiKey });
  return (raw || "").trim().slice(0, 500);
}

// ── Characters reply to user's comments ──────────────────────────────────────
// Called when the user adds a comment. The character whose moment it is (or any
// char who already commented) may reply back — keeps the thread alive.
async function reactToComment(dbPath, momentId, userCommentText, momentAuthorId) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return;
  try {
    const db = getDb(dbPath);
    // Build candidate responders: moment author + chars who already commented
    const existing = db.prepare(
      "SELECT DISTINCT author_id FROM ownwe_moment_comments WHERE moment_id = ? AND author_type = 'char'"
    ).all(momentId).map((r) => r.author_id);
    const candidates = new Set([...(momentAuthorId && momentAuthorId !== "self" ? [momentAuthorId] : []), ...existing]);
    if (!candidates.size) return;

    // Load their personas
    const charRows = db.prepare(
      `SELECT id, name, persona_prompt FROM ownwe_characters WHERE id IN (${[...candidates].map(() => "?").join(",")})`
    ).all(...candidates);

    // The moment text for context
    const moment = db.prepare("SELECT text FROM ownwe_moments WHERE id = ?").get(momentId);
    const momentText = moment?.text || "";

    // Existing comments for context
    const prevComments = db.prepare(
      "SELECT oc.text, oc.author_type, oc.author_id, oc.reply_to_name, ch.name as char_name FROM ownwe_moment_comments oc LEFT JOIN ownwe_characters ch ON ch.id = oc.author_id WHERE oc.moment_id = ? ORDER BY oc.id ASC LIMIT 10"
    ).all(momentId).map((c) => {
      const who = c.author_type === "user" ? "我" : (c.char_name || "角色");
      return `${who}：${c.reply_to_name ? `回复 ${c.reply_to_name}：` : ""}${c.text}`;
    }).join("\n");

    for (const ch of charRows) {
      // ~50% chance to reply per char, don't spam
      if (Math.random() > 0.5) continue;
      try {
        const persona = (ch.persona_prompt || "").slice(0, 1200);
        const messages = [
          {
            role: "system",
            content: [
              persona ? `你的人设：\n${persona}` : `你是「${ch.name}」。`,
              "这是手机上的朋友圈评论区。用户刚回复了你们的评论区。",
              "用你的语气自然地接一句——简短，像真人随手回的那种。不要解释，不要说废话。",
              "如果你觉得没必要回就别回，输出空字符串。",
              MOMENT_CHANNEL_RULE,
              '严格输出 JSON：{"reply": "你的回复内容或空字符串"}',
            ].join("\n"),
          },
          {
            role: "user",
            content: `朋友圈原文：${momentText.slice(0, 200)}\n\n评论区：\n${prevComments}\n\n用户刚说：${userCommentText.slice(0, 200)}`,
          },
        ];
        const raw = await callDeepSeek({ messages, apiKey });
        const m = raw && raw.match(/\{[\s\S]*\}/);
        if (!m) continue;
        let parsed;
        try { parsed = JSON.parse(m[0]); } catch { continue; }
        const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
        if (reply) {
          db.prepare(
            "INSERT INTO ownwe_moment_comments (moment_id, author_type, author_id, text, reply_to_name) VALUES (?, 'char', ?, ?, ?)"
          ).run(momentId, ch.id, reply.slice(0, 500), "我");
          recordMomentObservation(dbPath, { momentText, actorId: ch.id, actorName: ch.name, commentText: reply });
        }
      } catch {}
    }
  } catch {}
}

module.exports = {
  listMoments,
  createMoment,
  toggleLike,
  addComment,
  toggleBlock,
  listBlockedCharIds,
  reactToMoment,
  reactToComment,
  maybeCharacterPostMoments,
};
