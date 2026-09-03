import { Injectable } from '@nestjs/common';
import {
  ConversationCriteriaDto,
  ConversationStage,
  ShoppingIntent,
  UseProfile,
} from './assistant.dto';

export type DiscoveryQuestion =
  | 'INTENT'
  | 'USE'
  | 'CONNECTIVITY'
  | 'GAMING_TARGET'
  | 'DEVELOPMENT_LOAD'
  | 'BUDGET'
  | 'BUILDER_MODE'
  | 'PERIPHERALS';

export interface DiscoveryDecision {
  awaiting: DiscoveryQuestion;
  stage: ConversationStage;
  reason: string;
}

const GAME_WORKLOADS = new Set([
  'valorant',
  'league-of-legends',
  'fortnite',
  'warzone',
  'cyberpunk-2077',
  'minecraft',
  'gta-v',
  'apex-legends',
]);

@Injectable()
export class DiscoveryPolicyService {
  next(
    intent: ShoppingIntent | undefined,
    criteria: ConversationCriteriaDto,
  ): DiscoveryDecision | null {
    if (!intent) return this.decision('INTENT', ConversationStage.DISCOVER_INTENT, 'shopping intent is not known');

    const workloads = new Set((criteria.workloads ?? []).map((item) => item.slug));
    const hasUse = criteria.useProfile !== undefined || workloads.size > 0;
    if ((intent === ShoppingIntent.PREBUILT_PC || intent === ShoppingIntent.CUSTOM_PC || intent === ShoppingIntent.PC_WITH_PERIPHERALS) && !hasUse) {
      return this.decision('USE', ConversationStage.DISCOVER_USE, 'no meaningful use profile or workload is known');
    }

    const isOffice = criteria.useProfile === UseProfile.OFFICE || workloads.has('ofimatica-basica');
    const isProgramming = criteria.useProfile === UseProfile.PROGRAMMING || workloads.has('programacion');
    const isGaming = criteria.useProfile === UseProfile.GAMING || [...workloads].some((slug) => GAME_WORKLOADS.has(slug));

    if (intent === ShoppingIntent.CUSTOM_PC || intent === ShoppingIntent.PC_WITH_PERIPHERALS) {
      const preferences = criteria.preferences ?? {};
      if (isOffice && preferences.wifiRequired === undefined && criteria.discovery?.connectivityAsked !== true) {
        return this.decision('CONNECTIVITY', ConversationStage.DISCOVER_DETAILS, 'office workload has unknown connectivity needs');
      }

      if (
        isProgramming &&
        !workloads.has('docker') &&
        !workloads.has('maquinas-virtuales') &&
        preferences.multitaskingLevel === undefined &&
        criteria.discovery?.developmentLoadAsked !== true
      ) {
        return this.decision('DEVELOPMENT_LOAD', ConversationStage.DISCOVER_DETAILS, 'programming workload has unknown development load');
      }

      if (
        isGaming &&
        (criteria.resolution === undefined || criteria.targetFps === undefined) &&
        criteria.discovery?.gamingTargetAsked !== true
      ) {
        return this.decision('GAMING_TARGET', ConversationStage.DISCOVER_DETAILS, 'game workload has unknown resolution or target FPS');
      }
    }

    if (intent === ShoppingIntent.PC_WITH_PERIPHERALS && criteria.requestedPeripherals === undefined && criteria.discovery?.peripheralsAsked !== true) {
      return this.decision('PERIPHERALS', ConversationStage.DISCOVER_DETAILS, 'peripheral needs are not known');
    }

    if (criteria.budgetMax === undefined) {
      return this.decision('BUDGET', ConversationStage.DISCOVER_BUDGET, 'maximum budget is not known');
    }

    if (intent === ShoppingIntent.CUSTOM_PC) {
      return this.decision('BUILDER_MODE', ConversationStage.BUILDER_MODE, 'custom build mode is not known');
    }

    return null;
  }

  private decision(
    awaiting: DiscoveryQuestion,
    stage: ConversationStage,
    reason: string,
  ): DiscoveryDecision {
    return { awaiting, stage, reason };
  }
}
