-- OwnWe: group chats + character-posted moments scheduling

-- Group chats (multiple characters in one conversation)
CREATE TABLE IF NOT EXISTS ownwe_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  char_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of character ids
  avatar_emoji TEXT NOT NULL DEFAULT '👥',
  current_idx INTEGER NOT NULL DEFAULT 0,  -- round-robin index
  topic_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Track when each character last posted to moments (for scheduling)
ALTER TABLE ownwe_characters ADD COLUMN last_moment_at TEXT NOT NULL DEFAULT '';

-- Pending character-authored moment drafts (generated async, posted after delay)
CREATE TABLE IF NOT EXISTS ownwe_pending_char_moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  char_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  posted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pending_char_moments ON ownwe_pending_char_moments(char_id, posted);
