import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class WorkloadWriteDto {
  @IsOptional() @IsString() @MaxLength(100) slug?: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(50) type?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) cpuWeight?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) gpuWeight?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) ramWeight?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) storageWeight?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) vramWeight?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) minimumCpuScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) recommendedCpuScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) minimumGpuScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) recommendedGpuScore?: number;
  @IsOptional() @IsInt() @Min(1) @Max(512) minimumRamGb?: number;
  @IsOptional() @IsInt() @Min(1) @Max(512) recommendedRamGb?: number;
  @IsOptional() @IsInt() @Min(0) @Max(128) minimumVramGb?: number;
  @IsOptional() @IsInt() @Min(0) @Max(128) recommendedVramGb?: number;
}
