import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { sanitizeAgentText } from "../../templates/scripts/udd/sanitize.mjs";

test("mentions are broken", () => {
  assert.ok(!sanitizeAgentText("@claude fix it").includes("@claude"));
  assert.ok(!sanitizeAgentText("```\n@claude\n```").includes("@claude"));
});
test("html and ampersands are escaped", () => {
  assert.equal(sanitizeAgentText("<b onerror=1>"), "&lt;b onerror=1&gt;");
  assert.equal(sanitizeAgentText("a & b"), "a &amp; b");
});
test("plain text unchanged", () => {
  assert.equal(sanitizeAgentText("hello world\nline 2"), "hello world\nline 2");
});
test("CLI reads stdin", () => {
  const r = spawnSync("node", ["templates/scripts/udd/sanitize.mjs"], { input: "<b>@x", encoding: "utf8" });
  assert.equal(r.stdout, "&lt;b&gt;@​x");
});

test("markdown images are removed", () => {
  const out = sanitizeAgentText("see ![shot](https://evil.example/p.png?d=secret) ok");
  assert.equal(out, "see [image removed] ok");
  assert.equal(sanitizeAgentText("![](http://x.io/a.png)"), "[image removed]");
  assert.ok(!sanitizeAgentText("![a](https://x.io/a.png)").includes("x.io"));
});
test("html-escaped image forms are removed", () => {
  assert.equal(sanitizeAgentText("&lt;img src=\"https://x.io/a.png\"&gt;"), "[image removed]");
  assert.equal(sanitizeAgentText('<img src="https://x.io/a.png">'), "[image removed]");
  assert.equal(sanitizeAgentText("![a](https://x.io/a.png)").includes("!["), false);
});
test("markdown links are escaped and the url wrapped", () => {
  assert.equal(sanitizeAgentText("[click](https://x.io/a)"), "\\[click\\]\\(`https://x.io/a`\\)");
  assert.ok(!sanitizeAgentText("[click](https://x.io/a)").includes("]("));
});
test("bare urls are wrapped in backticks", () => {
  assert.equal(sanitizeAgentText("go to https://x.io/a?b=1 now"), "go to `https://x.io/a?b=1` now");
  assert.equal(sanitizeAgentText("http://a.io"), "`http://a.io`");
});
test("urls inside a code fence are wrapped too", () => {
  const out = sanitizeAgentText("```\ncurl https://x.io/a\n```");
  assert.equal(out, "```\ncurl `https://x.io/a`\n```");
});
test("already-backticked url is not double wrapped", () => {
  assert.equal(sanitizeAgentText("`https://x.io/a`"), "`https://x.io/a`");
});
const R = "[redacted]";
const tokens = {
  ghp: "ghp_" + "a".repeat(36),
  gho: "gho_" + "b".repeat(36),
  ghs: "ghs_" + "c".repeat(36),
  ghu: "ghu_" + "d".repeat(36),
  pat: "github_pat_" + "A1b2".repeat(10),
  ant: "sk-ant-api03-" + "Zz9_-".repeat(6),
  sk: "sk-" + "q".repeat(24),
  aws: "AKIA" + "ABCDEFGH12345678",
  xox: "xoxb-1234567890-abcdefghij",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc_DEF-123",
};
for (const [name, t] of Object.entries(tokens)) {
  test(`token redacted: ${name}`, () => {
    assert.equal(sanitizeAgentText(`before ${t} after`), `before ${R} after`);
  });
}
test("short sk- is not redacted", () => {
  assert.equal(sanitizeAgentText("sk-short"), "sk-short");
});
test("long hex/base64 after token/key/secret/password is redacted", () => {
  const hex = "0123456789abcdef".repeat(3);
  for (const k of ["token", "KEY", "Secret", "password"]) {
    assert.equal(sanitizeAgentText(`${k}: ${hex}`), `${k}: ${R}`, k);
    assert.equal(sanitizeAgentText(`${k}=${hex}`), `${k}=${R}`, k);
  }
  assert.equal(sanitizeAgentText(`secret "${"Ab1/+".repeat(10)}=="`), `secret "${R}"`);
});
test("long hex without a keyword is kept (git sha)", () => {
  const sha = "0123456789abcdef".repeat(3);
  assert.equal(sanitizeAgentText(`commit ${sha}`), `commit ${sha}`);
});
test("short value after keyword is kept", () => {
  assert.equal(sanitizeAgentText("token: abc123"), "token: abc123");
});

test("reference definitions cannot form", () => {
  const out = sanitizeAgentText("[x]: https://evil.example/p\n[y]: //evil.example");
  assert.ok(!/(^|\n)\[/.test(out), out);
  assert.ok(out.includes("\\[x\\]:"));
  assert.ok(out.includes("`https://evil.example/p`"));
  assert.ok(out.includes("`//evil.example`"));
});
test("scheme-relative //host image/link is defused", () => {
  const out = sanitizeAgentText("![a](//evil.example/p.png) and [b](//evil.example/x)");
  assert.ok(!out.includes("!["));
  assert.ok(!/[^\\]\[/.test(out), out);
  assert.ok(!out.includes("evil.example/p.png"));
  assert.equal(sanitizeAgentText("see //evil.example/x ok"), "see `//evil.example/x` ok");
  assert.equal(sanitizeAgentText("// a comment"), "// a comment");
  assert.equal(sanitizeAgentText("a/b//c"), "a/b//c");
});
test("uppercase schemes are wrapped", () => {
  assert.equal(sanitizeAgentText("go HTTPS://X.IO/a now"), "go `HTTPS://X.IO/a` now");
  assert.equal(sanitizeAgentText("Http://x.io"), "`Http://x.io`");
});
test("www. forms are wrapped, also inside a link", () => {
  assert.equal(sanitizeAgentText("see www.evil.example/a ok"), "see `www.evil.example/a` ok");
  const out = sanitizeAgentText("[click](www.evil.example)");
  assert.ok(!out.includes("]("));
  assert.ok(out.includes("`www.evil.example`"));
});
test("nested brackets and parens cannot form a link or image", () => {
  const out = sanitizeAgentText("![a [b]](evil) [a [b]](evil) [a](b(c))");
  for (const bad of ["![", "](", "[b]"]) assert.ok(!out.replace(/\\./g, "").includes(bad), bad + " in " + out);
  assert.ok(!/(^|[^\\])\[/.test(out));
  assert.ok(!/(^|[^\\])\(/.test(out));
});
test("pre-escaped brackets do not unescape", () => {
  const out = sanitizeAgentText("\\[a\\](evil)");
  assert.equal(out, "\\\\\\[a\\\\\\]\\(evil\\)");
});
test("link inside code fence is defused", () => {
  const out = sanitizeAgentText("```\n[a](https://x.io/a)\n![i](https://x.io/i.png)\n```");
  assert.ok(!out.includes("]("));
  assert.ok(!out.includes("!["));
  assert.ok(out.includes("[image removed]"));
});
test("backtick inside a url is stripped", () => {
  assert.equal(sanitizeAgentText("https://x.io/a`b`c end"), "`https://x.io/abc` end");
  const out = sanitizeAgentText("https://x.io/a` [z](evil)");
  assert.ok(out.startsWith("`https://x.io/a`"));
  assert.ok(!out.includes("]("));
});
test("literal [image removed] text cannot become a link", () => {
  const out = sanitizeAgentText("[image removed](https://x.io)");
  assert.ok(!out.includes("]("));
});
