import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

const migrationDir = path.join(process.cwd(), 'db', 'migrations');
const baselineMode = process.argv.includes('--baseline-existing');
const connectionString = process.env.DATABASE_URL_ADMIN;

if (!connectionString) {
  throw new Error('DATABASE_URL_ADMIN is required to run migrations.');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: true },
  max: 1,
});

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

async function main(): Promise<void> {
  const names = (await readdir(migrationDir))
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const files = await Promise.all(names.map(async (name) => ({
    name,
    sql: await readFile(path.join(migrationDir, name), 'utf8'),
  })));
  const client = await pool.connect();

  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');

    if (baselineMode) {
      await client.query('BEGIN');
      for (const migration of files) {
        await client.query(
          'INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
          [migration.name, sha256(migration.sql)],
        );
      }
      await client.query('COMMIT');
      process.stdout.write(`Recorded ${files.length} migration checksums as an operator-verified baseline. No SQL migrations were run.\n`);
      return;
    }

    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 77821))', ['mis-schema-migrations']);
    const applied = await client.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM schema_migrations');
    const appliedMap = new Map(applied.rows.map((row) => [row.name, row.sha256]));

    for (const migration of files) {
      const checksum = sha256(migration.sql);
      const priorChecksum = appliedMap.get(migration.name);
      if (priorChecksum) {
        if (priorChecksum !== checksum) throw new Error(`Applied migration was modified: ${migration.name}`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)', [migration.name, checksum]);
        await client.query('COMMIT');
        process.stdout.write(`Applied ${migration.name}\n`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
