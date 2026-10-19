# Builds and runs the backend only (see railway.toml).

# Build stage: needs devDependencies for tsc.
FROM node:20-alpine AS build
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --ignore-scripts

COPY backend/ ./
RUN npm run build

# Runtime stage: production dependencies and compiled output only.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3001

CMD ["node", "dist/index.js"]
