#!/bin/sh
# The E2E server is the production build, made and started the way the Dockerfile
# does it (generate, build, standalone server with its static assets), in its own
# dist dir so it never collides with `next dev`. Playwright runs it (webServer).
set -eu
export NEXT_DIST_DIR=.next-e2e
npx prisma generate
npx next build
cp -r .next-e2e/static .next-e2e/standalone/.next-e2e/static
exec node .next-e2e/standalone/server.js
