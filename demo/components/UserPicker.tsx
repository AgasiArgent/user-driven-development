"use client";

import { USER_COOKIE, USERS } from "../lib/userCookie";


export function UserPicker({ current }: { current: string }) {
  return (
    <label className="user">
      Signed in as{" "}
      <select
        value={current}
        onChange={(e) => {
          document.cookie = `${USER_COOKIE}=${e.target.value}; path=/; samesite=lax`;
          window.location.reload();
        }}
      >
        {USERS.map((u) => (
          <option key={u}>{u}</option>
        ))}
      </select>
    </label>
  );
}
