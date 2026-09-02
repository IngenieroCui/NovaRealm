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

export enum ShoppingIntent {
  PREBUILT_PC = 'PREBUILT_PC',
  CUSTOM_PC = 'CUSTOM_PC',
  UPGRADE_PC = 'UPGRADE_PC',
  COMPONENT = 'COMPONENT',
  PC_WITH_PERIPHERALS = 'PC_WITH_PERIPHERALS',
}

export class ConversationMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(2000)
  content!: string;
}

export class AssistantContextDto {
  @IsOptional() @IsString() @MaxLength(80) page?: string;
  @IsOptional() @IsString() @MaxLength(120) productSlug?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) buildSlugs?: string[];
  @IsOptional() @IsIn(Object.values(ShoppingIntent)) shoppingIntent?: ShoppingIntent;
  @IsOptional() @IsString() @MaxLength(120) selectedComponentType?: string;
  @IsOptional() @IsIn(['GUIDED', 'AUTO']) builderMode?: 'GUIDED' | 'AUTO';
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

  @IsOptional()
  @IsIn(Object.values(ShoppingIntent))
  shoppingIntent?: ShoppingIntent;

  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantContextDto)
  context?: AssistantContextDto;
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
