import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';

// Node 15+ crashes the entire process on ANY unhandled promise rejection by
// default - and WhatsappClientWrapper drives a real (unofficial) Puppeteer/
// Chromium session internally, whose background operations can reject
// outside any try/catch this app controls. Without this handler, one stray
// rejection buried in that library (e.g. a page navigating away mid-call)
// takes down the whole API, not just WhatsApp - confirmed as a real gap
// this app had and a sibling project's own WhatsApp integration already
// guards against. Known-transient Puppeteer/whatsapp-web.js noise is
// logged at 'warn' and left there; anything else is logged at 'error' so
// it's still visible and investigable - but the process is never allowed
// to crash over an unhandled rejection either way. A synchronous
// uncaughtException is deliberately NOT handled the same way here - Node's
// own guidance is to let the process exit and have pm2 restart it cleanly
// rather than keep running with potentially corrupted state.
const unhandledRejectionLogger = new Logger('UnhandledRejection');
const KNOWN_TRANSIENT_REJECTION = /EBUSY|resource busy or locked|Execution context was destroyed|Protocol error \(Runtime|detached Frame|Target closed|Session closed/i;
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (KNOWN_TRANSIENT_REJECTION.test(message)) {
    unhandledRejectionLogger.warn(`Known-transient rejection suppressed: ${message.split('\n')[0]}`);
    return;
  }
  unhandledRejectionLogger.error(`Unhandled promise rejection (process kept alive): ${message}`, reason instanceof Error ? reason.stack : undefined);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Uploaded product images live outside the /api prefix so they can be
  // linked to directly as plain URLs (<img src>, WhatsApp media, etc).
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  app.use(
    helmet({
      // helmet's default CORP header blocks cross-origin <img> loads (the
      // web app on :3000 loading images from the API on :4000).
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api');

  // Health check — used by Docker HEALTHCHECK and deployment platforms
  app.getHttpAdapter().get('/api/health', (_req: Request, res: Response) => res.send('ok'));

  // Process start time as a cheap version marker - changes every time the
  // backend restarts (i.e. every backend deploy, since that always ends in
  // `pm2 restart sss-backend`). Lets the frontend's UpdateAvailableBanner
  // detect a backend-only deploy too, not just a frontend rebuild.
  const startedAt = Date.now().toString();
  app.getHttpAdapter().get('/api/version', (_req: Request, res: Response) => res.json({ startedAt }));

  // Swagger / OpenAPI docs at /api/docs (raw spec at /api/docs-json). On by
  // default in development; in production only when SWAGGER_ENABLED=true,
  // so the full API surface isn't published on the live domain by
  // accident. The docs are only a map - every route still enforces its own
  // JWT + role guards, so "Try it out" needs a real token (Authorize ->
  // paste the accessToken from POST /api/auth/login).
  const swaggerEnabled = process.env.SWAGGER_ENABLED === 'true' || (process.env.SWAGGER_ENABLED !== 'false' && process.env.NODE_ENV !== 'production');
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('SSS Furniture API')
      .setDescription('Orders, production, inventory, payments, expenses and reports for SSS Furniture.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', operationsSorter: 'alpha' },
    });
  }

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`SSS API running on http://localhost:${port}/api`);
}
bootstrap();
