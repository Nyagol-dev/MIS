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
  title: "Sign in — Nexus MIS",
  description: "Sign in to your Nexus MIS workspace.",
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
        /* These mirror the values in globals.css :root but are scoped   */
        /* here for clarity and to survive CSS specificity order.        */
        :root {
          --auth-bg:              #f1f5f9;
          --auth-card-bg:         #ffffff;
          --auth-card-border:     #e2e8f0;
          --auth-card-shadow:     0 1px 3px 0 rgba(15, 23, 42, 0.06),
                                  0 4px 16px 0 rgba(15, 23, 42, 0.07);
          --auth-accent:          #1e50a2;
          --auth-brand-fg:        #0d1f35;
          --auth-brand-sub-fg:    #64748b;
        }

        /* ── Dark-mode overrides ─────────────────────────────────────── */
        @media (prefers-color-scheme: dark) {
          :root {
            --auth-bg:           #060d18;
            --auth-card-bg:      #0d1f35;
            --auth-card-border:  rgba(255, 255, 255, 0.08);
            --auth-card-shadow:  0 4px 32px 0 rgba(0, 0, 0, 0.56);
            --auth-accent:       #4f83d4;
            --auth-brand-fg:     #f1f5f9;
            --auth-brand-sub-fg: #94a3b8;
          }
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

        .auth-layout-brand-mark {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 0.5rem;
          background: var(--auth-accent);
          margin-bottom: 0.75rem;
        }

        .auth-layout-brand-mark span {
          color: #ffffff;
          font-weight: 800;
          font-size: 1rem;
          line-height: 1;
          user-select: none;
        }

        .auth-layout-brand-name {
          font-size: 1.25rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--auth-brand-fg);
        }

        .auth-layout-brand-sub {
          margin-top: 0.25rem;
          font-size: 0.8125rem;
          color: var(--auth-brand-sub-fg);
          letter-spacing: 0;
        }

        /* ── Card wrapper ─────────────────────────────────────────────── */
        .auth-layout-card {
          width: 100%;
          max-width: 26rem;
          background: var(--auth-card-bg);
          border: 1px solid var(--auth-card-border);
          border-radius: 0.5rem;           /* --radius-lg: restrained */
          box-shadow: var(--auth-card-shadow);
          overflow: hidden;
          /* Thin brand accent line at top of card — institutional signature */
          border-top: 3px solid var(--auth-accent);
        }
      `}</style>

      <div className="auth-layout-root">
        {/* Product brand mark */}
        <div className="auth-layout-brand">
          <div className="auth-layout-brand-mark">
            <span>N</span>
          </div>
          <div className="auth-layout-brand-name">Nexus MIS</div>
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
