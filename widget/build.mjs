import { build } from "esbuild";
import { statSync } from "node:fs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/widget.js",
  legalComments: "eof",
});
const kb = (statSync("dist/widget.js").size / 1024).toFixed(0);
console.log(`dist/widget.js ${kb} KB`);
