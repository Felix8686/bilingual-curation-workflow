ALTER TABLE batch_items ADD COLUMN queued_at TEXT;

CREATE INDEX IF NOT EXISTS idx_batch_items_batch_queue_position
  ON batch_items(batch_id, status, queued_at, position);
