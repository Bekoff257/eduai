import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";

const db = new PGlite({ extensions: { pgcrypto } });

// Discover migrations by directory listing (sorted, since Supabase migration
// filenames are timestamp-prefixed) rather than a hardcoded list, so a new
// migration file is picked up automatically instead of silently skipped.
const files = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => `supabase/migrations/${name}`);

// Minimal stub of Supabase's auth schema (auth.users table + auth.uid())
// so the migrations (which reference auth.users and auth.uid()) can be
// applied structurally. Real signature verification, session/cookie
// handling, and role resolution only exist in actual Supabase/GoTrue —
// this only proves the SQL itself is valid.
await db.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    instance_id uuid,
    aud text,
    role text,
    email text,
    encrypted_password text,
    email_confirmed_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz
  );
  create or replace function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role;
    end if;
  end $$;
`);

for (const file of files) {
  const sql = readFileSync(file, "utf8");
  console.log(`\n=== Applying ${file} ===`);
  try {
    await db.exec(sql);
    console.log(`OK: ${file}`);
  } catch (err) {
    console.error(`FAILED: ${file}`);
    console.error(err.message ?? err);
    process.exit(1);
  }
}

console.log("\n=== Applying seed.sql ===");
try {
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  console.log("OK: seed.sql");
} catch (err) {
  console.error("FAILED: seed.sql");
  console.error(err.message ?? err);
  process.exit(1);
}

const orgs = await db.query("select count(*)::int as n from organizations");
const members = await db.query("select count(*)::int as n from organization_members");
const leads = await db.query("select count(*)::int as n from leads");
console.log("\nRow counts:", { orgs: orgs.rows[0].n, members: members.rows[0].n, leads: leads.rows[0].n });

console.log("\nAll migrations + seed applied successfully (structural smoke test only — RLS role-switching semantics not validated by pglite).");
