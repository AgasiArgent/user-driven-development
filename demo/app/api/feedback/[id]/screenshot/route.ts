import { db } from "../../../../../lib/db";
import { handleScreenshotGet } from "../../../../../lib/feedback";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleScreenshotGet((await params).id, db());
}
