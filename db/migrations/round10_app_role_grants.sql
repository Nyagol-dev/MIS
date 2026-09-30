-- Round 10: grant the least-privileged application role access to application
-- tables after all schema migrations. Tenant tables remain protected by RLS.

GRANT USAGE ON SCHEMA public TO mis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mis_app;

-- Platform identity and audit data are reserved for the mis_admin connection.
REVOKE ALL ON platform_admins FROM mis_app;
REVOKE ALL ON platform_audit_log FROM mis_app;
REVOKE ALL ON platform_audit_log_default FROM mis_app;
REVOKE ALL ON platform_admin_password_setup_tokens FROM mis_app;

-- These functions are narrowly scoped; the setup functions validate a random,
-- expiring token and only mutate the associated password once.
REVOKE ALL ON FUNCTION complete_user_password_setup(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_valid_user_password_setup_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_user_password_setup(TEXT, TEXT) TO mis_app;
GRANT EXECUTE ON FUNCTION is_valid_user_password_setup_token(TEXT) TO mis_app;
REVOKE ALL ON FUNCTION complete_platform_admin_password_setup(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_valid_platform_admin_password_setup_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_platform_admin_password_setup(TEXT, TEXT) TO mis_app;
GRANT EXECUTE ON FUNCTION is_valid_platform_admin_password_setup_token(TEXT) TO mis_app;

INSERT INTO permissions (codename, description, resource, action)
VALUES
    ('user:manage', 'Invite, update, and deactivate workspace users.', 'user', 'manage'),
    ('tenant:admin', 'Manage workspace roles and access controls.', 'tenant', 'manage')
ON CONFLICT (codename) DO NOTHING;
