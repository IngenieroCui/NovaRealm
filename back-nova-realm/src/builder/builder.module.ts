import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { WorkloadsModule } from '../workloads/workloads.module';
import { BuilderController } from './builder.controller';
import { BuilderService } from './builder.service';
import { AdminGuard } from '../admin/admin.guard';
import { CompatibilityService } from './compatibility.service';

@Module({ imports: [CatalogModule, WorkloadsModule], controllers: [BuilderController], providers: [BuilderService, CompatibilityService, AdminGuard], exports: [BuilderService, CompatibilityService] })
export class BuilderModule {}
