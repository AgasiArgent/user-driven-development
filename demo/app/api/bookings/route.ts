import { createBooking, validateBooking, type NewBooking } from "../../../lib/bookings";
import { db } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as NewBooking | null;
  if (!body) return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  const error = validateBooking(body);
  if (error) return Response.json({ error }, { status: 400 });
  const booking = await createBooking(db(), body);
  return Response.json(booking, { status: 201 });
}
