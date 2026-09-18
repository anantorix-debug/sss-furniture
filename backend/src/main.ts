import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';

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

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`SSS API running on http://localhost:${port}/api`);
}
bootstrap();
