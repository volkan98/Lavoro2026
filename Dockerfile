# Multi-stage Dockerfile optimized for Google Cloud Run
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build client + server bundle
COPY . .
RUN npm run build

# Production runtime container
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled distribution artifacts and runtime configurations
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json
COPY --from=builder /app/metadata.json ./metadata.json

# Cloud Run defaults to port 8080
EXPOSE 8080

CMD ["node", "dist/server.cjs"]
