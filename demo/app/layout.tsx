import type { ReactNode } from "react";
import Link from "next/link";
import { UserPicker } from "../components/UserPicker";
import { currentUser } from "../lib/users";
import "./globals.css";

export const metadata = { title: "Roomly — meeting room booking (demo)" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">Roomly</Link>
          <nav>
            <Link href="/">Rooms</Link>
            <Link href="/reports">My feedback</Link>
          </nav>
          <UserPicker current={user} />
        </header>
        <main>{children}</main>
        {/* The feedback widget: one script tag, any web app. */}
        <script src="/widget.js" data-endpoint="/api/feedback" data-user={user} defer />
      </body>
    </html>
  );
}
