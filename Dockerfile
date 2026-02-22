# Both stages use identical Alpine version to ensure better-sqlite3
# native bindings compiled in builder are compatible at runtime
FROM node:20-alpine3.20 AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Runner stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine3.20 AS runner

WORKDIR /app

# Ensure /app and /data are owned by node before switching user
RUN chown node:node /app && mkdir -p /data && chown node:node /data

# Run as non-root user
USER node

COPY --chown=node:node package*.json ./

# Install production deps fresh in runner (do NOT copy node_modules from builder
# — better-sqlite3 is a native addon and must be compiled for this environment)
RUN npm ci --omit=dev

COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node src/db/schema.sql ./dist/db/schema.sql

EXPOSE 3000

CMD ["node", "dist/index.js"]
