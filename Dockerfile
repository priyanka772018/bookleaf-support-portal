# Single image: builds the React client, then runs the Express API which also serves it.
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
EXPOSE 4000
# Migrations + idempotent seeding run on boot (AUTO_MIGRATE=false to disable).
CMD ["node", "src/server.js"]
