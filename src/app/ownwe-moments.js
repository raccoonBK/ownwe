// OwnWe 朋友圈 (Moments) — simple feed of posts + likes + comments.
// Authors are either the user ('self') or a character. Characters can be made to
// react via the optional DeepSeek hook (reactToMoment), kept best-effort.

const { getDb } = require("../db/connection");

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

module.exports = { listMoments, createMoment, toggleLike, addComment };
