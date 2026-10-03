import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../contracts/feedback-report.schema.json";

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const check = ajv.compile(schema);

/** Validates a body against contracts/feedback-report.schema.json; returns readable errors. */
export function reportErrors(body: unknown): string[] {
  if (check(body)) return [];
  return (check.errors ?? []).map((e) => {
    const missing = e.keyword === "required" ? (e.params as { missingProperty: string }).missingProperty : "";
    const where = (e.instancePath || "/").slice(1).replace(/\//g, ".");
    return missing ? `${where ? where + "." : ""}${missing} is required` : `${where || "body"} ${e.message}`;
  });
}
