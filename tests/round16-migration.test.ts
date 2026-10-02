import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Pool } from 'pg';

describe('Round 16 Migration - Phase 3', () => {
  let pool: Pool;
  let tenantId: string;
  let adminId: string;

  before(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    // Create a tenant
    const orgRes = await pool.query(
      `INSERT INTO organizations (name, slug) VALUES ('Test Hospital 3', 'test-hospital-3') RETURNING id`
    );
    tenantId = orgRes.rows[0].id;
    
    // Create admin user
    const userRes = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, status) VALUES ($1, 'test-admin-3@example.com', 'hash', 'active') RETURNING id`,
      [tenantId]
    );
    adminId = userRes.rows[0].id;
  });

  after(async () => {
    if (tenantId) {
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [tenantId]);
    }
    await pool.end();
  });

  const runAsUser = async (userId: string, fn: (client: any) => Promise<void>) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = $1`, [tenantId]);
      await client.query(`SET LOCAL ROLE mis_app`);
      await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };

  it('allows inserting an order for the tenant', async () => {
    await runAsUser(adminId, async (client) => {
      const patientRes = await client.query(
        `INSERT INTO patients (tenant_id, first_name, last_name, dob, gender, created_by) VALUES ($1, 'John', 'Doe', '1990-01-01', 'Male', $2) RETURNING id`,
        [tenantId, adminId]
      );
      const patientId = patientRes.rows[0].id;

      const deptRes = await client.query(
        `INSERT INTO departments (tenant_id, name, type) VALUES ($1, 'Lab', 'clinical') RETURNING id`,
        [tenantId]
      );
      const deptId = deptRes.rows[0].id;

      const encRes = await client.query(
        `INSERT INTO encounters (tenant_id, patient_id, department_id, encounter_type, status, created_by) VALUES ($1, $2, $3, 'outpatient', 'planned', $4) RETURNING id`,
        [tenantId, patientId, deptId, adminId]
      );
      const encounterId = encRes.rows[0].id;

      const orderRes = await client.query(
        `INSERT INTO orders (tenant_id, patient_id, encounter_id, order_type, status, ordered_by) VALUES ($1, $2, $3, 'lab', 'draft', $4) RETURNING id`,
        [tenantId, patientId, encounterId, adminId]
      );
      assert.strictEqual(orderRes.rows.length, 1);
    });
  });
});
