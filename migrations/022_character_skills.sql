-- Per-character skill set. Stored as a JSON array of skill keys, e.g. ["coder","researcher"].
-- The skill library is defined in code (SKILL_LIBRARY in ownwe-context.js).
ALTER TABLE ownwe_characters ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
