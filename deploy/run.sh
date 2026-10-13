#!/usr/bin/env bash
# 서버에서 Blogville 도커 이미지를 불러와 8400번 포트로 무중단 배포한다 (블루·그린).
# GitHub Actions(.github/workflows/deploy.yml)가 이미지 파일과 이 스크립트를 올린 뒤 SSH로 부른다.
#
# 구조
#   blogville-proxy  nginx. 8400 포트를 받아 지금 쓰는 쪽 앱으로 넘긴다
#   blogville-blue   앱 (127.0.0.1:8401)
#   blogville-green  앱 (127.0.0.1:8402)
# 새 버전은 쉬고 있는 쪽에 띄우고, 응답하면 nginx를 다시 읽혀(reload) 넘긴 뒤 이전 쪽을 끈다.
# 새 버전이 뜨지 않으면 이전 버전이 그대로 서비스한다.
#
# 받는 환경 변수
#   DATABASE_URL  (필수) postgres://아이디:비밀번호@주소:포트/DB이름?search_path=스키마
#   IMAGE         (필수) 불러올 이미지 이름:태그 (예: blogville:1a2b3c4)
#   PROXY_IMAGE   (선택) nginx 이미지. 기본 nginx:1.27-alpine
#   APP_URL       (선택) 사용자가 여는 주소. 없으면 http://<서버 주소>:8400
#   DEPLOY_DIR    (선택) 기본 ~/blogville
#
# 서버에 남는 것 (DEPLOY_DIR 아래)
#   auth-secret   처음 한 번 만든 로그인 비밀키. 지우면 모든 로그인이 풀린다
#   app.env       컨테이너 환경 변수 (권한 600)
#   uploads/      올린 사진·파일
#   nginx/        nginx 설정 (지금 쓰는 쪽 포트)
#   active        지금 쓰는 쪽 (blue 또는 green)
set -euo pipefail

PORT=8400
PROXY=blogville-proxy
PROXY_IMAGE="${PROXY_IMAGE:-nginx:1.27-alpine}"
DEPLOY_DIR="${DEPLOY_DIR:-$HOME/blogville}"
TAR="$DEPLOY_DIR/blogville-image.tar.gz"
PROXY_TAR="$DEPLOY_DIR/proxy-image.tar.gz"

: "${DATABASE_URL:?DATABASE_URL이 없어요}"
: "${IMAGE:?IMAGE가 없어요}"

# docker 권한이 없으면 sudo(비밀번호 없이)로 쓴다
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    DOCKER=(sudo -n docker)
  else
    echo "docker를 쓸 수 없어요. 서버에 docker를 설치하고 이 계정을 docker 그룹에 넣어 주세요." >&2
    exit 1
  fi
fi

port_of() { [ "$1" = blue ] && echo 8401 || echo 8402; }
running() { [ "$("${DOCKER[@]}" inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }
# 같은 서버 네트워크를 쓰므로 컨테이너 안에서 127.0.0.1로 주소를 열어 본다
answers() { "${DOCKER[@]}" exec "$1" node -e "fetch('$2').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" 2>/dev/null; }

mkdir -p "$DEPLOY_DIR/uploads" "$DEPLOY_DIR/nginx"
# 컨테이너는 node(1000) 계정으로 돈다
chmod 777 "$DEPLOY_DIR/uploads" 2>/dev/null || true

if [ ! -s "$DEPLOY_DIR/auth-secret" ]; then
  (umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$DEPLOY_DIR/auth-secret")
fi

if [ -z "${APP_URL:-}" ]; then
  APP_URL="http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"
fi

(umask 077 && cat > "$DEPLOY_DIR/app.env" <<EOF
DATABASE_URL=$DATABASE_URL
BETTER_AUTH_SECRET=$(cat "$DEPLOY_DIR/auth-secret")
BETTER_AUTH_URL=$APP_URL
UPLOAD_DIR=storage/uploads
EOF
)

echo "이미지 불러오기: $IMAGE"
gunzip -c "$TAR" | "${DOCKER[@]}" load
if ! "${DOCKER[@]}" image inspect "$PROXY_IMAGE" >/dev/null 2>&1; then
  if [ -s "$PROXY_TAR" ]; then
    gunzip -c "$PROXY_TAR" | "${DOCKER[@]}" load
  else
    "${DOCKER[@]}" pull "$PROXY_IMAGE"
  fi
fi
rm -f "$PROXY_TAR"

# drizzle-kit migrate는 접속 오류를 보여 주지 않아서, 띄우기 전에 DB 접속을 따로 확인한다
echo "DB 접속 확인"
if ! "${DOCKER[@]}" run --rm --network host --env-file "$DEPLOY_DIR/app.env" "$IMAGE" node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });
sql`select current_user, current_schema(), version()`
  .then(([r]) => { console.log("DB 접속 됨:", r.current_user, "/ 스키마", r.current_schema, "/", r.version.split(" on ")[0]); return sql.end(); })
  .catch((e) => { console.error("DB 접속 실패:", e.code || "", e.message); process.exit(1); });
'; then
  echo "DB에 접속하지 못해 배포를 멈춰요. 위 오류를 보고 DB 시크릿(주소·포트·DB 이름·아이디·DB_PASSWORD)을 확인해 주세요." >&2
  exit 1
fi

# 지금 쓰는 쪽과 새로 띄울 쪽
ACTIVE="$(cat "$DEPLOY_DIR/active" 2>/dev/null || true)"
if [ "$ACTIVE" != blue ] && [ "$ACTIVE" != green ]; then ACTIVE=""; fi
if [ -n "$ACTIVE" ] && ! running "blogville-$ACTIVE"; then ACTIVE=""; fi
NEXT=blue
[ "$ACTIVE" = blue ] && NEXT=green
NEXT_PORT="$(port_of "$NEXT")"
NEW="blogville-$NEXT"

# 도커 기본 네트워크(bridge)에서는 이 서버의 공인 IP(DB)로 가는 길이 막혀 있어서(EHOSTUNREACH)
# 서버 네트워크를 그대로 쓴다. 앱은 서버 밖에서 열리지 않게 127.0.0.1에만 연다
echo "새 버전 실행: $NEW (127.0.0.1:$NEXT_PORT)"
"${DOCKER[@]}" rm -f "$NEW" >/dev/null 2>&1 || true
"${DOCKER[@]}" run -d \
  --name "$NEW" \
  --restart unless-stopped \
  --env-file "$DEPLOY_DIR/app.env" \
  -e PORT="$NEXT_PORT" \
  --network host \
  -v "$DEPLOY_DIR/uploads:/app/storage/uploads" \
  "$IMAGE" sh -c "node scripts/migrate.mjs && exec npx next start -H 127.0.0.1 -p $NEXT_PORT" >/dev/null

# 마이그레이션을 마치고 새 버전이 응답할 때까지 기다린다 (최대 2분). 그동안 이전 버전이 서비스한다
ok=""
for _ in $(seq 1 60); do
  running "$NEW" || break
  if answers "$NEW" "http://127.0.0.1:$NEXT_PORT/"; then ok=1; break; fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "새 버전이 뜨지 않았어요. 이전 버전(${ACTIVE:-없음})을 그대로 둬요. 새 버전 로그:" >&2
  "${DOCKER[@]}" logs --tail 50 "$NEW" >&2 || true
  "${DOCKER[@]}" rm -f "$NEW" >/dev/null 2>&1 || true
  exit 1
fi
echo "새 버전이 응답해요"

# nginx가 새 쪽으로 넘기게 한다
(umask 022 && cat > "$DEPLOY_DIR/nginx/.next.conf" <<EOF
# deploy/run.sh가 배포마다 다시 쓴다. 지금 쓰는 쪽: $NEXT
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  ''      close;
}
server {
  listen $PORT;
  # 첨부 한도(31MB)보다 조금 크게
  client_max_body_size 32m;
  location / {
    proxy_pass http://127.0.0.1:$NEXT_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$http_host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$connection_upgrade;
    proxy_read_timeout 300s;
  }
}
EOF
)
CONF="$DEPLOY_DIR/nginx/default.conf"
[ -f "$CONF" ] && cp -f "$CONF" "$DEPLOY_DIR/nginx/.prev.conf"
mv -f "$DEPLOY_DIR/nginx/.next.conf" "$CONF"

if running "$PROXY"; then
  # reload는 이미 받은 요청을 끝까지 처리하고 새 요청부터 새 쪽으로 보낸다
  if ! "${DOCKER[@]}" exec "$PROXY" nginx -t >/dev/null 2>&1 || ! "${DOCKER[@]}" exec "$PROXY" nginx -s reload; then
    echo "nginx 설정을 바꾸지 못했어요. 새 버전을 지우고 이전 버전을 그대로 둬요." >&2
    "${DOCKER[@]}" exec "$PROXY" nginx -t >&2 || true
    mv -f "$DEPLOY_DIR/nginx/.prev.conf" "$CONF" 2>/dev/null || true
    "${DOCKER[@]}" rm -f "$NEW" >/dev/null 2>&1 || true
    exit 1
  fi
else
  # 처음 한 번: 예전 방식 컨테이너(blogville)가 8400을 쓰고 있으면 비키고 nginx를 띄운다 (몇 초 끊김)
  "${DOCKER[@]}" rm -f blogville "$PROXY" >/dev/null 2>&1 || true
  echo "nginx 실행 (포트 $PORT)"
  "${DOCKER[@]}" run -d \
    --name "$PROXY" \
    --restart unless-stopped \
    --network host \
    -v "$DEPLOY_DIR/nginx:/etc/nginx/conf.d:ro" \
    "$PROXY_IMAGE" >/dev/null
fi
echo "$NEXT" > "$DEPLOY_DIR/active"

# 8400으로 들어온 요청이 새 버전에 닿는지 확인
ok=""
for _ in $(seq 1 15); do
  if answers "$NEW" "http://127.0.0.1:$PORT/"; then ok=1; break; fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "8400 포트가 응답하지 않아요. nginx 로그:" >&2
  "${DOCKER[@]}" logs --tail 30 "$PROXY" >&2 || true
  exit 1
fi

# 이전 버전은 받은 요청을 마칠 시간을 주고 끈다
if [ -n "$ACTIVE" ]; then
  echo "이전 버전 끄기: blogville-$ACTIVE"
  sleep 10
  "${DOCKER[@]}" stop -t 30 "blogville-$ACTIVE" >/dev/null 2>&1 || true
  "${DOCKER[@]}" rm -f "blogville-$ACTIVE" >/dev/null 2>&1 || true
fi
"${DOCKER[@]}" rm -f blogville >/dev/null 2>&1 || true

echo "배포 완료: $APP_URL ($NEXT)"
rm -f "$TAR"
# 지금 쓰는 것 말고 남은 blogville 이미지는 지운다
"${DOCKER[@]}" images blogville --format '{{.Repository}}:{{.Tag}}' | grep -vx "$IMAGE" | xargs -r "${DOCKER[@]}" rmi >/dev/null 2>&1 || true
