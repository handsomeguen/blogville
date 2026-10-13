// 운영 컨테이너가 시작할 때 쓰는 DB 마이그레이션 (Dockerfile CMD).
// drizzle/ 폴더의 SQL을 차례로 적용하고, 실패하면 DB 오류 코드와 문구를 그대로 보여 준다.
//
// DATABASE_URL에 ?search_path=스키마 가 있으면 그 스키마 하나만 쓴다 (발급받은 DB처럼 public·새 스키마를 못 만드는 계정).
// - 생성된 SQL이 박아 둔 "public". 을 그 스키마로 바꿔 적용한다
// - 적용 기록 표(__drizzle_migrations)도 drizzle 스키마 대신 그 스키마에 둔다
// 기록 표의 모양(id, hash, created_at)과 판단 기준(created_at)은 drizzle-kit migrate와 같다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("마이그레이션 실패: DATABASE_URL이 없어요.");
  process.exit(1);
}
const schema = new URL(url).searchParams.get("search_path")?.split(",")[0].trim() || "";
const target = schema && schema !== "public" ? schema : "";
if (target && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
  console.error(`마이그레이션 실패: 스키마 이름을 쓸 수 없어요: ${target}`);
  process.exit(1);
}
const recordSchema = target || "drizzle";
const table = `"${recordSchema}"."__drizzle_migrations"`;

const folder = path.resolve("drizzle");
const journal = JSON.parse(readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
const migrations = journal.entries.map((entry) => {
  const raw = readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
  const query = target ? raw.replaceAll('"public".', `"${target}".`) : raw;
  return {
    tag: entry.tag,
    when: entry.when,
    // 기록에는 원래 파일의 해시를 남긴다 (drizzle-kit migrate와 같게)
    hash: createHash("sha256").update(raw).digest("hex"),
    statements: query.split("--> statement-breakpoint").filter((s) => s.trim()),
  };
});

const sql = postgres(url, { max: 1, onnotice: () => {} });
let current = "";
try {
  // 쓸 수 있는 스키마에만 만든다. 이미 있으면 CREATE 권한 없이도 지나간다
  const [{ exists }] = await sql`select exists(select 1 from pg_namespace where nspname = ${recordSchema}) as exists`;
  if (!exists) await sql.unsafe(`CREATE SCHEMA "${recordSchema}"`);
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${table} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
  const [last] = await sql.unsafe(`select created_at from ${table} order by created_at desc limit 1`);
  const done = last ? Number(last.created_at) : -1;
  const pending = migrations.filter((m) => m.when > done);
  await sql.begin(async (tx) => {
    for (const m of pending) {
      current = m.tag;
      for (const statement of m.statements) await tx.unsafe(statement);
      await tx.unsafe(`insert into ${table} (hash, created_at) values ($1, $2)`, [m.hash, m.when]);
    }
  });
  console.log(`마이그레이션 완료 (스키마 ${target || "public"}, 새로 적용 ${pending.length}개)`);
} catch (e) {
  const c = e.cause ?? e;
  console.error(`마이그레이션 실패${current ? ` (${current})` : ""}:`, c.code ?? "", c.message);
  if (c.detail) console.error("자세히:", c.detail);
  if (c.hint) console.error("도움말:", c.hint);
  if (c.query) console.error("문장:", String(c.query).slice(0, 300));
  process.exitCode = 1;
} finally {
  await sql.end();
}
