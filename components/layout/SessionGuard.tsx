/**
 * components/layout/SessionGuard.tsx
 *
 * SERVER COMPONENT — do NOT add 'use client'.
 *
 * Single point of truth for layout-level session verification.
 * Each route-group layout passes the `requiredKind` it owns; this
 * component verifies the cookie, type-narrows the payload, and
 * either calls `redirect()` or renders children with the resolved
 * session via explicit props.
 *
 * RULES (from Round 9 blueprint — Permission Enforcement Strategy):
 * ─────────────────────────────────────────────────────────────────
 * 1. No other layout, page, or server component should re-implement
 *    this JWT-read + verify + redirect logic. Import SessionGuard.
 * 2. The resolved AnySessionPayload is passed to children as props —
 *    NOT stored in React context — because Server Components do not
 *    support context consumption without a client boundary.
 * 3. Client components under these layouts MUST NOT re-verify sessions.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  verifyAnySession,
  COOKIE_NAME,
  type AnySessionPayload,
  type SessionPayload,
  type PlatformAdminSessionPayload,
} from "@/lib/auth/session";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionKind = AnySessionPayload["sessionKind"];

/**
 * Props accepted by the SessionGuard.
 *
 * @param requiredKind   — The session kind this layout requires.
 *                         If the verified token is a different kind,
 *                         the user is redirected to `redirectTo`.
 * @param redirectTo     — Where to send unauthenticated or wrong-kind
 *                         visitors (e.g. "/login", "/platform/login").
 * @param children       — A render-prop that receives the typed, verified
 *                         session payload. Using a render-prop (function
 *                         as child) rather than React.cloneElement lets
 *                         TypeScript narrow the payload type based on
 *                         `requiredKind`.
 */
export interface SessionGuardProps<K extends SessionKind> {
  requiredKind: K;
  redirectTo: string;
  children: (
    session: K extends "tenant"
      ? SessionPayload & { sessionKind: "tenant" }
      : PlatformAdminSessionPayload
  ) => React.ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Reads `mis_session` cookie → verifies JWT → narrows session kind.
 *
 * Redirect cases (all via Next.js `redirect()` — throws internally):
 * - Cookie absent or JWT invalid/expired → `redirectTo`
 * - JWT valid but wrong `sessionKind` for this layout → `redirectTo`
 *
 * On success, renders `children(session)` with the narrowed payload.
 */
export default async function SessionGuard<K extends SessionKind>({
  requiredKind,
  redirectTo,
  children,
}: SessionGuardProps<K>) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  // No cookie at all — definitely unauthenticated.
  if (!token) {
    redirect(redirectTo);
  }

  // Verify the JWT. verifyAnySession never throws — returns null on failure.
  const session: AnySessionPayload | null = await verifyAnySession(token);

  // Expired, tampered, or otherwise invalid token.
  if (!session) {
    redirect(redirectTo);
  }

  // Valid token but wrong kind for this layout.
  // e.g. a tenant user landing on /platform/dashboard, or a platform admin
  // landing on /dashboard — middleware handles the cross-kind bounce on page
  // navigation, but the layout guard is a defence-in-depth check.
  if (session.sessionKind !== requiredKind) {
    redirect(redirectTo);
  }

  // TypeScript cannot narrow generics through the `!==` check above, so we
  // cast here. The runtime check above guarantees correctness.
  return (
    <>
      {(
        children as (session: AnySessionPayload) => React.ReactNode
      )(session)}
    </>
  );
}
