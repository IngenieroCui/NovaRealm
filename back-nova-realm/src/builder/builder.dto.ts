import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested, MaxLength } from 'class-validator';
import { ProductType } from '../catalog/product.types';

export class BuilderRequestDto {
  @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) itemSlugs: string[] = [];
  @IsOptional() @IsInt() @Min(0) budgetMax?: number;
  @IsOptional() @IsBoolean() assembly?: boolean;
  @IsOptional() @IsBoolean() complete?: boolean;
}

export class ComponentRecommendationRequestDto extends BuilderRequestDto {
  @IsEnum(ProductType) componentType!: ProductType;
  @IsOptional() @IsString() @IsIn(['cheaper', 'powerful']) preference?: 'cheaper' | 'powerful';
}

export class AutoBuildRequestDto {
  @IsInt() @Min(500000) budgetMax!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) workloadSlugs?: string[];
  @IsOptional() @IsBoolean() assembly?: boolean;
}

export class BuilderActionDto {
  @IsIn(['ADD_TO_BUILD', 'REMOVE_FROM_BUILD', 'REPLACE_COMPONENT', 'CLEAR_BUILD', 'ADD_ASSEMBLY', 'REMOVE_ASSEMBLY', 'ADD_PERIPHERAL', 'REMOVE_PERIPHERAL', 'START_GUIDED', 'AUTO_BUILD', 'AUTO_SELECT'])
  action!: string;
  @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) currentSlugs: string[] = [];
  @IsOptional() @IsString() @MaxLength(120) productSlug?: string;
  @IsOptional() @IsInt() productId?: number;
  @IsOptional() @IsEnum(ProductType) componentType?: ProductType;
  @IsOptional() @IsBoolean() assembly?: boolean;
  @IsOptional() @IsInt() @Min(500000) budgetMax?: number;
  @IsOptional() @IsIn(['GUIDED', 'AUTO']) mode?: 'GUIDED' | 'AUTO';
}

export class UpgradePcDto {
  @IsOptional() @IsString() cpu?: string | null;
  @IsOptional() @IsString() gpu?: string | null;
  @IsOptional() @IsInt() @Min(0) ramGb?: number | null;
  @IsOptional() @IsString() motherboard?: string | null;
  @IsOptional() @IsString() storage?: string | null;
  @IsOptional() @IsInt() @Min(0) psuW?: number | null;
  @IsString() @MaxLength(120) goal!: string;
  @IsOptional() @IsInt() @Min(500000) budgetMax?: number;
}

export class AssemblySettingsDto {
  @IsBoolean() assemblyEnabled!: boolean;
  @IsInt() @Min(0) assemblyPrice!: number;
}
