"use client";

import { useEffect, useState } from "react";
import type { Booking } from "../lib/bookings";
import { localDayKey, weekDays } from "../lib/dates";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The current week in the browser's time zone, with this room's bookings under each day. */
export function WeekCalendar({ bookings }: { bookings: Booking[] }) {
  const [days, setDays] = useState<Date[] | null>(null);
  useEffect(() => setDays(weekDays(new Date())), []);
  if (!days) return <div className="calendar" aria-busy="true" />;

  return (
    <div className="calendar">
      {days.map((day) => {
        const key = localDayKey(day);
        const items = bookings.filter((b) => b.startsAt.slice(0, 10) === key);
        return (
          <section key={key} className="day" data-day={key}>
            <h3>{day.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</h3>
            {items.map((b) => (
              <div key={b.id} className="booking">
                <strong>{b.title}</strong>
                <span>
                  {time(b.startsAt)}–{time(b.endsAt)} · {b.bookedBy}
                </span>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
