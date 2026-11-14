FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY src ./src
COPY scripts ./scripts
COPY docs ./docs
COPY server.js ./
COPY public ./public
FROM dependencies AS migration
USER node
CMD ["npx", "prisma", "migrate", "deploy"]
FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=production-dependencies --chown=node:node /app /app
RUN mkdir -p storage/complaints public/uploads/profile-photos && chown -R node:node storage public
ENV NODE_ENV=production PORT=8080 TZ=Asia/Bangkok
USER node
EXPOSE 8080
CMD ["node", "server.js"]
