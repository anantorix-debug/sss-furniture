import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { Role } from '../common/enums/role.enum';

describe('UsersService', () => {
  let prisma: any;
  let service: UsersService;

  const superadmin = { id: 'u-super', email: 'super@sss.com', role: Role.SUPERADMIN, isActive: true };
  const admin = { id: 'u-admin', email: 'admin@sss.com', role: Role.ADMIN, isActive: true };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new UsersService(prisma, audit as any);
  });

  describe('update', () => {
    it('refuses to let a superadmin demote their own account', async () => {
      prisma.user.findUnique.mockResolvedValue(superadmin);

      await expect(service.update(superadmin.id, { role: Role.ADMIN }, superadmin.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses to let a user deactivate their own account', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);

      await expect(service.update(admin.id, { isActive: false }, admin.id)).rejects.toThrow(BadRequestException);
    });

    it('blocks demoting the last remaining superadmin', async () => {
      prisma.user.findUnique.mockResolvedValue(superadmin);
      prisma.user.count.mockResolvedValue(1);

      await expect(service.update(superadmin.id, { role: Role.ADMIN }, 'someone-else')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows demoting a superadmin when another superadmin remains', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(superadmin).mockResolvedValueOnce(null);
      prisma.user.count.mockResolvedValue(2);
      prisma.user.update.mockResolvedValue({ ...superadmin, role: Role.ADMIN });

      await expect(service.update(superadmin.id, { role: Role.ADMIN }, 'someone-else')).resolves.toBeDefined();
    });

    it('rejects updating email to one already in use by another user', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(admin) // target lookup
        .mockResolvedValueOnce({ ...superadmin, id: 'different-id' }); // email collision lookup

      await expect(service.update(admin.id, { email: superadmin.email }, 'someone-else')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', {}, 'someone-else')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('refuses to let a user delete their own account', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);
      await expect(service.remove(admin.id, admin.id)).rejects.toThrow(BadRequestException);
    });

    it('blocks deleting the last remaining superadmin', async () => {
      prisma.user.findUnique.mockResolvedValue(superadmin);
      prisma.user.count.mockResolvedValue(1);

      await expect(service.remove(superadmin.id, 'someone-else')).rejects.toThrow(BadRequestException);
    });

    it('allows deleting a non-superadmin user', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);
      prisma.user.delete.mockResolvedValue(admin);

      await expect(service.remove(admin.id, 'someone-else')).resolves.toEqual({ success: true });
    });
  });

  describe('create', () => {
    it('rejects creating a user with a duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);

      await expect(
        service.create({ name: 'X', email: admin.email, password: 'password123', role: Role.CARPENTER }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
