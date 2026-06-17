-- OwnWe: per-character "deep thinking" default. When on (default), the character
-- uses the stronger/reasoning model tier even for ordinary chat (better 真人感).
-- When off, the cost-aware A/B auto-switch applies (cheap for casual turns).
ALTER TABLE ownwe_characters ADD COLUMN deep_thinking INTEGER NOT NULL DEFAULT 1;
