-- Round 9: password onboarding for tenant users and persistent login throttling.
-- Apply as the database owner/migration role before deploying the application.

CREATE TABLE IF NOT EXISTS user_password_setup_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    user_id         UUID NOT NULL,
    token_hash      CHAR(64) NOT NULL UNIQUE,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_password_setup_tokens_expiry
    ON user_password_setup_tokens (expires_at)
    WHERE consumed_at IS NULL;

ALTER TABLE user_password_setup_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_all ON user_password_setup_tokens;
CREATE POLICY tenant_isolation_all ON user_password_setup_tokens
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS auth_login_attempts (
    scope_hash          CHAR(64) PRIMARY KEY,
    window_started_at   TIMESTAMPTZ NOT NULL,
    attempt_count       INTEGER NOT NULL CHECK (attempt_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_window
    ON auth_login_attempts (window_started_at);

REVOKE ALL ON auth_login_attempts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_login_attempts TO mis_app;

CREATE TABLE IF NOT EXISTS platform_admin_password_setup_tokens (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_admin_id   UUID NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
    token_hash          CHAR(64) NOT NULL UNIQUE,
    created_by          UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL,
    consumed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_setup_tokens_expiry
    ON platform_admin_password_setup_tokens (expires_at)
    WHERE consumed_at IS NULL;
REVOKE ALL ON platform_admin_password_setup_tokens FROM PUBLIC, mis_app;

CREATE OR REPLACE FUNCTION complete_user_password_setup(
    p_token_hash TEXT,
    p_password_hash TEXT
)
RETURNS TABLE (tenant_id UUID, user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    setup_tenant_id UUID;
    setup_user_id UUID;
    setup_token_id UUID;
BEGIN
    IF p_token_hash !~ '^[a-f0-9]{64}$'
       OR p_password_hash !~ '^\$argon2id\$'
       OR length(p_password_hash) > 512 THEN
        RETURN;
    END IF;

    SELECT t.id, t.tenant_id, t.user_id
      INTO setup_token_id, setup_tenant_id, setup_user_id
      FROM public.user_password_setup_tokens AS t
     WHERE t.token_hash = p_token_hash
       AND t.consumed_at IS NULL
       AND t.expires_at > now()
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- The token itself authorizes only this single tenant/user pair.
    PERFORM set_config('app.current_tenant_id', setup_tenant_id::TEXT, true);

    UPDATE public.users AS u
       SET password_hash = p_password_hash,
           updated_at = now()
     WHERE u.tenant_id = setup_tenant_id
       AND u.id = setup_user_id
       AND u.is_active = TRUE
       AND u.password_hash IS NULL;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE public.user_password_setup_tokens AS t
       SET consumed_at = now()
     WHERE t.id = setup_token_id;

    tenant_id := setup_tenant_id;
    user_id := setup_user_id;
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION is_valid_user_password_setup_token(p_token_hash TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT p_token_hash ~ '^[a-f0-9]{64}$'
       AND EXISTS (
           SELECT 1
             FROM public.user_password_setup_tokens AS t
            WHERE t.token_hash = p_token_hash
              AND t.consumed_at IS NULL
              AND t.expires_at > now()
       );
$$;

CREATE OR REPLACE FUNCTION complete_platform_admin_password_setup(
    p_token_hash TEXT,
    p_password_hash TEXT
)
RETURNS TABLE (platform_admin_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    setup_admin_id UUID;
    setup_token_id UUID;
BEGIN
    IF p_token_hash !~ '^[a-f0-9]{64}$'
       OR p_password_hash !~ '^\$argon2id\$'
       OR length(p_password_hash) > 512 THEN
        RETURN;
    END IF;

    SELECT t.id, t.platform_admin_id
      INTO setup_token_id, setup_admin_id
      FROM public.platform_admin_password_setup_tokens AS t
     WHERE t.token_hash = p_token_hash
       AND t.consumed_at IS NULL
       AND t.expires_at > now()
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE public.platform_admins AS a
       SET password_hash = p_password_hash,
           updated_at = now()
     WHERE a.id = setup_admin_id
       AND a.is_active = TRUE
       AND a.password_hash IS NULL;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE public.platform_admin_password_setup_tokens AS t
       SET consumed_at = now()
     WHERE t.id = setup_token_id;

    platform_admin_id := setup_admin_id;
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION is_valid_platform_admin_password_setup_token(p_token_hash TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT p_token_hash ~ '^[a-f0-9]{64}$'
       AND EXISTS (
           SELECT 1
             FROM public.platform_admin_password_setup_tokens AS t
            WHERE t.token_hash = p_token_hash
              AND t.consumed_at IS NULL
              AND t.expires_at > now()
       );
$$;

REVOKE ALL ON FUNCTION complete_user_password_setup(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_valid_user_password_setup_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_platform_admin_password_setup(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_valid_platform_admin_password_setup_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_user_password_setup(TEXT, TEXT) TO mis_app;
GRANT EXECUTE ON FUNCTION is_valid_user_password_setup_token(TEXT) TO mis_app;
GRANT EXECUTE ON FUNCTION complete_platform_admin_password_setup(TEXT, TEXT) TO mis_app;
GRANT EXECUTE ON FUNCTION is_valid_platform_admin_password_setup_token(TEXT) TO mis_app;
