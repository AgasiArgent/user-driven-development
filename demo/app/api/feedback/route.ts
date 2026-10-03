import { db } from "../../../lib/db";
import { handleFeedbackGet, handleFeedbackPost } from "../../../lib/feedback";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleFeedbackPost(req, db());
}

export function GET(req: Request) {
  return handleFeedbackGet(req, db());
}
