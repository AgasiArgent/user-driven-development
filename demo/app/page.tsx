import Link from "next/link";
import { db } from "../lib/db";

export const dynamic = "force-dynamic";

export default async function RoomsPage() {
  const { rows } = await db().query<{ id: number; name: string; capacity: number }>("SELECT id, name, capacity FROM rooms ORDER BY id");
  return (
    <>
      <h1>Meeting rooms</h1>
      <ul className="rooms">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/rooms/${r.id}`}>{r.name}</Link>
            <span className="muted">{r.capacity} people</span>
          </li>
        ))}
      </ul>
    </>
  );
}
