-- OwnWe: reply-to for moment comments + moments blocking per character
ALTER TABLE ownwe_moment_comments ADD COLUMN reply_to_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ownwe_moment_comments ADD COLUMN reply_to_name TEXT NOT NULL DEFAULT '';

-- Hide a character's posts from the moments feed
CREATE TABLE IF NOT EXISTS ownwe_moments_blocked (
  char_id TEXT PRIMARY KEY,
  blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
