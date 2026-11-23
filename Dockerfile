# Blogville 운영 이미지. GitHub Actions(.github/workflows/deploy.yml)가 만들고 서버에서 deploy/run.sh가 띄운다.
# 컨테이너는 시작할 때 DB 마이그레이션을 먼저 하고 8400번 포트로 서버를 연다.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
# GHCR 이미지를 저장소와 이어 준다(저장소 화면 Packages에 보임)
LABEL org.opencontainers.image.source=https://github.com/handsomeguen/blogville
WORKDIR /app
# 야후 시세 화면의 응답 헤더가 약 43KB라 Node 기본 상한(16KB)으로는 "fetch failed"(헤더 넘침)가 난다 → 64KB
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-http-header-size=65536 \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8400 \
    UPLOAD_DIR=storage/uploads
# 마이그레이션(drizzle-kit)과 정리 작업(tsx)도 컨테이너 안에서 돌리므로 node_modules를 통째로 가져온다
COPY --from=build /app ./
RUN mkdir -p storage/uploads && chown -R node:node storage
USER node
EXPOSE 8400
# 상태 확인: /api/health가 DB까지 닿는지 본다 (docker ps의 healthy/unhealthy, compose depends_on)
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["sh", "-c", "node scripts/migrate.mjs && exec npx next start -p ${PORT}"]
