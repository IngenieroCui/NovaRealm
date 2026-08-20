import { Controller, Get, Param } from '@nestjs/common';
import { WorkloadsService } from './workloads.service';

@Controller('workloads')
export class WorkloadsController {
  constructor(private readonly workloads: WorkloadsService) {}

  @Get()
  findAll() {
    return this.workloads.findAll();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.workloads.findBySlug(slug);
  }
}
