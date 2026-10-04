import { versionResponse } from "../../../lib/version";

export const dynamic = "force-dynamic";

export function GET() {
  return versionResponse();
}
