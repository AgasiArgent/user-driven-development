# Vercel notes for SETUP.md

Read this when the app is deployed on Vercel. Replace `<id>` with the project id (`.vercel/project.json`,
field `projectId`) and `<team>` with the team id (`orgId` in the same file; for a personal account
leave `teamId` out). The agent can do everything below with the Vercel CLI token it already holds.

## 1. Deployment events (the `deployment_status` toggle)

New projects can have GitHub deployment events off. Check: push any branch, then
`gh api repos/<owner>/<repo>/deployments --jq '.[0].environment'` must print `Preview`. If it
prints nothing, turn on Project, Settings, Git, "`deployment_status` Events" (or ask the owner). Without it
the preview and production checks start only by hand.

## 2. The preview bypass secret (`UDD_PREVIEW_BYPASS`): the agent can create it

Previews are behind Vercel Authentication by default. Generate an automation bypass secret and
pipe it straight into GitHub. The value is never printed and never written to a file:

```bash
echo '{"generate":{"note":"udd"}}' \
 | vercel api "/v1/projects/<id>/protection-bypass?teamId=<team>" -X PATCH --input - \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const e=Object.entries(j.protectionBypass??{}).find(([,v])=>v.scope==="automation-bypass");process.stdout.write(e?e[0]:"")})' \
 | gh secret set UDD_PREVIEW_BYPASS
```

Plain REST with the CLI token answers "Not authorized"; use `vercel api`. If the response shape
differs, adapt the `node` filter, never print the response. Check: `gh secret list` shows
`UDD_PREVIEW_BYPASS`. Use the same value for the Playwright header (`SETUP.md` section 7).

## 3. Preview environment variables

`vercel env add NAME preview` is broken without a terminal (it loops asking for a git branch,
even with `--yes`). Use the REST API, with the value read from stdin or the environment:

```bash
VALUE="$PREVIEW_VALUE" node -e 'process.stdout.write(JSON.stringify({key:process.argv[1],value:process.env.VALUE,type:"encrypted",target:["preview"]}))' NAME \
 | vercel api "/v10/projects/<id>/env?teamId=<team>" -X POST --input -
```

Do not print the response. List names only: `vercel env ls preview`.

## 4. Preview host suffix

`UDD_PREVIEW_HOST_SUFFIX` must start with a dot, so a team-scoped suffix such as `-<team>.vercel.app`
cannot be used. Use `.vercel.app`, or the project's custom preview domain with a leading dot.

## 5. Express (or any server) on Vercel

- Helper files inside `api/` each become a function. Keep helpers outside `api/`, or in a folder
  that starts with an underscore (`api/_lib/`), which Vercel ignores.
- `express.json()` has a 100 kB body limit by default; a report with a screenshot is larger.
  Mount a route-specific `express.json({ limit: "3mb" })` on the intake route BEFORE the global parser,
  and add a JSON error handler (the default 413 page is HTML, which the widget cannot read).
- With ESM and `tsc` using `nodenext`, relative imports need the `.js` extension.
