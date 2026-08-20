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
    };
  }
}
