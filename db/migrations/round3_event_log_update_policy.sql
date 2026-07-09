CREATE POLICY tenant_isolation_update ON event_execution_log
    FOR UPDATE
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
