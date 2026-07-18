/**
 * app/(auth)/layout.tsx
 *
 * Route-group layout for authentication pages:
 *   /login          — Tenant login (org slug + email + password)
 *   /platform/login — Platform admin login (email + password)
 *
 * Intentionally minimal:
 * - No sidebar, no top bar — users arriving here are unauthenticated.
 * - Vertically and horizontally centres its children (login card) on
 *   a full-viewport canvas.
 * - Does NOT call SessionGuard — auth pages must be reachable without
 *   a valid session (they are in PUBLIC_ROUTE_PREFIXES in middleware.ts).
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in — MIS",
  description: "Sign in to your MIS workspace.",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        /* ── Auth layout tokens ──────────────────────────────────────── */
        :root {
          --auth-bg:              #f1f5f9;
          --auth-card-bg:         #ffffff;
          --auth-card-border:     #e2e8f0;
          --auth-card-shadow:     0 4px 24px 0 rgba(15, 23, 42, 0.08);
          --auth-brand-fg:        #0f172a;
          --auth-brand-sub-fg:    #64748b;
        }

        /* ── Full-viewport centred canvas ────────────────────────────── */
        .auth-layout-root {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          background: var(--auth-bg);
        }

        /* ── Brand header above the card ─────────────────────────────── */
        .auth-layout-brand {
          margin-bottom: 1.75rem;
          text-align: center;
        }

        .auth-layout-brand-name {
          font-size: 1.5rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--auth-brand-fg);
        }

        .auth-layout-brand-sub {
          margin-top: 0.25rem;
          font-size: 0.8125rem;
          color: var(--auth-brand-sub-fg);
        }

        /* ── Card wrapper ─────────────────────────────────────────────── */
        .auth-layout-card {
          width: 100%;
          max-width: 26rem;
          background: var(--auth-card-bg);
          border: 1px solid var(--auth-card-border);
          border-radius: 0.875rem;
          box-shadow: var(--auth-card-shadow);
          overflow: hidden;
        }
      `}</style>

      <div className="auth-layout-root">
        {/* Product brand mark */}
        <div className="auth-layout-brand">
          <div className="auth-layout-brand-name">MIS</div>
          <div className="auth-layout-brand-sub">
            Management Information System
          </div>
        </div>

        {/* Login card */}
        <div className="auth-layout-card">{children}</div>
      </div>
    </>
  );
}
