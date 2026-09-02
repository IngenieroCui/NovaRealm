import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ProductType } from './product.types';

export enum ProductSort {
  FEATURED = 'featured',
  PRICE_ASC = 'price-asc',
  PRICE_DESC = 'price-desc',
  NAME = 'name',
}

export const BooleanQuery = () =>
  Transform(({ value }) => value === true || value === 'true');

export class ProductQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  /** Allows a catalog view to combine related product types without losing context. */
  @IsOptional()
  @Transform(({ value }) => {
    const values = Array.isArray(value) ? value : [value];
    return values
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter(Boolean);
  })
  @IsArray()
  @IsEnum(ProductType, { each: true })
  types?: ProductType[];

  @IsOptional()
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minRamGb?: number;

  @IsOptional()
  @IsInt()
  @Min(64)
  minStorageGb?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minVramGb?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minCpuScore?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minGpuScore?: number;

  @IsOptional()
  @BooleanQuery()
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsEnum(ProductSort)
  sort?: ProductSort;
}

export class ProductWriteDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsOptional() @IsString() @MaxLength(1200) description?: string;
  @IsOptional() @IsInt() @Min(0) price?: number;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsEnum(ProductType) type?: ProductType;
  @IsOptional() @IsString() @MaxLength(120) cpu?: string;
  @IsOptional() @IsString() @MaxLength(120) gpu?: string;
  @IsOptional() @IsInt() @Min(1) @Max(512) ramGb?: number;
  @IsOptional() @IsInt() @Min(64) @Max(100000) storageGb?: number;
  @IsOptional() @IsInt() @Min(1) @Max(128) vramGb?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) cpuScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) gpuScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) productivityScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) upgradeabilityScore?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) features?: string[];
  @IsOptional() @IsObject() technicalSpecs?: Record<string, string | number | boolean>;
}
