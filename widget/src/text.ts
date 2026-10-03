/**
 * Cuts a string to at most `max` characters (Unicode code points, as JSON Schema counts them),
 * never inside a surrogate pair, and replaces lone surrogates and NUL, which Postgres rejects.
 */
export function cut(value: string, max: number): string {
  const clean = value.replace(/\u0000/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
  const chars = Array.from(clean);
  return chars.length > max ? chars.slice(0, max).join("") : clean;
}
