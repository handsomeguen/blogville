# Blogville

티스토리 같은 블로그 서비스 **Blogville**의 소스 코드 저장소입니다 (Next.js 16 · PostgreSQL · Drizzle).

요구사항 명세서, 기능별 spec·plan·tasks(`specs/`), 프로젝트 원칙(constitution)은 문서 저장소 [handsomeguen/docs](https://github.com/handsomeguen/docs)에 있습니다. 코드 주석의 `specs/0xx-...`는 그 저장소의 `docs/specs/` 폴더를 가리킵니다.

| 경로 | 내용 |
|---|---|
| `src/` | Next.js 앱 (화면, Server Action, 서버 로직) |
| `drizzle/` | DB 마이그레이션 |
| `tests/` | Vitest 단위 테스트, Playwright E2E, 성능 측정 |
| `scripts/` | 시드, 관리자 만들기, 정리 작업 |

## 실행

Node.js 22, PostgreSQL 16이 필요합니다.

```bash
cp .env.example .env.local     # BETTER_AUTH_SECRET은 긴 무작위 값으로 바꾼다
docker compose up -d db        # 또는 로컬 PostgreSQL에 blogville DB를 만든다
npm install
npm run db:migrate
npm run db:seed                # (선택) demo / demo1234, /@demo
npm run admin:create           # (선택) .env.local의 ADMIN_USERNAME·ADMIN_PASSWORD로 관리자와 /@notice
npm run dev                    # http://localhost:3000
```

## 확인

```bash
npm run typecheck
npm run lint
npm test                       # Vitest 단위 테스트
npm run test:e2e               # Playwright E2E (개발 서버를 띄우거나 자동으로 띄운다)
npm run test:perf              # 글 1,000개 블로그 홈 응답 시간 (서버를 먼저 띄운다, 기준 1초)
```

미리 설치된 Chromium을 쓰려면 `PW_CHROMIUM_PATH=/경로/chrome npm run test:e2e`.
E2E는 `.env.local`의 DB에 고유한 아이디로 회원을 만들어 시험합니다.

## 첨부 파일

올린 사진·파일은 `storage/uploads/`(git 제외, `UPLOAD_DIR`로 바꿈)에 저장됩니다.
어느 글에도 붙지 않은 지 하루 지난 첨부는 정리 작업이 지웁니다. 같은 작업이 어제보다 오래된 조회 기록, 만료된 로그인 세션, 하루 넘게 지난 로그인 실패 기록(잠금 중인 것은 남김)도 지웁니다. 자동 실행 설정은 없어서 하루에 한 번 손으로 돌립니다.

```bash
npm run posts:cleanup -- --dry-run   # 지울 개수만
npm run posts:cleanup
```

## 배포 (도커, 포트 8400, 무중단)

`main`에 올라오면 GitHub Actions(`.github/workflows/deploy.yml`)가 도커 이미지를 만들어 서버에 올리고, SSH로 `deploy/run.sh`를 실행합니다. 손으로 돌리려면 Actions 탭의 **deploy → Run workflow**를 누릅니다.

- 저장소 시크릿: `SSH_ADDRESS`, `SSH_PORT`, `SSH_ID`, `SSH_PASSWORD`, `DB_ADDRESS`, `DB_PORT`, `DB_NAME`, `DB_SCHEMA`, `DB_USERNAME`, `DB_PASSWORD`, (선택) `APP_URL`
- `APP_URL`이 없으면 `http://SSH_ADDRESS:8400`을 로그인 주소로 씁니다. 도메인·https를 붙이면 `APP_URL`을 그 주소로 등록합니다.
- 서버에는 docker가 있어야 하고, SSH 계정이 docker를 쓸 수 있어야 합니다(docker 그룹 또는 비밀번호 없는 sudo).
- 무중단 배포(블루·그린): 8400 포트는 nginx 컨테이너(`blogville-proxy`)가 받고, 앱은 `blogville-blue`(127.0.0.1:8401)와 `blogville-green`(127.0.0.1:8402) 중 한쪽에서 돕니다. 새 버전은 쉬는 쪽에 띄워 응답을 확인한 뒤 nginx를 reload해 넘기고, 이전 쪽은 10초 기다렸다가 끕니다. 새 버전이 뜨지 않으면 이전 버전이 그대로 서비스합니다.
- 앱 컨테이너는 시작할 때 `scripts/migrate.mjs`(drizzle 마이그레이터, 실패하면 DB 오류를 그대로 보여 줌)로 DB를 맞춘 뒤 `next start`로 뜹니다. 이전 버전이 도는 동안 마이그레이션이 먼저 적용되므로, 마이그레이션은 이전 버전이 계속 돌 수 있게(열·표 추가 위주) 씁니다.
- 서버의 `~/blogville/`에 로그인 비밀키(`auth-secret`, 처음 한 번 생성), 환경 변수(`app.env`), 올린 파일(`uploads/`), nginx 설정(`nginx/`), 지금 쓰는 쪽(`active`)이 남습니다.
- 표는 `DB_SCHEMA` 스키마 안에만 만듭니다(스키마를 새로 만들지 않음). `scripts/migrate.mjs`가 SQL의 `"public".`을 그 스키마로 바꿔 적용합니다.
