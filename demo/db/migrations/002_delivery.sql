-- Delivery of feedback to an issue tracker (part 2 and part 3).
ALTER TABLE feedback_outbox
  ADD COLUMN issue_ref    text,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN attempts     int NOT NULL DEFAULT 0,
  ADD COLUMN last_error   text;
