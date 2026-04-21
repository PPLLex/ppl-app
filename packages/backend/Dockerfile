# ---- Build Stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install all dependencies (including dev for build)
# Use npm install instead of npm ci — lock file may be stale after API pushes
RUN npm install

# Generate Prisma client (dummy URLs for schema validation during build)
ENV DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public"
ENV DIRECT_URL="postgresql://user:pass@host:5432/db"
RUN npx prisma generate

# Copy source
COPY tsconfig.json ./
COPY src ./src/

# Build TypeScript — fail the build if tsc fails
RUN npx tsc
RUN ls -la dist/server.js dist/app.js

# ---- Production Stage ----
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package files and install production deps (includes prisma CLI now)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy Prisma schema + generated client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

# Copy built output from builder
COPY --from=builder /app/dist ./dist/

# Copy startup script
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-4000}/api/health || exit 1

# Start via shell script (proper error handling + logging)
CMD ["./start.sh"]
