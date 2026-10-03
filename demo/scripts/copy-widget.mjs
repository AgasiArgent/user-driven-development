// Copies the built widget into public/ so the demo serves it at /widget.js.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, "..", "public"), { recursive: true });
copyFileSync(join(here, "..", "..", "widget", "dist", "widget.js"), join(here, "..", "public", "widget.js"));
console.log("copied widget.js to demo/public");
