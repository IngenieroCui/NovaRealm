import { BadRequestException, Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { WorkloadsService } from '../workloads/workloads.service';
import { ChatRequestDto, CompareRequestDto } from './assistant.dto';

@Injectable()
export class AssistantService {
  constructor(
    private readonly ai: AiService,
    private readonly workloads: WorkloadsService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async chat(input: ChatRequestDto) {
    const intent = await this.ai.interpret(
      input.message,
      input.conversation ?? [],
      await this.workloads.findAll(),
      input.filters,
    );
    if (intent.needsMoreInformation || !intent.filters) {
      return {
        message:
          intent.question ??
          '¿Cuál es tu presupuesto y qué programas o juegos usarás?',
        needsMoreInformation: true,
        filters: intent.filters ?? input.filters ?? null,
        recommendations: [],
      };
    }

    const result = await this.recommendations.recommend(intent.filters);
    if (!result.recommendations.length) {
      return {
        message:
          'No encontré equipos disponibles que cumplan esos mínimos dentro del presupuesto. Podemos aumentar el presupuesto o ajustar un poco el objetivo.',
        needsMoreInformation: false,
        filters: intent.filters,
        recommendations: [],
      };
    }
    const message = await this.ai.explainRecommendations(
      intent.filters,
      result.recommendations,
    );
    return {
      message,
      needsMoreInformation: false,
      filters: intent.filters,
      recommendations: result.recommendations,
      scoring: result.scoring,
    };
  }

  async compare(input: CompareRequestDto) {
    const result = await this.recommendations.recommend(input.filters);
    const selected = result.recommendations.filter((item) =>
      input.slugs.includes(item.product.slug),
    );
    if (selected.length < 2) {
      throw new BadRequestException(
        'Selecciona al menos dos recomendaciones vigentes para comparar',
      );
    }
    const message = await this.ai.explainComparison(input.question, selected);
    return { message, recommendations: selected };
  }
}
