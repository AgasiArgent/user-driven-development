CREATE TABLE rooms (
  id        serial PRIMARY KEY,
  name      text NOT NULL,
  capacity  int  NOT NULL
);

CREATE TABLE bookings (
  id         serial PRIMARY KEY,
  room_id    int NOT NULL REFERENCES rooms(id),
  title      text NOT NULL,
  booked_by  text NOT NULL,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL
);

-- Durable queue of feedback reports (principle 1). Parts 2 and 3 deliver rows onward
-- and move them through further statuses; part 1 only writes 'received'.
CREATE TABLE feedback_outbox (
  id          bigserial PRIMARY KEY,
  status      text NOT NULL DEFAULT 'received',
  payload     jsonb NOT NULL,
  screenshot  bytea,
  user_ref    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_outbox_user_idx ON feedback_outbox (user_ref, created_at DESC);
CREATE INDEX feedback_outbox_status_idx ON feedback_outbox (status, created_at);

INSERT INTO rooms (name, capacity) VALUES
  ('Aurora', 4), ('Basalt', 8), ('Cedar', 12), ('Dune', 2);

-- Ten bookings in the current week, so the calendar is never empty.
INSERT INTO bookings (room_id, title, booked_by, starts_at, ends_at)
SELECT b.room_id, b.title, b.booked_by,
       date_trunc('week', now()) + b.day * interval '1 day' + b.start_h * interval '1 hour',
       date_trunc('week', now()) + b.day * interval '1 day' + b.end_h * interval '1 hour'
FROM (VALUES
  (1, 'Design review', 'alice', 0, 10, 11),
  (1, 'Weekly planning', 'bob', 1, 9, 10),
  (2, 'Customer call', 'carol', 0, 14, 15),
  (2, 'Hiring panel', 'alice', 2, 11, 13),
  (3, 'All hands', 'bob', 3, 16, 17),
  (3, 'Training', 'carol', 4, 9, 12),
  (4, 'One-on-one', 'alice', 1, 15, 16),
  (4, 'Interview', 'bob', 2, 10, 11),
  (1, 'Retro', 'carol', 4, 15, 16),
  (2, 'Demo prep', 'bob', 3, 13, 14)
) AS b(room_id, title, booked_by, day, start_h, end_h);
