-- OwnWe character memory store
CREATE TABLE IF NOT EXISTS char_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  char_id TEXT NOT NULL,                    -- 'companion' | 'tool' | custom
  content TEXT NOT NULL,                    -- the memory content (intuition-format)
  context TEXT NOT NULL DEFAULT 'general',  -- 'work' | 'companion' | 'general'
  valence REAL NOT NULL DEFAULT 0.5,        -- 0=negative 1=positive, 0.5=neutral
  keywords TEXT NOT NULL DEFAULT '',        -- space-separated for simple retrieval
  topic_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_char_memories_char ON char_memories(char_id);
CREATE INDEX IF NOT EXISTS idx_char_memories_context ON char_memories(char_id, context);
CREATE INDEX IF NOT EXISTS idx_char_memories_topic ON char_memories(topic_id);

-- OwnWe room mode pins (A/B per room)
CREATE TABLE IF NOT EXISTS room_mode_pins (
  room_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT '',  -- 'A' | 'B' | '' (auto)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- OwnWe relationship state per character
CREATE TABLE IF NOT EXISTS char_relationship_state (
  char_id TEXT PRIMARY KEY,
  attachment REAL NOT NULL DEFAULT 0.5,
  security REAL NOT NULL DEFAULT 0.7,
  tension REAL NOT NULL DEFAULT 0.0,
  attention_balance REAL NOT NULL DEFAULT 0.5,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
