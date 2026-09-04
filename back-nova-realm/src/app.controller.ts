import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHealth() {
    return {
      name: 'NovaRealm API',
      status: 'ok',
      timestamp: new Date().toISOString(),
      build: {
        commit:
          process.env.VERCEL_GIT_COMMIT_SHA
            ?.slice(0, 12) ??
          'local',
      },
    };
  }
}
