import { createInterface } from "node:readline/promises";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "../lib/auth/password";
import { writePlatformAuditLog } from "../lib/db/audit";

function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("Run this command in an interactive terminal so the password can be entered without echo."));
  }

  process.stdout.write(prompt);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (byte === 13 || byte === 10) {
          cleanup();
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32) value += String.fromCharCode(byte);
      }
    };
    input.on("data", onData);
  });
}

async function main() {
  loadEnvConfig(process.cwd());
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const displayName = (await readline.question("First administrator name: ")).trim();
  const email = (await readline.question("First administrator email: ")).trim().toLowerCase();
  readline.close();

  if (!displayName || displayName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Enter a valid name and email address.");
  }

  const password = await readSecret("Password (12–128 characters): ");
  if (password.length < 12 || password.length > 128) {
    throw new Error("The password must be between 12 and 128 characters.");
  }
  const confirmation = await readSecret("Confirm password: ");
  if (password !== confirmation) throw new Error("The passwords do not match.");

  const passwordHash = await hashPassword(password);
  const { appPool, _adminPoolInternal } = await import("../lib/db/pool");
  const client = await _adminPoolInternal.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["nexus-mis-first-platform-admin"]);
    const { rows: countRows } = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM platform_admins"
    );
    if (Number(countRows[0]?.count ?? 0) !== 0) {
      await client.query("ROLLBACK");
      throw new Error("A platform administrator already exists. This bootstrap command only runs once on an empty installation.");
    }

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO platform_admins (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [email, displayName, passwordHash]
    );
    const adminId = rows[0].id;
    await writePlatformAuditLog(client, {
      platformAdminId: adminId,
      action: "platform_admin.bootstrapped",
      entityType: "platform_admin",
      entityId: adminId,
      newState: { id: adminId, email, display_name: displayName, is_active: true },
      context: { bootstrap: true },
    });
    await client.query("COMMIT");
    process.stdout.write(`Created the initial platform administrator for ${email}.\n`);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await Promise.all([appPool.end(), _adminPoolInternal.end()]);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Bootstrap failed."}\n`);
  process.exitCode = 1;
});
