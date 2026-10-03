import { ReportList } from "../../components/ReportList";
import { currentUser } from "../../lib/users";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  return (
    <>
      <h1>My feedback</h1>
      <p className="muted">Everything you sent with the Feedback button, and where it is now.</p>
      <ReportList user={await currentUser()} />
    </>
  );
}
