/**
 * app/api/entities/route.ts
 *
 * GET  /api/entities — List entity types for the current tenant (paginated).
 * POST /api/entities — Create a new entity type.
 *
 * AUTH: Tenant session required. Both operations require the `user:manage`
 * permission (requireTenantAdmin), which is the standard tenant-admin guard
 * used across the user/role/permission management surface.
 *
 * PAGINATION CONTRACT: { items, total, limit, offset }
 *   - Default limit: 50, max: 200
 *   - Query params: ?limit=<n>&offset=<n>
 *
 * STATUS CODES
 *   200 — GET success
 *   201 — POST success (entity type created)
 *   400 — Validation error (bad input)
 *   401 — No valid session
 *   403 — Valid session but missing user:manage permission
 *   409 — Slug already exists for this tenant
 *   500 — Unexpected server error
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { withTenantContext } from "@/lib/db/withTenant";
import { requireTenantAdmin } from "@/lib/auth/requireTenantAdmin";
import { listEntityTypes, createEntityType } from "@/lib/entities/types";

// ─── Shared error handler ─────────────────────────────────────────────────────

function handleError(error: unknown): NextResponse {
  if (typeof error === "object" && error !== null && "code" in error) {
    const typed = error as { code: string; message: string };
    const status =
      typed.code === "NOT_FOUND"
        ? 404
        : typed.code === "CONFLICT"
        ? 409
        : typed.code === "VALIDATION_ERROR"
        ? 400
        : typed.code === "ENTITY_TYPE_IN_USE"
        ? 409
        : typed.code === "FORBIDDEN" ||
          typed.code === "ForbiddenError" ||
          typed.code === "FORBIDDEN_SYSTEM_ROLE"
        ? 403
        : 500;

    return NextResponse.json({ error: typed.message }, { status });
  }

  const message =
    error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
  return NextResponse.json({ error: message }, { status: 500 });
}

// ─── GET /api/entities ────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate pagination params.
    const limitParam = request.nextUrl.searchParams.get("limit");
    const offsetParam = request.nextUrl.searchParams.get("offset");
    const includeRetiredParam = request.nextUrl.searchParams.get("include_retired");

    let limit: number | undefined;
    let offset: number | undefined;

    if (limitParam !== null) {
      limit = parseInt(limitParam, 10);
      if (Number.isNaN(limit) || limit < 1) {
        return NextResponse.json(
          { error: "'limit' must be a positive integer." },
          { status: 400 }
        );
      }
    }
    if (offsetParam !== null) {
      offset = parseInt(offsetParam, 10);
      if (Number.isNaN(offset) || offset < 0) {
        return NextResponse.json(
          { error: "'offset' must be a non-negative integer." },
          { status: 400 }
        );
      }
    }

    const includeRetired = includeRetiredParam === "true";

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const result = await listEntityTypes(client, session.tenantId, {
        limit,
        offset,
        includeRetired,
      });

      return NextResponse.json(result, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

// ─── POST /api/entities ───────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Request body must be a JSON object." },
        { status: 400 }
      );
    }

    const { name, slug, description } = body as Record<string, unknown>;

    if (typeof name !== "string") {
      return NextResponse.json(
        { error: "Field 'name' is required and must be a string." },
        { status: 400 }
      );
    }
    if (typeof slug !== "string") {
      return NextResponse.json(
        { error: "Field 'slug' is required and must be a string." },
        { status: 400 }
      );
    }

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const result = await createEntityType(
        client,
        session.tenantId,
        {
          name,
          slug,
          description: typeof description === "string" ? description : undefined,
        },
        session.userId
      );

      if (typeof result === "object" && result !== null && "code" in result) {
        return handleError(result);
      }

      return NextResponse.json(result, { status: 201 });
    });
  } catch (error) {
    return handleError(error);
  }
}
