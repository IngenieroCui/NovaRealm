import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { BuilderController } from './builder.controller';
import { BuilderService } from './builder.service';
import { AdminGuard } from '../admin/admin.guard';

@Module({ imports: [CatalogModule], controllers: [BuilderController], providers: [BuilderService, AdminGuard], exports: [BuilderService] })
export class BuilderModule {}
