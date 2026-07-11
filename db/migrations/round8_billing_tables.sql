-- Migration: Round 8 Billing Tables
--
-- This migration implements the Round 8 billing and subscriptions layer.
-- It creates the billing schema tables with multi-tenant row-level security (RLS)
-- and appropriate indexing, and seeds the required billing permissions.
--
-- Tables created:
-- 1. tenant_invoice_sequences: Track next invoice sequences per tenant.
-- 2. tenant_provider_configs: Encrypted payment gateway configs per tenant.
-- 3. billing_customers: Maps tenant customers to Stripe/M-Pesa.
-- 4. billing_plans: Tenant billing plans & limits.
-- 5. subscriptions: Customer plan subscriptions.
-- 6. invoices: Tenant invoices (sequentially numbered per tenant).
-- 7. invoice_line_items: Items inside an invoice.
-- 8. payment_requests: Unified Stripe/M-Pesa payment requests.
-- 9. payment_webhook_events: Webhook idempotency and audit logs.
--
-- Existing Table Modifications:
-- - event_subscriptions: Widens source_type and event CHECK constraints.
--
-- Permissions Seeded:
-- - billing:read, billing:create, billing:update, billing:delete, billing:manage.

-- === 1. tenant_invoice_sequences ===
CREATE TABLE tenant_invoice_sequences (
    tenant_id           UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    next_seq            BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenant_invoice_sequences IS
    'Tenant-scoped sequential invoice number generator sequence.';

ALTER TABLE tenant_invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invoice_sequences FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON tenant_invoice_sequences
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON tenant_invoice_sequences
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON tenant_invoice_sequences
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON tenant_invoice_sequences
    FOR DELETE USING (tenant_id = current_tenant_id());


-- === 2. tenant_provider_configs ===
CREATE TABLE tenant_provider_configs (
    tenant_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    provider_slug       TEXT NOT NULL CHECK (provider_slug IN ('stripe', 'mpesa')),
    display_name        TEXT NOT NULL DEFAULT '',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    credentials_encrypted BYTEA NOT NULL,     -- AES-256-GCM encrypted JSONB
    webhook_secret      TEXT,                 -- Stripe webhook signing secret (per-tenant if using Connect)
    callback_token      TEXT,                 -- M-Pesa URL-embedded callback token
    config              JSONB NOT NULL DEFAULT '{}',  -- provider-specific non-secret config
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, provider_slug)  -- one config per provider per tenant
);

COMMENT ON TABLE tenant_provider_configs IS
    'Per-tenant payment provider credentials and configs, encrypted at application-layer.';

ALTER TABLE tenant_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_provider_configs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON tenant_provider_configs
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON tenant_provider_configs
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON tenant_provider_configs
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON tenant_provider_configs
    FOR DELETE USING (tenant_id = current_tenant_id());


-- === 3. billing_customers ===
CREATE TABLE billing_customers (
    tenant_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    display_name        TEXT NOT NULL,
    email               TEXT,
    phone               TEXT,                 -- required for M-Pesa
    stripe_customer_id  TEXT,                 -- Stripe Customer ID (cus_xxx)
    user_id             UUID,                 -- optional FK to users table (if the customer is also a system user)
    metadata            JSONB NOT NULL DEFAULT '{}',  -- tenant-specific fields
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE billing_customers IS
    'Links a tenant''s billable entities to external payment provider customer records.';

CREATE INDEX idx_billing_customers_stripe
    ON billing_customers (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX idx_billing_customers_phone
    ON billing_customers (tenant_id, phone)
    WHERE phone IS NOT NULL;

CREATE INDEX idx_billing_customers_metadata
    ON billing_customers USING GIN (metadata);

ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON billing_customers
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON billing_customers
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON billing_customers
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON billing_customers
    FOR DELETE USING (tenant_id = current_tenant_id());


-- === 4. billing_plans ===
CREATE TABLE billing_plans (
    tenant_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    amount_minor_units  BIGINT NOT NULL,      -- amount in smallest currency unit
    currency            TEXT NOT NULL DEFAULT 'KES',  -- ISO 4217
    interval            TEXT NOT NULL CHECK (interval IN (
                            'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'one_time'
                        )),
    interval_count      INT NOT NULL DEFAULT 1,  -- e.g., 2 with 'monthly' = every 2 months
    trial_days          INT NOT NULL DEFAULT 0,
    limits              JSONB NOT NULL DEFAULT '{}',  -- { "users": 100, "entity_records": 10000 }
    stripe_price_id     TEXT,                 -- Stripe Price ID (if synced)
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

COMMENT ON TABLE billing_plans IS
    'Tenant-defined subscription plans containing billing amounts, limits, and pricing details.';

ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_plans FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON billing_plans
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON billing_plans
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON billing_plans
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON billing_plans
    FOR DELETE USING (tenant_id = current_tenant_id());


-- === 5. subscriptions ===
CREATE TABLE subscriptions (
    tenant_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    billing_customer_id UUID NOT NULL,
    plan_id             UUID NOT NULL,
    status              TEXT NOT NULL CHECK (status IN (
                            'trialing', 'active', 'past_due', 'canceled'
                        )) DEFAULT 'trialing',
    provider_slug       TEXT NOT NULL CHECK (provider_slug IN ('stripe', 'mpesa')),
    provider_subscription_id TEXT,        -- Stripe subscription ID (NULL for M-Pesa, which has no native subscription concept)
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end   TIMESTAMPTZ NOT NULL,
    trial_end            TIMESTAMPTZ,     -- NULL = no trial
    canceled_at          TIMESTAMPTZ,     -- NULL = not canceled
    cancel_reason        TEXT,
    metadata             JSONB NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, billing_customer_id)
        REFERENCES billing_customers(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, plan_id)
        REFERENCES billing_plans(tenant_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE subscriptions IS
    'Tenant customer subscriptions, tracking active periods, statuses, and linked plans.';

CREATE INDEX idx_subscriptions_customer
    ON subscriptions (tenant_id, billing_customer_id);

CREATE INDEX idx_subscriptions_status
    ON subscriptions (tenant_id, status)
    WHERE status IN ('active', 'trialing', 'past_due');

CREATE INDEX idx_subscriptions_provider
    ON subscriptions (provider_slug, provider_subscription_id)
    WHERE provider_subscription_id IS NOT NULL;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON subscriptions
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON subscriptions
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON subscriptions
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON subscriptions
    FOR DELETE USING (tenant_id = current_tenant_id());


-- === 6. invoices ===
CREATE TABLE invoices (
    tenant_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    subscription_id     UUID,                 -- NULL for one-time invoices
    billing_customer_id UUID NOT NULL,
    invoice_number      TEXT NOT NULL,         -- tenant-scoped formatted sequential number (e.g. 'INV-00047')
    status              TEXT NOT NULL CHECK (status IN (
                            'draft', 'open', 'paid', 'void', 'uncollectible'
                        )) DEFAULT 'draft',
    subtotal_minor_units BIGINT NOT NULL DEFAULT 0,
    tax_minor_units      BIGINT NOT NULL DEFAULT 0,
    total_minor_units    BIGINT NOT NULL DEFAULT 0,
    currency             TEXT NOT NULL DEFAULT 'KES',
    due_date             DATE,
    paid_at              TIMESTAMPTZ,
    stripe_invoice_id    TEXT,                -- Stripe Invoice ID (if synced)
    metadata             JSONB NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, invoice_number),
    FOREIGN KEY (tenant_id, subscription_id)
        REFERENCES subscriptions(tenant_id, id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id, billing_customer_id)
        REFERENCES billing_customers(tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE invoices IS
    'Tenant-scoped invoices generated from plans, subscriptions, or ad-hoc line items.';

CREATE INDEX idx_invoices_status
    ON invoices (tenant_id, status, due_date);

CREATE INDEX idx_invoices_customer
    ON invoices (tenant_id, billing_customer_id, created_at DESC);

CREATE INDEX idx_invoices_metadata
    ON invoices USING GIN (metadata);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON invoices
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON invoices
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON invoices
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON invoices
    FOR DELETE USING (tenant_id = current_tenant_id());


-- === 7. invoice_line_items ===
CREATE TABLE invoice_line_items (
    tenant_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invoice_id          UUID NOT NULL,
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    description         TEXT NOT NULL,
    quantity            INT NOT NULL DEFAULT 1,
    unit_amount_minor_units BIGINT NOT NULL,
    total_minor_units   BIGINT NOT NULL,      -- quantity * unit_amount (application-computed)
    metadata            JSONB NOT NULL DEFAULT '{}',  -- tenant-specific fields (term, department, etc.)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, invoice_id)
        REFERENCES invoices(tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE invoice_line_items IS
    'Individual line items associated with a tenant invoice.';

CREATE INDEX idx_invoice_line_items_invoice
    ON invoice_line_items (tenant_id, invoice_id);

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON invoice_line_items
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON invoice_line_items
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON invoice_line_items
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON invoice_line_items
    FOR DELETE USING (tenant_id = current_tenant_id());


-- === 8. payment_requests ===
CREATE TABLE payment_requests (
    tenant_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    invoice_id          UUID,                 -- NULL for ad-hoc payments not tied to an invoice
    billing_customer_id UUID NOT NULL,
    provider_slug       TEXT NOT NULL CHECK (provider_slug IN ('stripe', 'mpesa')),
    provider_payment_id TEXT,                 -- Stripe PaymentIntent ID / M-Pesa CheckoutRequestID
    amount_minor_units  BIGINT NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'KES',
    status              TEXT NOT NULL CHECK (status IN (
                            'initiated', 'pending', 'succeeded', 'failed', 'expired'
                        )) DEFAULT 'initiated',
    provider_config     JSONB NOT NULL DEFAULT '{}',  -- provider-specific data (clientSecret, merchantRequestId, etc.)
    failure_reason      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, invoice_id)
        REFERENCES invoices(tenant_id, id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id, billing_customer_id)
        REFERENCES billing_customers(tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE payment_requests IS
    'Provider-agnostic payment attempt records mapping to Stripe PaymentIntents or M-Pesa STK Pushes.';

CREATE INDEX idx_payment_requests_provider
    ON payment_requests (provider_slug, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;

CREATE INDEX idx_payment_requests_status
    ON payment_requests (tenant_id, status, created_at DESC);

ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON payment_requests
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON payment_requests
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON payment_requests
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON payment_requests
    FOR DELETE USING (tenant_id = current_tenant_id());


-- === 9. payment_webhook_events ===
CREATE TABLE payment_webhook_events (
    tenant_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    provider_slug       TEXT NOT NULL CHECK (provider_slug IN ('stripe', 'mpesa')),
    provider_event_id   TEXT NOT NULL,    -- Stripe: event.id, M-Pesa: CheckoutRequestID
    event_type          TEXT NOT NULL,    -- 'payment_intent.succeeded', 'stkpush.result', etc.
    raw_payload         JSONB NOT NULL,   -- full provider payload, stored for audit/debugging
    processed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (provider_slug, provider_event_id)  -- idempotency key (cross-tenant unique)
);

COMMENT ON TABLE payment_webhook_events IS
    'Append-only log of external payment provider webhook events for idempotency and auditing.';

ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON payment_webhook_events
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON payment_webhook_events
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());


-- === 10. Existing Table Modifications: event_subscriptions ===
ALTER TABLE event_subscriptions
    DROP CONSTRAINT IF EXISTS event_subscriptions_source_type_check,
    ADD CONSTRAINT event_subscriptions_source_type_check
        CHECK (source_type IN ('core_entity', 'custom_entity', 'billing'));

ALTER TABLE event_subscriptions
    DROP CONSTRAINT IF EXISTS event_subscriptions_event_check,
    ADD CONSTRAINT event_subscriptions_event_check
        CHECK (event IN (
            'created', 'updated', 'deleted',
            'status_changed', 'field_changed',
            'payment_succeeded', 'payment_failed', 'subscription_renewed'
        ));


-- === 11. Seeding Permissions ===
INSERT INTO permissions (codename, description, resource, action) VALUES
    ('billing:read',    'View billing data (invoices, plans, subscriptions)',  'billing', 'read'),
    ('billing:create',  'Create invoices, plans, subscriptions',              'billing', 'create'),
    ('billing:update',  'Update billing data',                                'billing', 'update'),
    ('billing:delete',  'Delete/void billing data',                           'billing', 'delete'),
    ('billing:manage',  'Full billing administration',                        'billing', 'manage')
ON CONFLICT (codename) DO NOTHING;
