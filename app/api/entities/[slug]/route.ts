/**
 * app/api/entities/[slug]/route.ts
 *
 * GET    /api/entities/[slug] — Entity type detail + active field_definitions.
 * PUT    /api/entities/[slug] — Update entity type metadata (name, description).
 * DELETE /api/entities/[slug] — Soft-retire the entity type.
 *
 * AUTH: Tenant session required. All operations require the `user:manage`
 * permission (requireTenantAdmin) — the standard tenant-admin guard.
 *
 * SOFT-DELETE CONTRACT (DELETE)
 * ─────────────────────────────────────────────────────────────────────────────
 * DELETE does NOT hard-delete the row. It sets is_active = FALSE (the
 * "append-and-retire" convention). If any entity_records reference the type,
 * the operation is refused with HTTP 409 CONFLICT. The caller must archive
 * or delete those records first.
 *
 * STATUS CODES
 *   200 — GET / PUT success
 *   204 — DELETE success (no body)
 *   400 — Validation error
 *   401 — No valid session
 *   403 — Missing user:manage permission
 *   404 — Slug not found
 *   409 — Conflict (slug in use, or entity type has records on DELETE)
 *   500 — Unexpected server error
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { withTenantContext } from "@/lib/db/withTenant";
import { requireTenantAdmin } from "@/lib/auth/requireTenantAdmin";
import {
  getEntityTypeBySlug,
  updateEntityType,
  retireEntityType,
} from "@/lib/entities/types";

// ─── Shared error handler ─────────────────────────────────────────────────────

function handleError(error: unknown): NextResponse {
  if (typeof error === "object" && error !== null && "code" in error) {
    const typed = error as { code: string; message: string };
    const status =
      typed.code === "NOT_FOUND"
        ? 404
        : typed.code === "CONFLICT" || typed.code === "ENTITY_TYPE_IN_USE"
        ? 409
        : typed.code === "VALIDATION_ERROR"
        ? 400
        : typed.code === "FORBIDDEN" ||
          typed.code === "ForbiddenError" ||
          typed.code === "FORBIDDEN_SYSTEM_ROLE"
        ? 403
        : 500;

    return NextResponse.json({ error: typed.message }, { status });
  }

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return NextResponse.json({ error: message }, { status: 500 });
}

// ─── Route param type ─────────────────────────────────────────────────────────

type SlugParams = { params: Promise<{ slug: string }> };

// ─── GET /api/entities/[slug] ─────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: SlugParams
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const result = await getEntityTypeBySlug(client, session.tenantId, slug);

      if ("code" in result) {
        return handleError(result);
      }

      return NextResponse.json(result, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

// ─── PUT /api/entities/[slug] ─────────────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: SlugParams
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Request body must be a JSON object." },
        { status: 400 }
      );
    }

    const { name, description } = body as Record<string, unknown>;

    // At least one updatable field must be provided.
    if (name === undefined && description === undefined) {
      return NextResponse.json(
        {
          error:
            "Provide at least one updatable field: 'name' or 'description'. " +
            "The 'slug' field is immutable.",
        },
        { status: 400 }
      );
    }

    if (name !== undefined && typeof name !== "string") {
      return NextResponse.json(
        { error: "Field 'name' must be a string." },
        { status: 400 }
      );
    }
    if (description !== undefined && typeof description !== "string") {
      return NextResponse.json(
        { error: "Field 'description' must be a string." },
        { status: 400 }
      );
    }

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const result = await updateEntityType(
        client,
        session.tenantId,
        slug,
        {
          name: typeof name === "string" ? name : undefined,
          description: typeof description === "string" ? description : undefined,
        },
        session.userId
      );

      if ("code" in result) {
        return handleError(result);
      }

      return NextResponse.json(result, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

// ─── DELETE /api/entities/[slug] ──────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: SlugParams
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const result = await retireEntityType(
        client,
        session.tenantId,
        slug,
        session.userId
      );

      if (result !== undefined) {
        // retireEntityType returned a typed error.
        return handleError(result);
      }

      // Success — 204 No Content per REST convention for soft-delete.
      return new NextResponse(null, { status: 204 });
    });
  } catch (error) {
    return handleError(error);
  }
}
