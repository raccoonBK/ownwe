-- Per-character proactive message frequency (0 = disabled, N = min hours between pings)
ALTER TABLE ownwe_characters ADD COLUMN checkin_interval_h REAL NOT NULL DEFAULT 8;
