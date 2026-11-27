PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS quality_runs (
  run_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  project TEXT NOT NULL,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  preview_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'passed', 'failed', 'blocked', 'not-run', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_runs_project_created
  ON quality_runs(project, created_at DESC);

CREATE TABLE IF NOT EXISTS quality_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(run_id, sequence),
  FOREIGN KEY(run_id) REFERENCES quality_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quality_events_run_sequence
  ON quality_events(run_id, sequence);

CREATE TABLE IF NOT EXISTS quality_evidence (
  evidence_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('screenshot', 'video', 'trace', 'console', 'network', 'junit', 'log')),
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES quality_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quality_evidence_run_created
  ON quality_evidence(run_id, created_at DESC);
