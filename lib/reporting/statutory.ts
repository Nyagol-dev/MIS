import { withTenantContext } from '@/lib/db/withTenant';

export async function generateMOH705AReport(tenantId: string, startDate: Date, endDate: Date, generatedBy: string) {
  return await withTenantContext(tenantId, async (client) => {
    // MOH 705A: Outpatient Summary for under 5 years
    // Mock implementation for aggregate DHIS2-style reporting
    const res = await client.query(
      `SELECT count(*) as total_visits 
       FROM encounters 
       WHERE tenant_id = current_tenant_id()
       AND status = 'completed'
       AND created_at >= $1 AND created_at <= $2`,
      [startDate, endDate]
    );

    // Log the generation of the report
    await client.query(
      `INSERT INTO statutory_reports_log (tenant_id, report_type, period_start, period_end, generated_by)
       VALUES (current_tenant_id(), 'MOH_705A', $1, $2, $3)`,
      [startDate, endDate, generatedBy]
    );

    return {
      reportType: 'MOH_705A',
      period: { start: startDate, end: endDate },
      metrics: {
        totalOutpatientVisitsUnder5: parseInt(res.rows[0].total_visits, 10),
      }
    };
  });
}
