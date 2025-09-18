# Multi-stage build for Node (TypeScript) + Python runtime

# 1) Build stage: compile TypeScript
FROM node:18-bullseye as builder
WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN npm ci

# Copy sources
COPY tsconfig.json ./
COPY src ./src

# Build TS and copy Python scripts to dist
RUN npm run build

# 2) Runtime stage: Node + Python
FROM node:18-bullseye

# Install Python 3 and pip
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy node deps (prod) and built app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# Copy Python requirements and install
COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Ensure uploads dir exists and is writable
RUN mkdir -p /data/uploads && chown -R node:node /data

ENV NODE_ENV=production \
    PORT=8080 \
    UPLOAD_DIR=/data/uploads

# Run as non-root
USER node

EXPOSE 8080

CMD ["node", "dist/server.js"]
