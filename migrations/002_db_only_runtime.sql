CREATE TABLE IF NOT EXISTS storage_entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  source_topic TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'topic',
  tags_json TEXT NOT NULL DEFAULT '[]',
  importance TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS runtime_sessions (
  runtime_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT ''
);
