import { notFound } from "next/navigation";
import { BookingForm } from "../../../components/BookingForm";
import { WeekCalendar } from "../../../components/WeekCalendar";
import { roomBookings } from "../../../lib/bookings";
import { db } from "../../../lib/db";
import { currentUser } from "../../../lib/users";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const room = (await db().query<{ name: string; capacity: number }>("SELECT name, capacity FROM rooms WHERE id = $1", [id])).rows[0];
  if (!room) notFound();
  const bookings = await roomBookings(db(), id);
  return (
    <>
      <h1>
        {room.name} <span className="muted">· {room.capacity} people</span>
      </h1>
      <WeekCalendar bookings={bookings} />
      <h2>Book this room</h2>
      <BookingForm roomId={id} user={await currentUser()} />
    </>
  );
}
