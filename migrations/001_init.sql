CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  container_type TEXT NOT NULL DEFAULT 'temporary',
  container_id TEXT NOT NULL DEFAULT '',
  container_title TEXT NOT NULL DEFAULT '',
  max_rounds INTEGER NOT NULL DEFAULT 4,
  round INTEGER NOT NULL DEFAULT 0,
  next_speaker TEXT NOT NULL DEFAULT 'codex',
  running INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  last_error TEXT NOT NULL DEFAULT '',
  fresh_runtime_handoffs_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  archived_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_topics_container ON topics(container_type, container_id);
CREATE INDEX IF NOT EXISTS idx_topics_updated ON topics(updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  pending INTEGER NOT NULL DEFAULT 0,
  transcript INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_messages_topic_ordinal ON messages(topic_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_messages_topic_created ON messages(topic_id, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  speaker UNINDEXED,
  topic_id UNINDEXED,
  content='messages',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text, speaker, topic_id)
  VALUES (new.rowid, new.text, new.speaker, new.topic_id);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text, speaker, topic_id)
  VALUES ('delete', old.rowid, old.text, old.speaker, old.topic_id);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text, speaker, topic_id)
  VALUES ('delete', old.rowid, old.text, old.speaker, old.topic_id);
  INSERT INTO messages_fts(rowid, text, speaker, topic_id)
  VALUES (new.rowid, new.text, new.speaker, new.topic_id);
END;

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_events_topic_ordinal ON events(topic_id, ordinal);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL,
  request_id TEXT NOT NULL,
  runtime_request_id TEXT,
  kind TEXT NOT NULL DEFAULT 'command',
  command TEXT NOT NULL DEFAULT '',
  command_tokens_json TEXT NOT NULL DEFAULT '[]',
  thread_id TEXT NOT NULL DEFAULT '',
  turn_id TEXT NOT NULL DEFAULT '',
  file_paths_json TEXT NOT NULL DEFAULT '[]',
  response_template_json TEXT,
  elicitation_json TEXT,
  created_at TEXT NOT NULL DEFAULT '',
  resolved_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_topic ON approvals(topic_id);

CREATE TABLE IF NOT EXISTS speaker_topic_state (
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL,
  last_seen_message_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (topic_id, speaker)
);

CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  topic_title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'mixed',
  time_range_from TEXT NOT NULL DEFAULT '',
  time_range_to TEXT NOT NULL DEFAULT '',
  time_range_text TEXT NOT NULL DEFAULT '',
  message_range_from TEXT NOT NULL DEFAULT '',
  message_range_to TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  summary_text TEXT NOT NULL DEFAULT '',
  useful_json TEXT NOT NULL DEFAULT '[]',
  decisions_json TEXT NOT NULL DEFAULT '[]',
  open_items_json TEXT NOT NULL DEFAULT '[]',
  latest_state TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  keywords_json TEXT NOT NULL DEFAULT '[]',
  raw_text TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_summaries_topic_created ON summaries(topic_id, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
  id UNINDEXED,
  search_text,
  topic_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS checkins (
  speaker TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_interval_ms INTEGER NOT NULL DEFAULT 600000,
  max_interval_ms INTEGER NOT NULL DEFAULT 3600000,
  next_at TEXT NOT NULL DEFAULT '',
  last_at TEXT NOT NULL DEFAULT '',
  last_action TEXT NOT NULL DEFAULT '',
  last_reason TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
