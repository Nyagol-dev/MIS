export type EntityAction = 'create' | 'read' | 'update' | 'delete' | 'manage';

export interface PermissionSnapshot {
  codenames: ReadonlySet<string>;
  entityGrants: ReadonlyMap<string, ReadonlySet<string>>;
}

export function hasPermission(snapshot: PermissionSnapshot, codename: string): boolean {
  return snapshot.codenames.has(codename);
}

export function hasEntityPermission(
  snapshot: PermissionSnapshot,
  entityTypeId: string,
  action: EntityAction,
): boolean {
  const grants = snapshot.entityGrants.get(entityTypeId);
  return Boolean(grants?.has(action) || grants?.has('manage'));
}
