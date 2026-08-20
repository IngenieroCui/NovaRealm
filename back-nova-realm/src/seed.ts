import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  await app.close();
  console.log('Seed de NovaRealm verificado correctamente.');
}

void seed();
