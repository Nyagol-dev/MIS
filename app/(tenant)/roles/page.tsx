import React from 'react';
import { redirect } from 'next/navigation';
import { verifyAnySession, COOKIE_NAME } from '@/lib/auth/session';
import { cookies } from 'next/headers';
import { getEffectivePermissions, can } from '@/lib/auth/permissions';
import { listRoles } from '@/lib/roles/roles';
import { listEntityTypes } from '@/lib/entities/types';
import { withTenantContext } from '@/lib/db/withTenant';
import { RoleTable } from '@/components/roles/RoleTable';
import { RoleForm } from '@/components/roles/RoleForm';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

export const metadata = {
  title: 'Roles & Permissions',
};

// Client wrapper for "Create Role" button to manage modal state
import { CreateRoleButton } from '@/components/roles/CreateRoleButton';

export default async function RolesPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyAnySession(token) : null;
  
  if (!session || session.sessionKind !== 'tenant') {
    redirect('/login');
  }

  // Check permissions (tenant admins only or explicit role:manage if you implement that)
  // For now, checking tenant:admin or similar. The backend requires tenant admin for these routes.
  const perms = await getEffectivePermissions(session.tenantId, session.userId);
  const canManageRoles = can(perms, 'tenant:admin'); // standard way to guard tenant config

  // Parse pagination
  const pageParam = typeof searchParams.page === 'string' ? parseInt(searchParams.page, 10) : 1;
  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
  const limit = 20;
  const offset = (page - 1) * limit;

  // Load data
  const result = await withTenantContext(session.tenantId, async (client) => {
    const rolesRes = await listRoles(client, session.tenantId, { limit, offset });
    
    // Global permissions
    const { rows: globalPerms } = await client.query(`SELECT id, codename, description FROM permissions`);
    
    // Tenant overrides
    const { rows: overrides } = await client.query(
      `SELECT id, codename, description FROM tenant_permission_overrides WHERE tenant_id = $1`,
      [session.tenantId]
    );

    // Entity Types
    const entityTypesRes = await listEntityTypes(client, session.tenantId, { limit: 200 });

    // Current Assignments
    const { rows: rolePerms } = await client.query(
      `SELECT role_id, permission_id, override_id FROM role_permissions WHERE tenant_id = $1`,
      [session.tenantId]
    );

    const { rows: roleEntityPerms } = await client.query(
      `SELECT role_id, entity_type_id, action FROM role_entity_type_permissions WHERE tenant_id = $1`,
      [session.tenantId]
    );

    return {
      roles: rolesRes,
      globalPermissions: globalPerms,
      overrides,
      entityTypes: 'items' in entityTypesRes ? entityTypesRes.items : [],
      rolePerms,
      roleEntityPerms
    };
  });

  const rolesData = 'code' in result.roles ? { items: [], total: 0 } : result.roles;
  const totalPages = Math.ceil(rolesData.total / limit);

  // Transform assignments into the map
  const roleAssignments: Record<string, { globalIds: string[]; overrideIds: string[]; entityGrants: { entityTypeId: string; action: string }[] }> = {};
  
  rolesData.items.forEach(r => {
    roleAssignments[r.id] = { globalIds: [], overrideIds: [], entityGrants: [] };
  });

  result.rolePerms.forEach(rp => {
    if (!roleAssignments[rp.role_id]) return;
    if (rp.permission_id) roleAssignments[rp.role_id].globalIds.push(rp.permission_id);
    if (rp.override_id) roleAssignments[rp.role_id].overrideIds.push(rp.override_id);
  });

  result.roleEntityPerms.forEach(rep => {
    if (!roleAssignments[rep.role_id]) return;
    roleAssignments[rep.role_id].entityGrants.push({
      entityTypeId: rep.entity_type_id,
      action: rep.action
    });
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Roles & Permissions
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage roles and their permissions for your organization.
          </p>
        </div>
        
        {canManageRoles && (
          <div>
            <CreateRoleButton />
          </div>
        )}
      </div>

      <RoleTable 
        roles={rolesData.items} 
        currentPage={page} 
        totalPages={totalPages} 
        totalItems={rolesData.total}
        itemsPerPage={limit}
        canManage={canManageRoles}
        globalPermissions={result.globalPermissions}
        overrides={result.overrides}
        entityTypes={result.entityTypes}
        roleAssignments={roleAssignments}
      />
    </div>
  );
}
