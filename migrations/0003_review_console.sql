ALTER TABLE batch_items
  ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed'
  CHECK (review_status IN ('unreviewed', 'approved', 'held', 'published'));

ALTER TABLE batch_items
  ADD COLUMN review_note TEXT;

ALTER TABLE batch_items
  ADD COLUMN reviewed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_batch_items_review_status_updated
  ON batch_items(review_status, updated_at DESC);
