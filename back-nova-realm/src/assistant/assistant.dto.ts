import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { RecommendationRequestDto } from '../recommendations/recommendation.dto';

export class ConversationMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(2000)
  content!: string;
}

export class ChatRequestDto {
  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ConversationMessageDto)
  conversation?: ConversationMessageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RecommendationRequestDto)
  filters?: RecommendationRequestDto;
}

export class CompareRequestDto {
  @IsString()
  @MaxLength(500)
  question!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  slugs!: string[];

  @ValidateNested()
  @Type(() => RecommendationRequestDto)
  filters!: RecommendationRequestDto;
}
