/** The commit production runs. The dispatcher's verify step compares it with the merge commit (principle 7). */
export function versionResponse(env: Record<string, string | undefined> = process.env): Response {
  return Response.json({ sha: env.GIT_SHA || null }, { headers: { "cache-control": "no-store" } });
}
