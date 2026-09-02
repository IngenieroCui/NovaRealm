import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/$/, '');
}

function isAllowedOrigin(origin: string | undefined, configuredOrigins: string[]) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  const configured = configuredOrigins.map(normalizeOrigin).filter(Boolean);
  return configured.includes(normalized)
    || normalized === 'https://nova-realm-front.vercel.app'
    || /^https:\/\/nova-realm-front-[a-z0-9-]+\.vercel\.app$/i.test(normalized);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const configuredOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin, configuredOrigins)) {
        callback(null, true);
        return;
      }
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-admin-key'],
  });

  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
