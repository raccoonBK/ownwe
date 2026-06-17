// OwnWe 朋友圈 (Moments) — simple feed of posts + likes + comments.
// Authors are either the user ('self') or a character. Characters can be made to
// react via the optional DeepSeek hook (reactToMoment), kept best-effort.

const { getDb } = require("../db/connection");
const { callDeepSeek } = require("./roundtable-deepseek");

function listMoments(dbPath, { limit = 50 } = {}) {
  try {
    const db = getDb(dbPath);
    const moments = db.prepare(
      "SELECT * FROM ownwe_moments ORDER BY id DESC LIMIT ?"
    ).all(limit);
    const chars = db.prepare("SELECT id, name, avatar_emoji FROM ownwe_characters").all();
    const charById = Object.fromEntries(chars.map((c) => [c.id, c]));

    return moments.map((m) => {
      const likes = db.prepare("SELECT liker FROM ownwe_moment_likes WHERE moment_id = ?").all(m.id).map((r) => r.liker);
      const comments = db.prepare(
        "SELECT * FROM ownwe_moment_comments WHERE moment_id = ? ORDER BY id ASC"
      ).all(m.id).map((c) => ({
        ...c,
        authorName: c.author_type === "user" ? "我" : (charById[c.author_id]?.name || "角色"),
        authorEmoji: c.author_type === "user" ? "🙂" : (charById[c.author_id]?.avatar_emoji || "🤖"),
      }));
      return {
        ...m,
        authorName: m.author_type === "user" ? "我" : (charById[m.author_id]?.name || "角色"),
        authorEmoji: m.author_type === "user" ? "🙂" : (charById[m.author_id]?.avatar_emoji || "🤖"),
        likes,
        likeNames: likes.map((l) => (l === "self" ? "我" : (charById[l]?.name || "角色"))),
        comments,
      };
    });
  } catch {
    return [];
  }
}

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

function addComment(dbPath, { momentId, authorType = "user", authorId = "self", text = "" }) {
  const db = getDb(dbPath);
  db.prepare(
    "INSERT INTO ownwe_moment_comments (moment_id, author_type, author_id, text) VALUES (?, ?, ?, ?)"
  ).run(momentId, authorType, authorId, String(text).slice(0, 1000));
}

// Characters react to a user's moment, in character (§5.4 witnessing payoff,
// §11 朋友圈 in the presence stream). Best-effort, async, cheap (DeepSeek).
// Each character independently decides whether to like and/or comment — most of
// the time they won't comment, so the feed feels real rather than spammy.
async function reactToMoment(dbPath, momentId, text) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return; // reactions need a cheap model; skip silently
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
            "评论要短、像真人随口说的、是你自己的语气。绝不要引用“我记得/根据资料”之类，把了解演成自然。",
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
        } catch {}
      }
    } catch {
      // best effort per character
    }
  }
}

module.exports = { listMoments, createMoment, toggleLike, addComment, reactToMoment };
