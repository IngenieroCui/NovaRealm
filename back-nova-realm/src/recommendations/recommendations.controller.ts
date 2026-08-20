import { Body, Controller, Post } from '@nestjs/common';
import { RecommendationRequestDto } from './recommendation.dto';
import { RecommendationsService } from './recommendations.service';

@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Post()
  recommend(@Body() input: RecommendationRequestDto) {
    return this.recommendations.recommend(input);
  }
}
