#!/bin/sh
# Regenerates the README media in docs/screenshots/ from a fictional group:
# seeds it into its own database (dividir_showcase) through the real server actions,
# builds and starts the production server on :3300, captures, and stops the server.
# Needs the dev Postgres (`docker compose up -d db`), Chromium for Playwright and ffmpeg.
# It shares .next-e2e with the E2E suite: do not run both at once.
set -eu
PORT=3300
export NEXT_DIST_DIR=.next-e2e

npx vitest run --config vitest.showcase.config.ts
npx prisma generate
npx next build
rm -rf .next-e2e/standalone/.next-e2e/static
cp -r .next-e2e/static .next-e2e/standalone/.next-e2e/static

DATABASE_URL=postgresql://dividir:dividir@localhost:5433/dividir_showcase PORT=$PORT HOSTNAME=127.0.0.1 \
  node .next-e2e/standalone/server.js &
SERVER=$!
trap 'kill $SERVER' EXIT
until curl -sf "http://127.0.0.1:$PORT/" >/dev/null; do sleep 0.5; done

node --experimental-strip-types tests/showcase/capture.ts docs/screenshots
