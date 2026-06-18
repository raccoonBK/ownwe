-- Inter-character relationship state.
-- Each row (char_id, target_id) represents how char_id feels about target_id.
-- affinity  : general liking (0 = dislike, 1 = close friend)
-- jealousy  : rivalry for user's attention (0 = none, 1 = intense)
-- tension   : current interpersonal friction (decays over time like user-char tension)
CREATE TABLE IF NOT EXISTS char_char_relationship (
  char_id    TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  affinity   REAL NOT NULL DEFAULT 0.5,
  jealousy   REAL NOT NULL DEFAULT 0.0,
  tension    REAL NOT NULL DEFAULT 0.0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (char_id, target_id)
);
