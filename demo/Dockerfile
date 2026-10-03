# Build context is the repository root (see docker-compose.yml).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY widget/package.json widget/
COPY demo/package.json demo/
RUN npm ci
COPY contracts contracts
COPY widget widget
COPY demo demo
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w demo

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
COPY --from=build /app/demo/.next/standalone ./
COPY --from=build /app/demo/.next/static ./demo/.next/static
COPY --from=build /app/demo/public ./demo/public
COPY --from=build /app/demo/db ./demo/db
COPY --from=build /app/demo/scripts/migrate.mjs ./demo/scripts/migrate.mjs
EXPOSE 3100
CMD ["sh", "-c", "node demo/scripts/migrate.mjs && node demo/server.js"]
