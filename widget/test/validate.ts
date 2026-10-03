import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../contracts/feedback-report.schema.json";

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const check = ajv.compile(schema);

/** Returns schema error messages; empty array means the report is valid. */
export function validateReport(report: unknown): string[] {
  return check(report) ? [] : (check.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}
