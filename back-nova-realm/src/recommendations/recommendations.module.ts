import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { WorkloadsModule } from '../workloads/workloads.module';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [CatalogModule, WorkloadsModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
