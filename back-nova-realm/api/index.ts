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

function removeVercelPathParam(request: Request) {
  if (request.query && 'path' in request.query) {
    delete (request.query as Record<string, unknown>).path;
  }
}

export default async function handler(request: Request, response: Response) {
  removeVercelPathParam(request);
  const app = await getApp();
  return app.getHttpAdapter().getInstance()(request, response);
}
