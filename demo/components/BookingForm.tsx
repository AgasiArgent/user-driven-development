"use client";

import { useState } from "react";
import { localDayKey } from "../lib/dates";

export function BookingForm({ roomId, user }: { roomId: number; user: string }) {
  const [date, setDate] = useState(() => localDayKey(new Date()));
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId,
        title,
        bookedBy: user,
        startsAt: new Date(`${date}T${start}`).toISOString(),
        endsAt: new Date(`${date}T${end}`).toISOString(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 201) {
      setMessage({ text: "Booked.", error: false });
      window.location.reload();
    } else {
      setMessage({ text: body.error ?? "Booking failed.", error: true });
    }
  }

  return (
    <form className="booking-form" onSubmit={submit}>
      <label>
        Title <input value={title} onChange={(e) => setTitle(e.target.value)} name="title" />
      </label>
      <div className="when">
        <label>
          Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} name="date" />
        </label>
        <label>
          Start <input type="time" value={start} onChange={(e) => setStart(e.target.value)} name="start" />
        </label>
        <label>
          End <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} name="end" />
        </label>
        <button type="submit" disabled={busy}>
          Book
        </button>
      </div>
      {message && <p className={message.error ? "error" : "ok"} role="status">{message.text}</p>}
    </form>
  );
}
