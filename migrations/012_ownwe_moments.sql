-- OwnWe 朋友圈 (Moments) — §7 / §11
CREATE TABLE IF NOT EXISTS ownwe_moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_type TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'char'
  author_id TEXT NOT NULL DEFAULT 'self',    -- 'self' or character id
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_moments_created ON ownwe_moments(created_at DESC);

CREATE TABLE IF NOT EXISTS ownwe_moment_likes (
  moment_id INTEGER NOT NULL,
  liker TEXT NOT NULL,                        -- 'self' or character id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (moment_id, liker)
);

CREATE TABLE IF NOT EXISTS ownwe_moment_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id INTEGER NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'user',
  author_id TEXT NOT NULL DEFAULT 'self',
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_moment_comments_moment ON ownwe_moment_comments(moment_id);
