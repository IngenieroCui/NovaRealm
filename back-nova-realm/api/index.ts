import type { Request, Response } from 'express';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main';

let appPromise: Promise<INestApplication> | undefined;

async function getApp() {
  appPromise ??= createApp().then(async (app) => {
    await app.init();
    return app;
  });
  return appPromise;
}

export default async function handler(request: Request, response: Response) {
  const app = await getApp();
  return app.getHttpAdapter().getInstance()(request, response);
}
