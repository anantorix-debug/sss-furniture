/**
 * End-to-end QA suite covering auth + role-based access control across the
 * real HTTP surface of the API.
 *
 * Prerequisites (not run automatically in CI without these):
 *  1. A reachable Postgres instance, DATABASE_URL pointing at a disposable
 *     test database.
 *  2. `npx prisma migrate deploy` applied against that database.
 *  3. `npx prisma db seed` run against that database (creates the three QA
 *     accounts below with known passwords).
 *  4. WHATSAPP_ENABLED=false so no browser/session is launched during tests.
 *
 * Run with: npm run test:e2e
 */
process.env.WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED ?? 'false';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const SUPERADMIN = { email: process.env.SUPERADMIN_EMAIL ?? 'admin@sss.com', password: process.env.SUPERADMIN_PASSWORD ?? 'ChangeMe123!' };
const ADMIN = { email: 'admin.qa@sss.com', password: 'Admin123!' };
const EMPLOYEE = { email: 'employee.qa@sss.com', password: 'Employee123!' };

describe('SSS API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginAs(creds: { email: string; password: string }) {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send(creds).expect(200);
    return res.body.accessToken as string;
  }

  describe('Authentication', () => {
    it('rejects invalid credentials', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: SUPERADMIN.email, password: 'wrong-password' })
        .expect(401);
    });

    it('logs in the superadmin and returns a profile via /auth/me', async () => {
      const token = await loginAs(SUPERADMIN);
      const res = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body.email).toBe(SUPERADMIN.email);
      expect(res.body.role).toBe('SUPERADMIN');
    });

    it('rejects unauthenticated access to a protected route', async () => {
      await request(app.getHttpServer()).get('/api/dashboard/summary').expect(401);
    });
  });

  describe('Role-based access control', () => {
    it('blocks EMPLOYEE from listing users (superadmin-only)', async () => {
      const token = await loginAs(EMPLOYEE);
      await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('blocks ADMIN from listing users (superadmin-only)', async () => {
      const token = await loginAs(ADMIN);
      await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('allows SUPERADMIN to list users', async () => {
      const token = await loginAs(SUPERADMIN);
      const res = await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${token}`).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
    });

    it('blocks EMPLOYEE from deleting a customer order', async () => {
      const employeeToken = await loginAs(EMPLOYEE);
      const adminToken = await loginAs(ADMIN);

      const created = await request(app.getHttpServer())
        .post('/api/customer-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          orderId: `E2E-${Date.now()}`,
          orderDate: '2026-01-01',
          customerName: 'E2E Test Customer',
          product: 'Test Cot',
          orderValue: 10000,
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/customer-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/customer-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  describe('Customer order payments & balance calculation', () => {
    it('computes running balance correctly as partial payments are added', async () => {
      const token = await loginAs(ADMIN);

      const created = await request(app.getHttpServer())
        .post('/api/customer-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          orderId: `E2E-BAL-${Date.now()}`,
          orderDate: '2026-01-01',
          customerName: 'Balance Test',
          product: 'Sofa',
          orderValue: 20000,
        })
        .expect(201);

      expect(created.body.balanceAmount).toBe(20000);

      await request(app.getHttpServer())
        .post(`/api/customer-orders/${created.body.id}/payments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ date: '2026-01-02', amount: 8000, mode: 'UPI' })
        .expect(201);

      const afterFirstPayment = await request(app.getHttpServer())
        .get(`/api/customer-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(afterFirstPayment.body.balanceAmount).toBe(12000);

      await request(app.getHttpServer())
        .post(`/api/customer-orders/${created.body.id}/payments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ date: '2026-01-05', amount: 12000, mode: 'CASH' })
        .expect(201);

      const afterFinalPayment = await request(app.getHttpServer())
        .get(`/api/customer-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(afterFinalPayment.body.balanceAmount).toBe(0);
      expect(afterFinalPayment.body.totalReceived).toBe(20000);

      await request(app.getHttpServer())
        .delete(`/api/customer-orders/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('rejects a duplicate order ID', async () => {
      const token = await loginAs(ADMIN);
      const orderId = `E2E-DUP-${Date.now()}`;
      const payload = { orderId, orderDate: '2026-01-01', customerName: 'Dup Test', product: 'Chair', orderValue: 5000 };

      await request(app.getHttpServer()).post('/api/customer-orders').set('Authorization', `Bearer ${token}`).send(payload).expect(201);
      await request(app.getHttpServer()).post('/api/customer-orders').set('Authorization', `Bearer ${token}`).send(payload).expect(409);
    });
  });
});
