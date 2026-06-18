-- OwnWe: distinguish work groups from casual groups
ALTER TABLE ownwe_groups ADD COLUMN group_type TEXT NOT NULL DEFAULT 'casual';
-- 'casual' = water cooler chat; 'work' = task-focused group
