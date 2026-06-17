-- OwnWe relationship state: track last interaction for lazy tension computation (§6)
-- NOTE: SQLite forbids non-constant defaults (datetime('now')) in ALTER TABLE ADD COLUMN,
-- so we default to '' and treat empty as "now" in application code.
ALTER TABLE char_relationship_state ADD COLUMN last_interaction_at TEXT NOT NULL DEFAULT '';
