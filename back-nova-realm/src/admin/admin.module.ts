import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { WorkloadsModule } from '../workloads/workloads.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { CloudinaryService } from './cloudinary.service';

@Module({
  imports: [CatalogModule, WorkloadsModule],
  controllers: [AdminController],
  providers: [AdminGuard, CloudinaryService],
})
export class AdminModule {}
