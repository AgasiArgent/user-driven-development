import type { Db } from "./db";

export interface Booking {
  id: number;
  roomId: number;
  title: string;
  bookedBy: string;
  startsAt: string;
  endsAt: string;
}

export interface NewBooking {
  roomId: number;
  title: string;
  bookedBy: string;
  startsAt: string;
  endsAt: string;
}

/** Returns an error message for the form, or null when the booking is valid. */
export function validateBooking(b: NewBooking): string | null {
  if (!b.title?.trim()) return "Please enter a title.";
  const start = Date.parse(b.startsAt);
  const end = Date.parse(b.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return "Please enter a date, a start time and an end time.";
  if (end <= start) return "End time must be after end time.";
  return null;
}

export async function createBooking(db: Db, b: NewBooking): Promise<Booking> {
  const { rows } = await db.query(
    `INSERT INTO bookings (room_id, title, booked_by, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, room_id, title, booked_by, starts_at, ends_at`,
    [b.roomId, b.title.trim(), b.bookedBy, b.startsAt, b.endsAt],
  );
  return toBooking(rows[0]);
}

export async function roomBookings(db: Db, roomId: number): Promise<Booking[]> {
  const { rows } = await db.query(
    `SELECT id, room_id, title, booked_by, starts_at, ends_at FROM bookings
      WHERE room_id = $1 AND ends_at > now() - interval '14 days' ORDER BY starts_at`,
    [roomId],
  );
  return rows.map(toBooking);
}

function toBooking(r: { id: number; room_id: number; title: string; booked_by: string; starts_at: Date; ends_at: Date }): Booking {
  return { id: r.id, roomId: r.room_id, title: r.title, bookedBy: r.booked_by, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString() };
}
