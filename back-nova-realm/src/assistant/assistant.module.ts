import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { WorkloadsModule } from '../workloads/workloads.module';
import { BuilderModule } from '../builder/builder.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [AiModule, RecommendationsModule, WorkloadsModule, BuilderModule, CatalogModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
