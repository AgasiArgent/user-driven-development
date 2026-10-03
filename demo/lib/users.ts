import { cookies } from "next/headers";
import { USER_COOKIE, USERS } from "./userCookie";

export async function currentUser(): Promise<string> {
  const value = (await cookies()).get(USER_COOKIE)?.value;
  return USERS.find((u) => u === value) ?? USERS[0];
}
