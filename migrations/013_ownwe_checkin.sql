-- OwnWe 主动 check-in (§5.4) — proactive messages a character composes on its own,
-- delivered into the chat the next time the user opens it.
CREATE TABLE IF NOT EXISTS ownwe_pending_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  char_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pending_checkins_char ON ownwe_pending_checkins(char_id, delivered);
