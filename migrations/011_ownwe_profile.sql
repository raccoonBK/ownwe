-- OwnWe 画像系统 (adapted from 问渠)
--
-- Two layers:
--   1. ownwe_user_base : objective facts about the user, SHARED across all characters.
--   2. char_user_profile : each character's own subjective impression of the user
--      (selective encoding — different characters hold different pictures).

-- ── Objective layer (single row, key = 'self') ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ownwe_user_base (
  id TEXT PRIMARY KEY DEFAULT 'self',
  industries TEXT NOT NULL DEFAULT '[]',  -- JSON array
  age TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  mbti TEXT NOT NULL DEFAULT '',
  major TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  tone REAL NOT NULL DEFAULT 0.5,
  link REAL NOT NULL DEFAULT 0.5,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Subjective layer (one row per character) ────────────────────────────────────
-- Complex nested shapes are stored as JSON text, matching the 问渠 data model 1:1.
CREATE TABLE IF NOT EXISTS char_user_profile (
  char_id TEXT PRIMARY KEY,
  tags TEXT NOT NULL DEFAULT '[]',             -- [{text,certain,core}]
  keywords TEXT NOT NULL DEFAULT '[]',         -- [string]
  thinking_styles TEXT NOT NULL DEFAULT '[]',  -- [string]
  emotions TEXT NOT NULL DEFAULT '[]',         -- [string]
  important_tasks TEXT NOT NULL DEFAULT '[]',  -- [{q,src,confused,negative}]
  baseline_views TEXT NOT NULL DEFAULT '[]',   -- [{text,snappedAt}]
  recent_views TEXT NOT NULL DEFAULT '[]',     -- [{text}]
  core_views TEXT NOT NULL DEFAULT '[]',       -- [{text,evolved,evolvedAt}]
  rv_freq TEXT NOT NULL DEFAULT '[]',          -- recent-view frequency helper
  msgs_since_extract INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
