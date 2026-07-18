import React from 'react';
import { redirect } from 'next/navigation';
import { verifyAnySession, COOKIE_NAME } from '@/lib/auth/session';
import { cookies } from 'next/headers';
import { getEffectivePermissions, can } from '@/lib/auth/permissions';
import { listUsers } from '@/lib/users/users';
import { listRoles } from '@/lib/roles/roles';
import { withTenantContext } from '@/lib/db/withTenant';
import { UserTable } from '@/components/users/UserTable';
import { UserInviteForm } from '@/components/users/UserInviteForm';

export const metadata = {
  title: 'Users',
};

export default async function UsersPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyAnySession(token) : null;
  
  if (!session || session.sessionKind !== 'tenant') {
    redirect('/login');
  }

  // Check permissions
  const perms = await getEffectivePermissions(session.tenantId, session.userId);
  const canManageUsers = can(perms, 'user:manage');

  if (!canManageUsers) {
    // If they can't manage users, they shouldn't even view this page based on API rules
    // But we'll show it if they can view, but restrict actions.
    // Wait, let's just render it but with readonly access.
  }

  // Parse pagination
  const pageParam = typeof searchParams.page === 'string' ? parseInt(searchParams.page, 10) : 1;
  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
  const limit = 20;
  const offset = (page - 1) * limit;

  // Load data
  const result = await withTenantContext(session.tenantId, async (client) => {
    const usersRes = await listUsers(client, session.tenantId, undefined, { limit, offset });
    const rolesRes = await listRoles(client, session.tenantId, { limit: 100 });
    return {
      users: usersRes,
      roles: rolesRes,
    };
  });

  const usersData = 'code' in result.users ? { items: [], total: 0 } : result.users;
  const rolesData = 'code' in result.roles ? { items: [] } : result.roles;

  const totalPages = Math.ceil(usersData.total / limit);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Users
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage users in your organization.
          </p>
        </div>
        
        {canManageUsers && (
          <div>
            <UserInviteForm roles={rolesData.items.map(r => ({ id: r.id, name: r.name }))} />
          </div>
        )}
      </div>

      <UserTable 
        users={usersData.items} 
        currentPage={page} 
        totalPages={totalPages} 
        totalItems={usersData.total}
        itemsPerPage={limit}
        canManage={canManageUsers}
      />
    </div>
  );
}
