-- OwnWe character definitions (user-created)
CREATE TABLE IF NOT EXISTS ownwe_characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                         -- display name e.g. "尤金·怀尔特"
  codename TEXT NOT NULL DEFAULT '',          -- short tag e.g. "提线人"
  persona_prompt TEXT NOT NULL DEFAULT '',    -- full user-written character prompt
  provider TEXT NOT NULL DEFAULT 'anthropic', -- anthropic | deepseek | kimi | gemini | openai
  model TEXT NOT NULL DEFAULT '',             -- model id, empty = provider default
  api_key_override TEXT NOT NULL DEFAULT '',  -- empty = use global provider key
  mode_bias TEXT NOT NULL DEFAULT 'auto',     -- 'A' | 'B' | 'auto'
  avatar_emoji TEXT NOT NULL DEFAULT '🤖',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Map characters to Roundtable speaker slots
-- A character can "occupy" the claude or codex speaker for a given topic
CREATE TABLE IF NOT EXISTS ownwe_character_bindings (
  topic_id TEXT NOT NULL,
  speaker TEXT NOT NULL,    -- 'claude' | 'codex'
  character_id TEXT NOT NULL REFERENCES ownwe_characters(id) ON DELETE CASCADE,
  bound_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (topic_id, speaker)
);

CREATE INDEX IF NOT EXISTS idx_ownwe_bindings_char ON ownwe_character_bindings(character_id);
