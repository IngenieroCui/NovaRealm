import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsEnum,
  IsOptional,
  IsString,
  IsInt,
  IsNumber,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { RecommendationRequestDto } from '../recommendations/recommendation.dto';
import { BuilderActionDto } from '../builder/builder.dto';
import { ProductType } from '../catalog/product.types';

export enum ShoppingIntent {
  PREBUILT_PC = 'PREBUILT_PC',
  CUSTOM_PC = 'CUSTOM_PC',
  UPGRADE_PC = 'UPGRADE_PC',
  COMPONENT = 'COMPONENT',
  PC_WITH_PERIPHERALS = 'PC_WITH_PERIPHERALS',
}

export enum UseProfile {
  GAMING = 'GAMING',
  CREATIVE = 'CREATIVE',
  PROGRAMMING = 'PROGRAMMING',
  OFFICE = 'OFFICE',
}

export enum ConversationStage {
  DISCOVER_INTENT = 'DISCOVER_INTENT',
  DISCOVER_USE = 'DISCOVER_USE',
  DISCOVER_BUDGET = 'DISCOVER_BUDGET',
  DISCOVER_DETAILS = 'DISCOVER_DETAILS',
  RECOMMENDING = 'RECOMMENDING',
  BUILDER_MODE = 'BUILDER_MODE',
  BUILDER = 'BUILDER',
  UPGRADE = 'UPGRADE',
  COMPONENT = 'COMPONENT',
  COMPLETE = 'COMPLETE',
}

export type AwaitingField = 'INTENT' | 'USE' | 'CONNECTIVITY' | 'GAMING_TARGET' | 'DEVELOPMENT_LOAD' | 'BUDGET' | 'BUILDER_MODE' | 'COMPONENT_SELECTION' | 'PERIPHERALS' | null;
export type QuickReplyKind = 'SET_INTENT' | 'SET_USE_PROFILE' | 'SET_BUDGET' | 'SET_WORKLOAD' | 'SET_CONNECTIVITY' | 'SET_GAMING_TARGET' | 'SET_DEVELOPMENT_LOAD' | 'SET_BUILDER_MODE' | 'SET_UPGRADE_GOAL' | 'SET_PERIPHERALS' | 'BUILDER_ACTION' | 'SEND_MESSAGE';

export class ConversationWorkloadDto {
  @IsString() @MaxLength(120) slug!: string;
  @IsNumber() @Min(0.01) @Max(1) importance!: number;
}

export class ConversationPreferencesDto {
  @IsOptional() @IsBoolean() futureUpgrade?: boolean;
  @IsOptional() @IsBoolean() wifiRequired?: boolean;
  @IsOptional() @IsBoolean() peripheralsNeeded?: boolean;
  @IsOptional() @IsBoolean() valuePriority?: boolean;
  @IsOptional() @IsIn(['LIGHT', 'NORMAL', 'HEAVY']) multitaskingLevel?: 'LIGHT' | 'NORMAL' | 'HEAVY';
}

export class DiscoveryFlagsDto {
  @IsOptional() @IsBoolean() connectivityAsked?: boolean;
  @IsOptional() @IsBoolean() gamingTargetAsked?: boolean;
  @IsOptional() @IsBoolean() developmentLoadAsked?: boolean;
  @IsOptional() @IsBoolean() peripheralsAsked?: boolean;
}

export class ConversationCriteriaDto {
  @IsOptional() @IsInt() @Min(500000) budgetMax?: number;
  @IsOptional() @IsInt() @Min(500000) budgetPreferred?: number;
  @IsOptional() @IsIn(['1080p', '1440p', '4k']) resolution?: '1080p' | '1440p' | '4k';
  @IsOptional() @IsInt() @Min(30) @Max(360) targetFps?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => ConversationWorkloadDto) workloads?: ConversationWorkloadDto[];
  @IsOptional() @IsEnum(UseProfile) useProfile?: UseProfile;
  @IsOptional() @ValidateNested() @Type(() => ConversationPreferencesDto) preferences?: ConversationPreferencesDto;
  @IsOptional() @ValidateNested() @Type(() => DiscoveryFlagsDto) discovery?: DiscoveryFlagsDto;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(['MONITOR', 'KEYBOARD', 'MOUSE', 'HEADSET'], { each: true }) requestedPeripherals?: Array<'MONITOR' | 'KEYBOARD' | 'MOUSE' | 'HEADSET'>;
  @IsOptional() @IsIn(['CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'STORAGE', 'PSU', 'COOLING', 'CASE', 'MONITOR']) requestedComponent?: string;
}

export class QuickReplyDto {
  @IsString() @MaxLength(80) id!: string;
  @IsString() @MaxLength(100) label!: string;
  @IsIn(['SET_INTENT', 'SET_USE_PROFILE', 'SET_BUDGET', 'SET_WORKLOAD', 'SET_CONNECTIVITY', 'SET_GAMING_TARGET', 'SET_DEVELOPMENT_LOAD', 'SET_BUILDER_MODE', 'SET_UPGRADE_GOAL', 'SET_PERIPHERALS', 'BUILDER_ACTION', 'SEND_MESSAGE']) kind!: QuickReplyKind;
  @IsOptional() value?: string | number;
  @IsOptional() payload?: Record<string, unknown>;
}

export class ConversationMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(2000)
  content!: string;
}

export class CurrentPcDto {
  @IsOptional() @IsString() @MaxLength(160) cpu?: string | null;
  @IsOptional() @IsString() @MaxLength(160) gpu?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1024) ramGb?: number | null;
  @IsOptional() @IsString() @MaxLength(200) motherboard?: string | null;
  @IsOptional() @IsString() @MaxLength(300) storage?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(5000) psuW?: number | null;
}

export class AssistantContextDto {
  @IsOptional() @IsString() @MaxLength(80) page?: string;
  @IsOptional() @IsString() @MaxLength(120) productSlug?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) buildSlugs?: string[];
  @IsOptional() @IsIn(Object.values(ShoppingIntent)) shoppingIntent?: ShoppingIntent;
  @IsOptional() @IsString() @MaxLength(120) selectedComponentType?: string;
  @IsOptional() @IsIn(['GUIDED', 'AUTO']) builderMode?: 'GUIDED' | 'AUTO';
  @IsOptional() @IsEnum(['CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'STORAGE', 'PSU', 'COOLING', 'CASE', 'PERIPHERALS', 'ASSEMBLY', 'DONE']) builderStep?: string;
  @IsOptional() @IsBoolean() assemblySelected?: boolean;
  @IsOptional() @ValidateNested() @Type(() => CurrentPcDto) currentPc?: CurrentPcDto;
  @IsOptional() @IsString() @MaxLength(160) upgradeGoal?: string;
  @IsOptional() @IsEnum(ProductType) builderEditingStep?: ProductType;
  @IsOptional() @IsString() @MaxLength(120) lastRecommendedProductSlug?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) lastComparedProductSlugs?: string[];
  @IsOptional() @IsString() @MaxLength(160) lastBuilderAdviceTopic?: string;
  @IsOptional() @IsIn(['balanced', 'cheaper', 'powerful']) builderPreference?: 'balanced' | 'cheaper' | 'powerful';
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
  @Type(() => ConversationCriteriaDto)
  filters?: ConversationCriteriaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationCriteriaDto)
  criteria?: ConversationCriteriaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => QuickReplyDto)
  quickReply?: QuickReplyDto;

  @IsOptional()
  @IsIn(Object.values(ShoppingIntent))
  shoppingIntent?: ShoppingIntent;

  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantContextDto)
  context?: AssistantContextDto;
}

export class AssistantStartRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationCriteriaDto)
  criteria?: ConversationCriteriaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantContextDto)
  context?: AssistantContextDto;
}

export class AssistantActionRequestDto {
  @ValidateNested() @Type(() => BuilderActionDto) builderAction!: BuilderActionDto;
  @IsOptional() @ValidateNested() @Type(() => ConversationCriteriaDto) criteria?: ConversationCriteriaDto;
  @IsOptional() @ValidateNested() @Type(() => AssistantContextDto) context?: AssistantContextDto;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ConversationMessageDto) conversation?: ConversationMessageDto[];
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
