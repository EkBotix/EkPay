import EmbeddedPostgres from "embedded-postgres";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
export async function withPostgres(run) {
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const directory = await mkdtemp(join(tmpdir(), "ekpay-phase3-test-"));
  const cluster = new EmbeddedPostgres({
    databaseDir: directory,
    port,
    user: "postgres",
    password: randomBytes(32).toString("hex"),
    persistent: true,
    // PostgreSQL 18 async I/O workers can retain inherited pipes after Windows
    // force-stop; synchronous fixture I/O avoids orphan workers/hanging test exit.
    postgresFlags: ["-h", "127.0.0.1", "-c", "io_method=sync"],
    onLog: () => {},
    onError: () => {},
  });
  const clients = [];
  let started = false;
  async function connect() {
    const c = cluster.getPgClient("postgres", "127.0.0.1");
    await c.connect();
    clients.push(c);
    await c.query("SET statement_timeout='10s'; SET timezone='UTC'");
    return c;
  }
  try {
    await cluster.initialise();
    await cluster.start();
    started = true;
    const db = await connect();
    await db.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;`);
    const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(migrationDir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.query(await readFile(new URL(file, migrationDir), "utf8"));
    await run({ db, connect });
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()));
    if (started) await cluster.stop();
    const target = resolve(directory);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep) &&
        target.split(sep).at(-1).startsWith("ekpay-phase3-test-"),
    );
    await rm(target, { recursive: true, force: true });
  }
}
