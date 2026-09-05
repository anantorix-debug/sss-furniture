import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../../../common/enums/role.enum';

function mockContext(user: { role: Role } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function withRequiredRoles(roles: Role[] | undefined) {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles as any);
  }

  it('allows access when no roles are required (public/any-authenticated route)', () => {
    withRequiredRoles(undefined);
    expect(guard.canActivate(mockContext({ role: Role.CARPENTER }))).toBe(true);
  });

  it('allows a role through a route that explicitly lists it', () => {
    withRequiredRoles([Role.CARPENTER]);
    expect(guard.canActivate(mockContext({ role: Role.CARPENTER }))).toBe(true);
  });

  it('blocks a role not listed on the route', () => {
    withRequiredRoles([Role.CARPENTER]);
    expect(() => guard.canActivate(mockContext({ role: Role.POLISHER }))).toThrow(ForbiddenException);
  });

  it('blocks ADMIN from a route that only lists CARPENTER (peer roles are not interchangeable)', () => {
    withRequiredRoles([Role.CARPENTER]);
    expect(() => guard.canActivate(mockContext({ role: Role.ADMIN }))).toThrow(ForbiddenException);
  });

  it('SUPERADMIN always passes, even on a route that does not list it explicitly (full system access)', () => {
    withRequiredRoles([Role.CARPENTER]);
    expect(guard.canActivate(mockContext({ role: Role.SUPERADMIN }))).toBe(true);
  });

  it('blocks ADMIN from a route that requires SUPERADMIN only', () => {
    withRequiredRoles([Role.SUPERADMIN]);
    expect(() => guard.canActivate(mockContext({ role: Role.ADMIN }))).toThrow(ForbiddenException);
  });

  it('allows ADMIN through a route that explicitly lists both SUPERADMIN and ADMIN', () => {
    withRequiredRoles([Role.SUPERADMIN, Role.ADMIN]);
    expect(guard.canActivate(mockContext({ role: Role.ADMIN }))).toBe(true);
  });

  it('denies access when there is no authenticated user on the request', () => {
    withRequiredRoles([Role.CARPENTER]);
    expect(guard.canActivate(mockContext(undefined))).toBe(false);
  });
});
