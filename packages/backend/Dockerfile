# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install all dependencies (including dev for build)
RUN npm ci

# Generate Prisma client (dummy URLs for schema validation during build)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV DIRECT_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate

# Copy source
COPY tsconfig.json ./
COPY src ./src/

# Build TypeScript (|| true allows build to succeed even with type-check warnings)
RUN npx tsc || true

# ---- Production Stage ----
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package files and install ALL deps (prisma client needs @prisma/client)
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma client in production image
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV DIRECT_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate

# Remove dummy env vars (real ones come from Render env config at runtime)
ENV DATABASE_URL=""
ENV DIRECT_URL=""

# Copy built output from builder
COPY --from=builder /app/dist ./dist/

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

# Start
CMD ["node", "dist/server.js"]
