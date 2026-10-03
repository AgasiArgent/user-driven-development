/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  // The intake validates against ../contracts/feedback-report.schema.json, outside this package.
  experimental: { externalDir: true },
};

export default config;
