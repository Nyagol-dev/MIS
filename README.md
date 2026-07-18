# MIS (Management Information System)

A multi-tenant Software-as-a-Service (SaaS) platform built with the Next.js App Router, providing dynamic entity management, role-based access control (RBAC), and specialized administration interfaces.

## Features

- **Multi-Tenant Architecture**: Supports isolated tenant environments with dedicated roles and capabilities.
- **Dynamic Entity Management**: Configurable CRUD operations for flexible data entities, dynamically rendered via API routes and React Server Components.
- **Role-Based Access Control (RBAC)**: Secure access control supporting Platform Administrators and Tenant Users with edge-compatible middleware session verification.
- **Specialized Interfaces**: Distinct application areas and route groups for Authentication, Platform Admin interfaces, and Tenant Management.
- **Payment Integrations**: Built-in support for Stripe and scheduled M-Pesa transactions polling.
- **Robust Security**: Password hashing via `argon2`, secure stateless JWT sessions using `jose`, and strict authorization layout guards.

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Database**: PostgreSQL (`pg`)
- **Styling**: Tailwind CSS / React Server Components
- **Authentication**: Custom JWT implementation (`jose`), `argon2`
- **Integrations**: Stripe SDK, M-Pesa APIs

## Getting Started

### Prerequisites

Ensure you have Node.js (v20+) and access to a PostgreSQL database instance.

### Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Set up your environment variables. Ensure you have the required connection strings, JWT secrets, and API keys (Stripe, M-Pesa):

```env
DATABASE_URL=postgres://user:password@localhost:5432/mis
JWT_SECRET=your_super_secret_key
# Add other necessary keys like STRIPE_SECRET_KEY, MPESA_CONSUMER_KEY, etc.
```

3. Start the development server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

- `app/(auth)/*`: Authentication and login flows.
- `app/(platform)/*`: Platform administration pages and dashboards.
- `app/(tenant)/*`: Tenant-specific management, including dynamic entities (`entities/[entityTypeSlug]/[recordId]`).
- `app/api/*`: API routes for authentication, entity CRUD operations, and CRON jobs (e.g., M-Pesa polling).
- `components/ui/*`: Reusable, dependency-free presentation UI primitive components.
- `lib/db/pool.ts`: PostgreSQL connection pool management.