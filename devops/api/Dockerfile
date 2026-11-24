# Build from the REPO ROOT:
#   docker build -f devops/api/Dockerfile -t pg-rent/api .
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# 1) Dependencies first, so this layer is cached until package.json changes.
COPY devops/api/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# 2) Application code — the SAME files the Vercel deployment runs, so there is
#    one source of truth for the API logic.
COPY frontend/api/_lib ./api/_lib
COPY devops/api/server.js ./server.js

# /data is only used by the optional local-file database (docker compose).
# With Turso configured nothing is written to disk.
RUN mkdir -p /data && chown -R node:node /data /app

# Numeric id (1000 = the image's "node" user) so Kubernetes can verify it is non-root.
USER 1000:1000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["sh", "-c", "wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1"]

CMD ["node", "server.js"]
