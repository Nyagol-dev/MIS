# Nexus MIS

Nexus MIS is a multi-tenant management system built with Next.js, TypeScript,
PostgreSQL row-level security, role-based permissions, and separate workspace
and platform-admin areas.

## Run locally

### 1. Install prerequisites

- Node.js 20 or newer
- PostgreSQL 15 or newer
- A database administrator account able to create the `mis_app` and
  `mis_admin` roles

Install packages:

```bash
npm install
```

### 2. Create the database roles and database

Use your PostgreSQL administrator account. Choose unique random passwords and
keep them private:

```sql
CREATE ROLE mis_admin LOGIN BYPASSRLS PASSWORD 'replace-with-a-random-admin-password';
CREATE ROLE mis_app LOGIN NOBYPASSRLS PASSWORD 'replace-with-a-different-random-app-password';
CREATE DATABASE mis OWNER mis_admin;
```

Run the canonical base schema and then the migrations, in order, as `mis_admin`:

```bash
psql "postgresql://mis_admin:YOUR_ADMIN_PASSWORD@localhost:5432/mis" -v ON_ERROR_STOP=1 -f db/schema.sql
psql "postgresql://mis_admin:YOUR_ADMIN_PASSWORD@localhost:5432/mis" -v ON_ERROR_STOP=1 -f db/migrations/round3_event_log_update_policy.sql
psql "postgresql://mis_admin:YOUR_ADMIN_PASSWORD@localhost:5432/mis" -v ON_ERROR_STOP=1 -f db/migrations/round4_reporting_tables.sql
psql "postgresql://mis_admin:YOUR_ADMIN_PASSWORD@localhost:5432/mis" -v ON_ERROR_STOP=1 -f db/migrations/round6_platform_admin_layer.sql
psql "postgresql://mis_admin:YOUR_ADMIN_PASSWORD@localhost:5432/mis" -v ON_ERROR_STOP=1 -f db/migrations/round8_billing_tables.sql
psql "postgresql://mis_admin:YOUR_ADMIN_PASSWORD@localhost:5432/mis" -v ON_ERROR_STOP=1 -f db/migrations/round9_auth_credentials.sql
psql "postgresql://mis_admin:YOUR_ADMIN_PASSWORD@localhost:5432/mis" -v ON_ERROR_STOP=1 -f db/migrations/round10_app_role_grants.sql
```

The application role is deliberately `NOBYPASSRLS`. The administrative role is
used only for platform administration and resolving a public organization slug
during tenant sign-in. Do not use `mis_admin` for ordinary tenant queries.

### 3. Configure secrets and connection strings

Copy `.env.example` to `.env.local`. Set distinct database passwords and generate
fresh secrets; never reuse the sample values. Generate a session secret and a
billing encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Use one generated value for `SESSION_SECRET`, another for
`BILLING_ENCRYPTION_KEY`, and another for `CRON_SECRET`. Local PostgreSQL may use
`PGSSLMODE=disable`; production must keep certificate validation enabled and
use TLS connection strings. SSO is not configured in this repository; password
sign-in and one-time password setup links are supported.

### 4. Create the first platform administrator

After applying the migrations and setting `.env.local`, run:

```bash
npm run bootstrap:platform-admin
```

The command is limited to an empty platform-admin table and prompts for the
first administrator's details and password. It does not print the password.
Later administrators are created from Platform → Administrators and receive a
single-use setup link.

### 5. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). A platform administrator
can create an organisation and its first workspace administrator. The workspace
administrator follows the one-time setup link, then can invite other users the
same way. Setup links are stored only as token digests and expire after 24 hours.

## Useful commands

```bash
npm run build
npm run lint
npm audit
```

## Main areas

- `app/(auth)` — workspace and platform sign-in and password setup
- `app/(tenant)` — workspace dashboards, people, roles, and records
- `app/(platform)` — organisation and platform-admin management
- `app/api` — authenticated APIs and payment/cron integrations
- `db/schema.sql` — executable base schema extracted from the canonical schema
- `db/migrations` — subsequent schema changes

## Authentication notes

Tenant login uses an organisation slug, email, and password. Newly created
workspace users and platform administrators receive a random, one-time setup
link instead of a shared temporary password. This installation does not send
email: the authorized administrator must share the link through a private
channel. Configure a mail provider before using invitations in a deployment
that requires automatic delivery.
