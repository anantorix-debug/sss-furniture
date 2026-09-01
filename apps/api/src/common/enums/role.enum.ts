export enum Role {
  SUPERADMIN = 'SUPERADMIN',
  ADMIN = 'ADMIN',
  CARPENTER = 'CARPENTER',
  POLISHER = 'POLISHER',
}

// These are FUNCTIONAL roles, not a strict ladder - a Carpenter and a
// Polisher are peers with different permissions, not one above the other.
// SUPERADMIN has full system access and implicitly passes every @Roles()
// check regardless of the list (see RolesGuard). ADMIN is "elevated but not
// full" - it must be listed explicitly wherever it should have access.
export const ROLE_LABEL: Record<Role, string> = {
  [Role.SUPERADMIN]: 'Super Admin',
  [Role.ADMIN]: 'Admin',
  [Role.CARPENTER]: 'Carpenter Team',
  [Role.POLISHER]: 'Polish Team',
};
