FROM node:20-alpine

# Only copy and build the backend subdirectory
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./

RUN npm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]
