-- OwnWe: per-character mute (禁言), sleep hours, and moment-posting frequency.
-- SQLite forbids non-constant ALTER defaults, so plain constants only.
ALTER TABLE ownwe_characters ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;          -- 1 = 禁言：no autonomous activity
ALTER TABLE ownwe_characters ADD COLUMN sleep_start INTEGER NOT NULL DEFAULT -1;   -- quiet-hours start hour (0-23), -1 = none
ALTER TABLE ownwe_characters ADD COLUMN sleep_end INTEGER NOT NULL DEFAULT -1;     -- quiet-hours end hour (0-23), -1 = none
ALTER TABLE ownwe_characters ADD COLUMN moment_interval_h REAL NOT NULL DEFAULT 6; -- avg hours between self-posted moments, 0 = never

-- Track how many proactive messages went ignored in a row (drives hidden resentment).
ALTER TABLE char_relationship_state ADD COLUMN ignored_streak INTEGER NOT NULL DEFAULT 0;
