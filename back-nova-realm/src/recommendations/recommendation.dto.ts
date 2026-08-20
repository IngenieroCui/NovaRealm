import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class WorkloadPreferenceDto {
  @IsString()
  slug!: string;

  @IsNumber()
  @Min(0.01)
  @Max(1)
  importance!: number;
}

export class RecommendationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  futureUpgrade?: boolean;
}

export class RecommendationRequestDto {
  @IsOptional()
  @IsInt()
  @Min(500000)
  budgetMax?: number;

  @IsOptional()
  @IsInt()
  @Min(500000)
  budgetPreferred?: number;

  @IsOptional()
  @IsIn(['1080p', '1440p', '4k'])
  resolution?: '1080p' | '1440p' | '4k';

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(360)
  targetFps?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => WorkloadPreferenceDto)
  workloads!: WorkloadPreferenceDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RecommendationPreferencesDto)
  preferences?: RecommendationPreferencesDto;
}
