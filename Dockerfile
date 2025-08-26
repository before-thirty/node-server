# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Install dependencies (including Prisma client generation)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# Remove dev dependencies to reduce final image size
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5001

# System deps needed by Prisma (OpenSSL 3)
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy production node_modules and build output
COPY --from=deps /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

# Ensure Prisma Client is generated for this exact runtime (openssl 3)
RUN npx prisma generate

# Default port for the HTTP + Socket.IO server
EXPOSE 5001

# Simple healthcheck against the app's health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]


