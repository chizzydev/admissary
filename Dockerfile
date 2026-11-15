FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 ADMISSARY_MODE=production ADMISSARY_PUBLIC_HTTPS=1
ENV ADMISSARY_SNAPSHOT_PATH=deploy/seed/demo-snapshot.json
ENV ADMISSARY_VERIFIER_MANIFEST_PATH=deploy/seed/verifier-manifest.json
ENV ADMISSARY_VERIFIER_CONTEXT_PATH=deploy/seed/deployment-context.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY scripts ./scripts
COPY web ./web
COPY deploy ./deploy
COPY data ./data
COPY results ./results
COPY migrations ./migrations
USER node
EXPOSE 4313
CMD ["node","scripts/admissary-web.mjs"]
