# syntax=docker/dockerfile:1

FROM node:22-alpine AS dependencies

WORKDIR /app
RUN apk add --no-cache g++ make python3
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build -- --webpack
RUN npm prune --omit=dev

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001

RUN addgroup -S -g 984 starwebbot \
    && adduser -S -D -H -u 988 -G starwebbot starwebbot \
    && mkdir -p /app/data /opt/star-webbot/shared/data \
    && chown -R 988:984 /app /opt/star-webbot

COPY --from=builder --chown=988:984 /app/.next ./.next
COPY --from=builder --chown=988:984 /app/node_modules ./node_modules
COPY --from=builder --chown=988:984 /app/package.json /app/package-lock.json /app/next.config.ts ./
COPY --from=builder --chown=988:984 /app/public ./public

USER 988:984
EXPOSE 3001

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3001"]
