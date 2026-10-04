-- One row per tracker issue the dispatcher has taken (principle 8: exactly one run per ticket).
CREATE TABLE dispatch_runs (
  issue_id    text PRIMARY KEY,
  issue_key   text NOT NULL,
  status      text NOT NULL,
  round       int  NOT NULL DEFAULT 0,
  task_id     text,
  branch      text,
  pr_url      text,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
