PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'partial_failed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  theme TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  request_json TEXT NOT NULL,
  result_json TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
  UNIQUE (batch_id, position)
);

CREATE INDEX IF NOT EXISTS idx_batch_items_batch_status_position
  ON batch_items(batch_id, status, position);
