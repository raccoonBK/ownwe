CREATE TABLE IF NOT EXISTS study_overview (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_goal TEXT NOT NULL DEFAULT '',
  current_phase TEXT NOT NULL DEFAULT '',
  current_scores_json TEXT NOT NULL DEFAULT '{}',
  main_risks_json TEXT NOT NULL DEFAULT '[]',
  next_three_days_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS study_plan_entries (
  date TEXT PRIMARY KEY,
  phase TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT '',
  tasks_json TEXT NOT NULL DEFAULT '[]',
  target_metrics_json TEXT NOT NULL DEFAULT '[]',
  review_plan_json TEXT NOT NULL DEFAULT '[]',
  teacher_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS study_progress_entries (
  date TEXT PRIMARY KEY,
  actual_completed TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  self_note TEXT NOT NULL DEFAULT '',
  teacher_feedback TEXT NOT NULL DEFAULT '',
  review_debt_json TEXT NOT NULL DEFAULT '[]',
  next_adjustment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_study_plan_entries_updated
  ON study_plan_entries(updated_at);

CREATE INDEX IF NOT EXISTS idx_study_progress_entries_updated
  ON study_progress_entries(updated_at);
