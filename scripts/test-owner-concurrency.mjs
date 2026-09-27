// Always starts a disposable loopback PostgreSQL cluster; accepts no remote URL.
import EmbeddedPostgres from "embedded-postgres";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";

const reservation = createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const directory = await mkdtemp(join(tmpdir(), "ekpay-owner-test-"));
const cluster = new EmbeddedPostgres({
  databaseDir: directory,
  port,
  user: "postgres",
  password: randomBytes(32).toString("hex"),
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
const clients = [];
async function connect() {
  const c = cluster.getPgClient("postgres", "127.0.0.1");
  await c.connect();
  clients.push(c);
  await c.query("SET statement_timeout='10s'");
  return c;
}
let started = false;
try {
  await cluster.initialise();
  await cluster.start();
  started = true;
  const admin = await connect(),
    a = await connect(),
    b = await connect();
  await admin.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;`);
  for (const file of [
    "20260927072955_init_ekpay_core.sql",
    "20260927082848_core_payment_security_infrastructure.sql",
    "20260927090644_auth_merchant_bootstrap_api_keys.sql",
  ])
    await admin.query(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  const original = (
    await admin.query(
      "SELECT pg_get_functiondef('public.ekpay_guard_last_owner()'::regprocedure) AS definition",
    )
  ).rows[0].definition;
  const users = [randomUUID(), randomUUID()];
  await admin.query(
    "INSERT INTO auth.users(id,email_confirmed_at) VALUES ($1,now()),($2,now())",
    users,
  );
  async function fixture(two = true) {
    const merchant = randomUUID();
    await admin.query(
      "INSERT INTO public.merchants(id,name,slug) VALUES ($1,'Concurrency',$2)",
      [merchant, "test-" + merchant],
    );
    for (const user of two ? users : users.slice(0, 1))
      await admin.query(
        "INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES ($1,$2,'owner')",
        [merchant, user],
      );
    return merchant;
  }
  async function owners(merchant) {
    return Number(
      (
        await admin.query(
          "SELECT count(*) n FROM public.merchant_members WHERE merchant_id=$1 AND role='owner'",
          [merchant],
        )
      ).rows[0].n,
    );
  }
  async function mutate(c, merchant, user, deletion) {
    return c.query(
      deletion
        ? "DELETE FROM public.merchant_members WHERE merchant_id=$1 AND user_id=$2"
        : "UPDATE public.merchant_members SET role='viewer' WHERE merchant_id=$1 AND user_id=$2",
      [merchant, user],
    );
  }
  for (const deletion of [false, true]) {
    const m = await fixture(false);
    await assert.rejects(
      mutate(admin, m, users[0], deletion),
      (e) => e.code === "23514",
    );
    assert.equal(await owners(m), 1);
  }
  const safe = await fixture();
  await admin.query("BEGIN");
  await mutate(admin, safe, users[0], false);
  await admin.query("ROLLBACK");
  assert.equal(await owners(safe), 2);
  await mutate(admin, safe, users[0], false);
  assert.equal(await owners(safe), 1);
  // Exercise least-privileged operational role, not only the cluster superuser.
  for (const c of [a, b]) await c.query("SET ROLE service_role");
  async function race(
    isolation,
    deletion,
    rollbackFirst = false,
    vulnerable = false,
  ) {
    const m = await fixture();
    await a.query("BEGIN ISOLATION LEVEL " + isolation);
    await b.query("BEGIN ISOLATION LEVEL " + isolation);
    // Establish both snapshots before either mutation.
    for (const c of [a, b])
      await c.query(
        "SELECT count(*) FROM public.merchant_members WHERE merchant_id=$1",
        [m],
      );
    await mutate(a, m, users[0], deletion);
    const second = mutate(b, m, users[1], deletion).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, code: error.code }),
    );
    // Prove Tx2 is waiting on Tx1; timing alone is not a concurrency barrier.
    const deadline = Date.now() + 5000;
    while (true) {
      const blocked = (
        await admin.query(
          "SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked",
          [a.processID, b.processID],
        )
      ).rows[0].blocked;
      if (blocked) break;
      assert.ok(Date.now() < deadline, "Tx2 did not block on Tx1");
      await new Promise((r) => setTimeout(r, 20));
    }
    await a.query(rollbackFirst ? "ROLLBACK" : "COMMIT");
    const result = await second;
    if (result.ok) await b.query("COMMIT");
    else await b.query("ROLLBACK");
    if (rollbackFirst || vulnerable) assert.ok(result.ok);
    else {
      assert.equal(result.ok, false);
      assert.equal(
        result.code,
        isolation === "READ COMMITTED" ? "23514" : "40001",
      );
    }
    assert.equal(await owners(m), vulnerable ? 0 : 1);
    return result;
  }
  // Regression control: the previous lock-only body really permits zero owners.
  await admin.query(
    original.replace(
      "UPDATE public.merchants SET updated_at=updated_at WHERE id=OLD.merchant_id;",
      "PERFORM 1 FROM public.merchants WHERE id=OLD.merchant_id FOR UPDATE;",
    ),
  );
  await race("REPEATABLE READ", false, false, true);
  await admin.query(original);
  console.log(
    "PASS: old lock-only REPEATABLE READ bug reproduced locally; fixed body restored.",
  );
  for (const isolation of [
    "READ COMMITTED",
    "REPEATABLE READ",
    "SERIALIZABLE",
  ]) {
    for (const deletion of [false, true]) {
      await race(isolation, deletion);
      await race(isolation, deletion, true);
    }
    console.log(
      `PASS: ${isolation}: concurrent demotion/deletion rejects second commit; rollback permits safe survivor.`,
    );
  }
  console.log(
    "PASS: last-owner deletion/demotion denied; two-owner demotion allowed; rollback restores two owners.",
  );
  console.log(
    "PostgreSQL: " +
      (await admin.query("SHOW server_version")).rows[0].server_version,
  );
} finally {
  await Promise.allSettled(clients.map((c) => c.end()));
  if (started) await cluster.stop();
  const target = resolve(directory),
    base = resolve(tmpdir()) + sep;
  assert.ok(
    target.startsWith(base) &&
      target.split(sep).at(-1).startsWith("ekpay-owner-test-"),
  );
  await rm(target, { recursive: true, force: true });
}
