import { BadRequestException, Injectable } from '@nestjs/common';
import { AiService, ChatTurnResult } from '../ai/ai.service';
import { BuilderService, ComponentCandidate } from '../builder/builder.service';
import { ProductType } from '../catalog/product.types';
import { CatalogService } from '../catalog/catalog.service';
import { RecommendationRequestDto } from '../recommendations/recommendation.dto';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { WorkloadsService } from '../workloads/workloads.service';
import { AssistantActionRequestDto, AssistantContextDto, AssistantStartRequestDto, AwaitingField, ChatRequestDto, CompareRequestDto, ConversationCriteriaDto, ConversationStage, QuickReplyDto, ShoppingIntent, UseProfile } from './assistant.dto';
import { DiscoveryDecision, DiscoveryPolicyService } from './discovery-policy.service';
import { builderReply, messageReply, quickRepliesFor, upgradeGoalReplies } from './quick-reply.factory';

const BUILDER_COMPONENT_TYPES = [ProductType.CPU, ProductType.MOTHERBOARD, ProductType.RAM, ProductType.GPU, ProductType.STORAGE, ProductType.PSU, ProductType.COOLING, ProductType.CASE];
const WINDOWS_SPECS_COMMAND = `$cpu=(Get-CimInstance Win32_Processor).Name; $gpu=(Get-CimInstance Win32_VideoController).Name -join ', '; $ram=[math]::Round(((Get-CimInstance Win32_PhysicalMemory | Measure-Object Capacity -Sum).Sum/1GB)); $board=(Get-CimInstance Win32_BaseBoard | ForEach-Object { $_.Manufacturer + ' ' + $_.Product }) -join ', '; $disk=(Get-CimInstance Win32_DiskDrive).Model -join ', '; [pscustomobject]@{ CPU=$cpu; GPU=$gpu; RAM="$ram GB"; Motherboard=$board; Storage=$disk } | Format-List`;
const SYSTEM_INFO_GUIDE = {
  title: 'Obtener las especificaciones en Windows', command: WINDOWS_SPECS_COMMAND,
  steps: ['Haz clic derecho en Inicio y abre Terminal o PowerShell. No necesitas permisos de administrador.', 'Copia y pega el comando, presiona Enter y espera unos segundos.', 'Copia aquí el resultado. El comando solo lee nombres de hardware; no cambia nada ni muestra archivos personales.'],
  note: 'La fuente de poder no aparece en Windows. Si luego recomendamos una GPU, te pediré mirar la etiqueta de la fuente o enviar su modelo.',
};

@Injectable()
export class AssistantService {
  constructor(private readonly ai: AiService, private readonly workloads: WorkloadsService, private readonly recommendations: RecommendationsService, private readonly builder: BuilderService, private readonly catalog: CatalogService, private readonly discoveryPolicy: DiscoveryPolicyService = new DiscoveryPolicyService()) {}

  async start(input: AssistantStartRequestDto) {
    const criteria = input.criteria ?? {};
    const product = input.context?.productSlug
      ? await this.catalog.findBySlug(input.context.productSlug).catch(() => undefined)
      : undefined;
    if (product) {
      let message: string;
      try {
        message = await this.ai.generateGreeting({ criteria, context: input.context, product });
      } catch {
        message = 'Hola, soy Nova. Cuéntame qué buscas y te ayudo a elegir.';
      }
      return this.response({ message, ...this.base(input.context?.shoppingIntent, criteria, input.context), product, quickReplies: [] }, ConversationStage.RECOMMENDING, null, true, 'assistant-start');
    }

    const intent = input.context?.shoppingIntent;
    if (intent === undefined) {
      let message: string;
      try {
        message = await this.ai.generateGreeting({ criteria, context: input.context });
      } catch {
        message = 'Hola, soy Nova. Cuéntame qué buscas y te ayudo a elegir.';
      }
      return this.response({ message, ...this.base(undefined, criteria, input.context), quickReplies: quickRepliesFor('INTENT') }, ConversationStage.DISCOVER_INTENT, 'INTENT', true, 'assistant-start');
    }

    if (intent === ShoppingIntent.UPGRADE_PC) {
      let message = 'Para empezar, pásame el CPU, la GPU y la RAM actuales de tu PC, o usa la guía de Windows.';
      try {
        message = await this.ai.composeConversationReply({
          userMessage: 'El usuario abrió Nova desde la opción para mejorar su PC.',
          shoppingIntent: intent,
          criteria,
          stage: ConversationStage.UPGRADE,
          awaiting: null,
          verified: {
            reason: 'upgrade hardware discovery',
            purpose: 'El usuario eligió mejorar su PC existente. Pide CPU, GPU y RAM actuales o la salida de la guía de información del sistema de Windows. No pidas presupuesto todavía ni recomiendes hardware.',
            currentPc: input.context?.currentPc ?? null,
          },
        });
      } catch { /* fallback */ }
      return this.response({ message, ...this.base(intent, criteria, input.context), systemInfoGuide: SYSTEM_INFO_GUIDE, quickReplies: [] }, ConversationStage.UPGRADE, null, true, 'assistant-start');
    }

    if (intent === ShoppingIntent.COMPONENT && !criteria.requestedComponent) {
      let message = '¿Qué componente estás buscando?';
      try {
        message = await this.ai.composeConversationReply({ userMessage: 'El usuario abrió Nova desde la opción para buscar un componente.', shoppingIntent: intent, criteria, stage: ConversationStage.COMPONENT, awaiting: 'COMPONENT_SELECTION', verified: { reason: 'component selection', purpose: 'El usuario quiere comprar un solo componente. Pregunta únicamente cuál necesita y no preguntes presupuesto todavía.' } });
      } catch { /* fallback */ }
      return this.response({ message, ...this.base(intent, criteria, input.context), quickReplies: quickRepliesFor('COMPONENT_SELECTION', intent) }, ConversationStage.COMPONENT, 'COMPONENT_SELECTION', true, 'assistant-start');
    }

    if (intent === ShoppingIntent.COMPONENT) {
      return this.handleComponent(
        { message: 'El usuario abrió Nova desde la opción para buscar un componente.', criteria, context: input.context },
        criteria,
        null,
        this.base(intent, criteria, input.context),
      );
    }

    const decision = [
      ShoppingIntent.PREBUILT_PC,
      ShoppingIntent.CUSTOM_PC,
      ShoppingIntent.PC_WITH_PERIPHERALS,
    ].includes(intent)
      ? this.discoveryPolicy.next(intent, criteria)
      : null;
    if (decision) {
      let reply = 'Cuéntame un poco más para orientarte mejor.';
      try {
        reply = await this.ai.composeConversationReply({ userMessage: 'El usuario abrió Nova desde una opción de la interfaz.', shoppingIntent: intent, criteria, stage: decision.stage, awaiting: decision.awaiting, verified: { reason: decision.reason, knownCriteria: criteria } });
      } catch { /* greeting remains a safe fallback */ }
      return this.response({ message: reply, ...this.base(intent, criteria, input.context), quickReplies: quickRepliesFor(decision.awaiting, intent) }, decision.stage, decision.awaiting, true, 'assistant-start');
    }

    let message = 'Ya tengo lo necesario para empezar a recomendarte opciones.';
    try {
      message = await this.ai.composeConversationReply({ userMessage: 'El usuario abrió Nova desde una opción de la interfaz.', shoppingIntent: intent, criteria, stage: ConversationStage.RECOMMENDING, awaiting: null, verified: { knownCriteria: criteria } });
    } catch { /* fallback */ }
    return this.response({ message, ...this.base(intent, criteria, input.context), quickReplies: [] }, ConversationStage.RECOMMENDING, null, true, 'assistant-start');
  }

  async chat(input: ChatRequestDto) {
    const previousCriteria = input.criteria ?? input.filters ?? {};
    const direct = input.quickReply ? this.applyQuickReply(input.quickReply, previousCriteria) : null;
    const effectiveContext: AssistantContextDto = { ...(input.context ?? {}), ...(direct?.upgradeGoal ? { upgradeGoal: direct.upgradeGoal } : {}) };
    const handlerInput = { ...input, context: effectiveContext };
    const analysisMessage = await this.withProductContext(input.message, effectiveContext);
    let aiTurn: ChatTurnResult | null = null;
    if (!direct) {
      try { aiTurn = await this.ai.chatTurn(analysisMessage, input.conversation ?? [], await this.workloads.findAll(), previousCriteria, input.context?.shoppingIntent ?? input.shoppingIntent); }
      catch { return this.aiUnavailable(previousCriteria, input.context?.shoppingIntent ?? input.shoppingIntent); }
    }
    const explicitIntent = this.detectExplicitShoppingIntent(input.message);
    const previousIntent = input.context?.shoppingIntent ?? input.shoppingIntent;
    const shoppingIntent =
      this.resolveShoppingIntent({
        directIntent: direct?.intent,
        explicitIntent,
        aiTurn,
        previousIntent,
        context: effectiveContext,
      }) ??
      this.detectShoppingIntent(input.message);
    const intentChanged = Boolean(previousIntent && shoppingIntent !== previousIntent);
    let criteria = this.mergeCriteria(
      previousCriteria,
      aiTurn?.extracted,
      this.extractDeterministicCriteria(input.message, effectiveContext),
      direct?.criteria,
    );
    if (
      direct &&
      'replaceWorkloads' in direct &&
      direct.replaceWorkloads === true
    ) {
      criteria = {
        ...criteria,
        workloads: direct.criteria.workloads ?? [],
      };
    }

    const extractedUseProfile = aiTurn?.extracted?.useProfile;
    const aiChangedUseProfile =
      extractedUseProfile !== undefined &&
      extractedUseProfile !== previousCriteria.useProfile;

    if (aiChangedUseProfile && !direct?.replaceWorkloads) {
      const explicitlyExtractedWorkloads = aiTurn?.extracted?.workloads ?? [];
      criteria = {
        ...criteria,
        useProfile: extractedUseProfile,
        workloads:
          explicitlyExtractedWorkloads.length > 0
            ? explicitlyExtractedWorkloads
            : this.defaultWorkloadsForUseProfile(extractedUseProfile),
      };

      if (extractedUseProfile !== UseProfile.GAMING) {
        criteria.resolution = aiTurn?.extracted?.resolution;
        criteria.targetFps = aiTurn?.extracted?.targetFps;
      }

      criteria.discovery = {
        ...(criteria.discovery ?? {}),
        gamingTargetAsked:
          extractedUseProfile === UseProfile.GAMING
            ? false
            : criteria.discovery?.gamingTargetAsked,
        developmentLoadAsked:
          extractedUseProfile === UseProfile.PROGRAMMING
            ? false
            : criteria.discovery?.developmentLoadAsked,
        connectivityAsked:
          extractedUseProfile === UseProfile.OFFICE
            ? false
            : criteria.discovery?.connectivityAsked,
      };

      if (aiTurn?.extracted?.preferences?.multitaskingLevel === undefined) {
        criteria.preferences = {
          ...(criteria.preferences ?? {}),
          multitaskingLevel: undefined,
        };
      }
    }

    criteria = await this.sanitizeCriteria(criteria);
    const builderMode = intentChanged ? direct?.builderMode : direct?.builderMode ?? aiTurn?.builderPreference ?? effectiveContext.builderMode;
    const base = this.base(shoppingIntent, criteria, effectiveContext);
    const hasGuidedBuilderContext =
      shoppingIntent === ShoppingIntent.CUSTOM_PC &&
      effectiveContext.builderMode === 'GUIDED' &&
      (
        effectiveContext.builderStep === 'DONE' ||
        BUILDER_COMPONENT_TYPES.includes(
          effectiveContext.builderStep as ProductType,
        )
      );
    if (hasGuidedBuilderContext) return this.handleGuidedBuilder(handlerInput, criteria, base);
    if (shoppingIntent === ShoppingIntent.UPGRADE_PC) return this.handleUpgrade(handlerInput, criteria, aiTurn, base);
    if (shoppingIntent === ShoppingIntent.COMPONENT) return this.handleComponent(handlerInput, criteria, aiTurn, base);
    if (shoppingIntent === ShoppingIntent.CUSTOM_PC) return this.handleCustomPc(handlerInput, criteria, builderMode, aiTurn, base);
    if (shoppingIntent === ShoppingIntent.PC_WITH_PERIPHERALS) return this.handlePcWithPeripherals(handlerInput, criteria, aiTurn, base);
    return this.handlePrebuilt(handlerInput, criteria, aiTurn, base);
  }

  async action(input: AssistantActionRequestDto) {
    const criteria = input.criteria ?? {};
    const effectiveWorkloads = await this.effectiveWorkloads(criteria);
    const result = await this.builder.applyAction({ ...input.builderAction, workloads: input.builderAction.workloads ?? effectiveWorkloads, preferences: input.builderAction.preferences ?? criteria.preferences });
    const candidates = (result.recommendations ?? []) as ComponentCandidate[];
    const recommended = candidates.find((item) => item.recommendedRole === 'RECOMMENDED') ?? candidates[0];
    let message: string;
    try {
      if (
        result.flow?.currentStep !== 'DONE' &&
        BUILDER_COMPONENT_TYPES.includes(result.flow?.currentStep as ProductType) &&
        candidates.length
      ) {
        message = await this.ai.explainBuilderStep({
          criteria,
          currentStep: result.flow.currentStep as ProductType,
          build: result.summary.components,
          remainingBudget: result.summary.budgetRemaining,
          recommendedCandidate: recommended,
          alternatives: candidates
            .filter((item) => item.slug !== recommended?.slug)
            .slice(0, 2),
        });
      } else {
        message = await this.ai.composeConversationReply({ userMessage: input.builderAction.label ?? input.builderAction.action, shoppingIntent: ShoppingIntent.CUSTOM_PC, criteria, stage: result.flow?.currentStep === 'DONE' ? ConversationStage.COMPLETE : ConversationStage.BUILDER, awaiting: null, verified: { action: result.action, selectedProduct: result.product, remainingBudget: result.summary.budgetRemaining, nextStep: result.flow?.currentStep, recommendedCandidate: recommended ?? null, candidateRationale: recommended?.rationale ?? null, balanceWarnings: result.summary.warnings, build: result.summary, flow: result.flow, nextCandidates: candidates.slice(0, 5), preferences: input.builderAction.preferences ?? criteria.preferences } });
      }
    } catch { return this.aiUnavailable(criteria, ShoppingIntent.CUSTOM_PC, { build: result.summary, flow: result.flow, componentRecommendations: candidates }); }
    return this.response({ message, ...this.base(ShoppingIntent.CUSTOM_PC, criteria, input.context), build: result.summary, flow: result.flow, componentRecommendations: candidates, lastRecommendedProductSlug: recommended?.slug, lastComparedProductSlugs: [], lastBuilderAdviceTopic: result.flow?.currentStep, builderPreference: input.context?.builderPreference, quickReplies: this.builderConversationReplies(result.flow?.currentStep) }, result.flow?.currentStep === 'DONE' ? ConversationStage.COMPLETE : ConversationStage.BUILDER, null, true, 'builder-action');
  }

  private async handlePrebuilt(input: ChatRequestDto, criteria: ConversationCriteriaDto, turn: ChatTurnResult | null, base: Record<string, unknown>) {
    const decision = this.discoveryPolicy.next(base.shoppingIntent as ShoppingIntent | undefined, criteria);
    if (decision) return this.discoveryResponse(input, criteria, base, decision);
    const filters = await this.toRecommendationRequest(criteria);
    const result = await this.recommendations.recommend(filters);
    let message: string;
    try { message = result.recommendations.length ? await this.ai.explainRecommendations(filters, result.recommendations) : await this.ai.answerWithVerifiedContext('recommendation-answer', 'Explica que no hay opciones responsables y propone ajustar un solo criterio.', input.message, { criteria, availableRecommendations: [] }); }
    catch { return this.aiUnavailable(criteria, base.shoppingIntent as ShoppingIntent); }
    return this.response({ message, ...base, filters, criteria, recommendations: result.recommendations, scoring: result.scoring, quickReplies: [] }, ConversationStage.RECOMMENDING, null, true, 'recommendation-answer');
  }

  private async handleCustomPc(input: ChatRequestDto, criteria: ConversationCriteriaDto, mode: 'GUIDED' | 'AUTO' | undefined, turn: ChatTurnResult | null, base: Record<string, unknown>) {
    const decision = mode ? null : this.discoveryPolicy.next(base.shoppingIntent as ShoppingIntent | undefined, criteria);
    if (decision) return this.discoveryResponse(input, criteria, base, decision);
    if (!mode) return this.discoveryResponse(input, criteria, base, { awaiting: 'BUILDER_MODE', stage: ConversationStage.BUILDER_MODE, reason: 'custom builder mode is not known' });
    const workloads = await this.effectiveWorkloads(criteria);
    if (mode === 'AUTO') {
      const build = await this.builder.autoBuild({ budgetMax: criteria.budgetMax!, workloadSlugs: (workloads ?? []).map((item) => item.slug), assembly: input.context?.assemblySelected, preferences: criteria.preferences });
      const flow = await this.builder.flow(build.products.map((item) => item.slug), 'AUTO', workloads);
      let message: string;
      try { message = await this.ai.composeConversationReply({ userMessage: input.message, shoppingIntent: ShoppingIntent.CUSTOM_PC, criteria, stage: ConversationStage.COMPLETE, awaiting: null, verified: { build, flow } }); }
      catch { return this.aiUnavailable(criteria, ShoppingIntent.CUSTOM_PC, { build, flow }); }
      return this.response({ message, ...base, build, flow, quickReplies: [] }, ConversationStage.COMPLETE, null, true, 'builder-answer');
    }
    const result = await this.builder.applyAction({ action: 'START_GUIDED', currentSlugs: input.context?.buildSlugs ?? [], budgetMax: criteria.budgetMax, workloads, preferences: criteria.preferences, mode: 'GUIDED', assemblySelected: input.context?.assemblySelected });
    let message: string;
    const candidates = result.recommendations as ComponentCandidate[];
    const recommended = candidates.find((item) => item.recommendedRole === 'RECOMMENDED') ?? candidates[0];
    try { message = await this.ai.explainBuilderStep({ criteria, currentStep: result.flow.currentStep as ProductType, build: result.summary.components, remainingBudget: result.summary.budgetRemaining, recommendedCandidate: recommended, alternatives: candidates.filter((item) => item.slug !== recommended?.slug).slice(0, 2) }); }
    catch { return this.aiUnavailable(criteria, ShoppingIntent.CUSTOM_PC, { build: result.summary, flow: result.flow }); }
    return this.response({ message, ...base, build: result.summary, flow: result.flow, componentRecommendations: candidates, lastRecommendedProductSlug: recommended?.slug, quickReplies: this.builderConversationReplies(result.flow.currentStep) }, ConversationStage.BUILDER, null, true, 'builder-answer');
  }

  private async handleComponent(input: ChatRequestDto, criteria: ConversationCriteriaDto, turn: ChatTurnResult | null, base: Record<string, unknown>) {
    if (!criteria.requestedComponent) return this.discoveryResponse(input, criteria, base, { awaiting: 'COMPONENT_SELECTION', stage: ConversationStage.COMPONENT, reason: 'component type is not known' });
    const effectiveWorkloads = await this.effectiveWorkloads(criteria);
    const result = await this.builder.recommendComponents({ componentType: criteria.requestedComponent as ProductType, itemSlugs: input.context?.buildSlugs ?? [], budgetMax: criteria.budgetMax, workloads: effectiveWorkloads, preferences: criteria.preferences, assemblySelected: input.context?.assemblySelected });
    let message: string;
    try { message = await this.ai.composeConversationReply({ userMessage: input.message, shoppingIntent: ShoppingIntent.COMPONENT, criteria, stage: ConversationStage.COMPONENT, awaiting: null, verified: { candidates: result.recommendations, warnings: result.warnings } }); }
    catch { return this.aiUnavailable(criteria, ShoppingIntent.COMPONENT, { componentRecommendations: result.recommendations }); }
    return this.response({ message, ...base, componentType: criteria.requestedComponent, componentRecommendations: result.recommendations, warnings: result.warnings, lastRecommendedProductSlug: result.recommendations.find((item) => item.recommendedRole === 'RECOMMENDED')?.slug ?? result.recommendations[0]?.slug, quickReplies: [] }, ConversationStage.COMPONENT, null, true, 'component-answer');
  }

  private async handleUpgrade(input: ChatRequestDto, criteria: ConversationCriteriaDto, turn: ChatTurnResult | null, base: Record<string, unknown>) {
    const currentPc = this.mergeCurrentPc(input.context?.currentPc, this.extractCurrentPc(input.message));
    const upgradeGoal = this.extractUpgradeGoal(input.message) ?? input.context?.upgradeGoal;
    const missingPc = [!currentPc.cpu && 'procesador', !currentPc.gpu && 'tarjeta gráfica', !currentPc.ramGb && 'memoria RAM'].filter(Boolean) as string[];
    if (missingPc.length) {
      const message = await this.ensureQuestion(turn, 'Explica que necesitas las especificaciones actuales y menciona solo los datos faltantes.', input.message, { missingPc, currentPc });
      return this.response({ message, ...base, currentPc, upgradeGoal: upgradeGoal ?? null, systemInfoGuide: SYSTEM_INFO_GUIDE, quickReplies: [] }, ConversationStage.UPGRADE, null, Boolean(turn), 'interpret+reply');
    }
    if (!upgradeGoal) {
      let message = '¿Qué quieres mejorar primero: juegos, edición, programación o la fluidez general del PC?';
      try { message = await this.ai.answerWithVerifiedContext('upgrade-goal', 'Pide el objetivo de mejora sin pedir todavía presupuesto.', input.message, { currentPc }); } catch { /* fallback */ }
      return this.response({ message, ...base, currentPc, quickReplies: upgradeGoalReplies() }, ConversationStage.UPGRADE, null, true, 'upgrade-goal');
    }
    if (!criteria.budgetMax) return this.discoveryResponse(input, criteria, { ...base, currentPc, upgradeGoal }, { awaiting: 'BUDGET', stage: ConversationStage.UPGRADE, reason: 'maximum upgrade budget is not known' });
    const upgrade = await this.builder.analyzeUpgrade({ ...currentPc, goal: upgradeGoal, budgetMax: criteria.budgetMax });
    let message: string;
    try { message = await this.ai.composeConversationReply({ userMessage: input.message, shoppingIntent: ShoppingIntent.UPGRADE_PC, criteria, stage: ConversationStage.UPGRADE, awaiting: null, verified: { upgrade } }); }
    catch { return this.aiUnavailable(criteria, ShoppingIntent.UPGRADE_PC, { currentPc, upgradeGoal, upgradeAnalysis: upgrade }); }
    return this.response({ message, ...base, currentPc, upgradeGoal, upgradeAnalysis: upgrade, upgradeRecommendations: upgrade.recommendations, quickReplies: [] }, ConversationStage.UPGRADE, null, true, 'upgrade-answer');
  }

  private async handleGuidedBuilder(input: ChatRequestDto, criteria: ConversationCriteriaDto, base: Record<string, unknown>) {
    const currentSlugs = input.context?.buildSlugs ?? [];
    const effectiveWorkloads = await this.effectiveWorkloads(criteria);
    const flow = await this.builder.flow(currentSlugs, 'GUIDED', effectiveWorkloads, input.context?.builderEditingStep);
    const build = await this.builder.summarize({ itemSlugs: currentSlugs, budgetMax: criteria.budgetMax, workloads: effectiveWorkloads, preferences: criteria.preferences, assemblySelected: input.context?.assemblySelected });
    if (!BUILDER_COMPONENT_TYPES.includes(flow.currentStep as ProductType)) {
      let message: string;
      try { message = await this.ai.answerWithVerifiedContext('builder-answer', 'Responde la duda sobre la configuración terminada sin modificarla.', input.message, { criteria, build, flow }); }
      catch { return this.aiUnavailable(criteria, ShoppingIntent.CUSTOM_PC, { build, flow }); }
      return this.response({ message, ...base, build, flow, quickReplies: [] }, ConversationStage.COMPLETE, null, true, 'builder-answer');
    }
    const currentStep = flow.currentStep as ProductType;
    const candidateResult = await this.builder.recommendComponents({ componentType: currentStep, itemSlugs: currentSlugs, budgetMax: criteria.budgetMax, workloads: effectiveWorkloads, preferences: criteria.preferences, assemblySelected: input.context?.assemblySelected, preference: input.context?.builderPreference === 'balanced' ? undefined : input.context?.builderPreference });
    const candidates = candidateResult.recommendations;
    const recommended = candidates.find((item) => item.recommendedRole === 'RECOMMENDED') ?? candidates[0];
    let message: string;
      try { message = await this.ai.answerBuilderQuestion(input.message, { workload: effectiveWorkloads ?? [], budgetMax: criteria.budgetMax, remainingBudget: build.budgetRemaining, currentStep, currentBuild: build.components, candidates, lastRecommendedProductSlug: input.context?.lastRecommendedProductSlug ?? recommended?.slug, lastComparedProductSlugs: input.context?.lastComparedProductSlugs, balanceWarnings: build.warnings, preferences: criteria.preferences, useProfile: criteria.useProfile }); }
    catch { return this.aiUnavailable(criteria, ShoppingIntent.CUSTOM_PC, { build, flow, componentRecommendations: candidates }); }
    return this.response({ message, ...base, build, flow, componentRecommendations: candidates, warnings: candidateResult.warnings, lastRecommendedProductSlug: recommended?.slug ?? input.context?.lastRecommendedProductSlug, lastComparedProductSlugs: input.context?.lastComparedProductSlugs, lastBuilderAdviceTopic: currentStep, builderPreference: input.context?.builderPreference, quickReplies: this.builderConversationReplies(currentStep) }, ConversationStage.BUILDER, null, true, 'builder-answer');
  }

  private async handlePcWithPeripherals(input: ChatRequestDto, criteria: ConversationCriteriaDto, turn: ChatTurnResult | null, base: Record<string, unknown>) {
    const decision = this.discoveryPolicy.next(ShoppingIntent.PC_WITH_PERIPHERALS, criteria);
    if (decision) return this.discoveryResponse(input, criteria, base, decision);
    const effectiveWorkloads = await this.effectiveWorkloads(criteria);
    const requestedTypes = criteria.requestedPeripherals?.length ? criteria.requestedPeripherals : ['MONITOR'];
    const available = await this.builder.recommendPeripherals(requestedTypes as ProductType[], criteria.budgetMax, criteria.resolution, criteria.targetFps);
    const baselinePeripherals = requestedTypes.map((type) => available.find((product) => product.type === type)).filter((product): product is NonNullable<typeof product> => Boolean(product));
    const missing = requestedTypes.filter((type) => !baselinePeripherals.some((product) => product.type === type));
    if (missing.length) {
      let message = `No encontré opciones disponibles para: ${missing.join(', ')}.`;
      try { message = await this.ai.answerWithVerifiedContext('peripheral-answer', 'Explica qué categorías de periféricos no se pueden cubrir actualmente.', input.message, { missing, requestedTypes }); } catch { /* fallback */ }
      return this.response({ message, ...base, peripheralRecommendations: baselinePeripherals, quickReplies: [] }, ConversationStage.RECOMMENDING, null, true, 'peripheral-answer');
    }
    const peripheralReserve = baselinePeripherals.reduce((sum, product) => sum + product.price, 0);
    const pcBudget = (criteria.budgetMax ?? 0) - peripheralReserve;
    if (pcBudget < 500000) {
      let message = 'El presupuesto total no alcanza para cubrir el PC y los periféricos solicitados.';
      try { message = await this.ai.answerWithVerifiedContext('peripheral-budget', 'Explica que el presupuesto no alcanza para PC y periféricos.', input.message, { totalBudget: criteria.budgetMax, peripheralReserve, pcBudget }); } catch { /* fallback */ }
      return this.response({ message, ...base, peripheralRecommendations: baselinePeripherals, bundleSummary: { totalBudget: criteria.budgetMax, reservedForPeripherals: peripheralReserve, pcBudget, peripheralTotal: peripheralReserve }, quickReplies: [] }, ConversationStage.RECOMMENDING, null, true, 'peripheral-budget');
    }
    const pcFilters: RecommendationRequestDto = { ...(await this.toRecommendationRequest(criteria)), budgetMax: pcBudget };
    const result = await this.recommendations.recommend(pcFilters);
    let message: string;
    try { message = result.recommendations.length ? await this.ai.explainRecommendations(pcFilters, result.recommendations) : await this.ai.answerWithVerifiedContext('peripheral-recommendation', 'Explica que no hay opciones responsables para el PC dentro del presupuesto restante.', input.message, { pcBudget, peripheralReserve }); }
    catch { return this.aiUnavailable(criteria, ShoppingIntent.PC_WITH_PERIPHERALS, { peripheralRecommendations: baselinePeripherals }); }
    return this.response({ message, ...base, filters: pcFilters, recommendations: result.recommendations, peripheralRecommendations: baselinePeripherals, bundleSummary: { totalBudget: criteria.budgetMax!, reservedForPeripherals: peripheralReserve, pcBudget, peripheralTotal: peripheralReserve }, scoring: result.scoring, quickReplies: [] }, ConversationStage.RECOMMENDING, null, true, 'peripheral-recommendation');
  }

  private async discoveryResponse(input: ChatRequestDto, criteria: ConversationCriteriaDto, base: Record<string, unknown>, decision: DiscoveryDecision | { awaiting: Exclude<AwaitingField, null>; stage: ConversationStage; reason: string }) {
    const awaiting = decision.awaiting as Exclude<AwaitingField, null>;
    let message: string;
    try {
      message = await this.ai.composeConversationReply({ userMessage: input.message, shoppingIntent: base.shoppingIntent as ShoppingIntent, criteria, stage: decision.stage, awaiting, verified: { reason: decision.reason, knownCriteria: criteria } });
    } catch { return this.aiUnavailable(criteria, base.shoppingIntent as ShoppingIntent); }
    return this.response({ message, ...base, criteria, filters: criteria, quickReplies: quickRepliesFor(awaiting, base.shoppingIntent as ShoppingIntent) }, decision.stage, awaiting, true, 'conversation-reply');
  }

  private async ensureQuestion(turn: ChatTurnResult | null, instruction: string, userMessage: string, verified: unknown) {
    if (turn?.reply) return turn.reply;
    try { return await this.ai.answerWithVerifiedContext('structured-action', instruction, userMessage, verified); }
    catch { return 'No pude consultar a Nova en este momento. Puedes intentar nuevamente.'; }
  }

  private response(value: Record<string, unknown>, stage: ConversationStage, awaiting: AwaitingField, aiUsed: boolean, operation: string) { return { ...value, stage, awaiting, needsMoreInformation: awaiting !== null, ...(process.env.NODE_ENV === 'development' ? { debug: { aiUsed, operation, stage } } : {}) }; }
  private base(intent: ShoppingIntent | undefined, criteria: ConversationCriteriaDto, context?: AssistantContextDto) { return { shoppingIntent: intent, criteria, filters: criteria, recommendations: [], ...(context?.lastRecommendedProductSlug ? { lastRecommendedProductSlug: context.lastRecommendedProductSlug } : {}), ...(context?.lastComparedProductSlugs ? { lastComparedProductSlugs: context.lastComparedProductSlugs } : {}), ...(context?.lastBuilderAdviceTopic ? { lastBuilderAdviceTopic: context.lastBuilderAdviceTopic } : {}), ...(context?.builderPreference ? { builderPreference: context.builderPreference } : {}) }; }
  private aiUnavailable(criteria: ConversationCriteriaDto, intent?: ShoppingIntent, extra: Record<string, unknown> = {}) { const stage = intent === ShoppingIntent.CUSTOM_PC ? ConversationStage.BUILDER : intent === ShoppingIntent.UPGRADE_PC ? ConversationStage.UPGRADE : intent === ShoppingIntent.COMPONENT ? ConversationStage.COMPONENT : ConversationStage.DISCOVER_INTENT; return this.response({ message: 'No pude consultar a Nova en este momento. Puedes intentar nuevamente.', ...this.base(intent ?? ShoppingIntent.PREBUILT_PC, criteria), quickReplies: [], ...extra }, stage, null, false, 'fallback'); }

  private applyQuickReply(reply: QuickReplyDto, previous: ConversationCriteriaDto) {
    if (reply.kind === 'SET_INTENT' && Object.values(ShoppingIntent).includes(reply.value as ShoppingIntent)) return { intent: reply.value as ShoppingIntent, criteria: previous };
    if (reply.kind === 'SET_BUDGET' && typeof reply.value === 'number' && reply.value >= 500000) return { criteria: { ...previous, budgetMax: Math.round(reply.value) } };
    if (reply.kind === 'SET_USE_PROFILE' && ['GAMING', 'CREATIVE', 'PROGRAMMING', 'OFFICE'].includes(String(reply.value))) {
      const useProfile = String(reply.value) as UseProfile;
      if (useProfile === UseProfile.GAMING) return {
        criteria: {
          ...previous,
          useProfile: UseProfile.GAMING,
          workloads: [],
          resolution: undefined,
          targetFps: undefined,
          discovery: {
            ...(previous.discovery ?? {}),
            gamingTargetAsked: false,
          },
        },
        replaceWorkloads: true,
      };
      if (useProfile === UseProfile.CREATIVE) return {
        criteria: {
          ...previous,
          useProfile: UseProfile.CREATIVE,
          workloads: [{ slug: 'blender', importance: 1 }],
          discovery: {
            ...(previous.discovery ?? {}),
          },
        },
        replaceWorkloads: true,
      };
      if (useProfile === UseProfile.PROGRAMMING) return {
        criteria: {
          ...previous,
          useProfile: UseProfile.PROGRAMMING,
          workloads: [{ slug: 'programacion', importance: 1 }],
          discovery: {
            ...(previous.discovery ?? {}),
            developmentLoadAsked: false,
          },
        },
        replaceWorkloads: true,
      };
      return {
        criteria: {
          ...previous,
          useProfile: UseProfile.OFFICE,
          workloads: [{ slug: 'ofimatica-basica', importance: 1 }],
          discovery: {
            ...(previous.discovery ?? {}),
            connectivityAsked: false,
          },
        },
        replaceWorkloads: true,
      };
    }
    if (reply.kind === 'SET_WORKLOAD' && typeof reply.value === 'string') return { criteria: { ...previous, workloads: this.mergeWorkloads(previous.workloads, [{ slug: reply.value, importance: 1 }]) } };
    if (reply.kind === 'SET_CONNECTIVITY' && ['WIFI_ONLY', 'ETHERNET_OK', 'UNSURE'].includes(String(reply.value))) {
      const value = String(reply.value);
      return { criteria: { ...previous, preferences: value === 'UNSURE' ? previous.preferences : { ...(previous.preferences ?? {}), wifiRequired: value === 'WIFI_ONLY' }, discovery: { ...(previous.discovery ?? {}), connectivityAsked: true } } };
    }
    if (reply.kind === 'SET_GAMING_TARGET' && ['1080P_144', '1440P_144', '1080P_240', 'UNSURE'].includes(String(reply.value))) {
      const target = { '1080P_144': { resolution: '1080p' as const, targetFps: 144 }, '1440P_144': { resolution: '1440p' as const, targetFps: 144 }, '1080P_240': { resolution: '1080p' as const, targetFps: 240 }, UNSURE: {} }[String(reply.value)];
      return { criteria: { ...previous, ...target, discovery: { ...(previous.discovery ?? {}), gamingTargetAsked: true } } };
    }
    if (reply.kind === 'SET_DEVELOPMENT_LOAD' && ['IDE', 'DOCKER', 'VM', 'DOCKER_VM'].includes(String(reply.value))) {
      const value = String(reply.value);
      const added = value === 'DOCKER' ? ['docker'] : value === 'VM' ? ['maquinas-virtuales'] : value === 'DOCKER_VM' ? ['docker', 'maquinas-virtuales'] : [];
      const multitaskingLevel: 'NORMAL' | 'HEAVY' = value === 'IDE' ? 'NORMAL' : 'HEAVY';
      return { criteria: { ...previous, workloads: this.mergeWorkloads(previous.workloads, added.map((slug) => ({ slug, importance: 1 }))), preferences: { ...(previous.preferences ?? {}), multitaskingLevel }, discovery: { ...(previous.discovery ?? {}), developmentLoadAsked: true } } };
    }
    if (reply.kind === 'SET_UPGRADE_GOAL' && ['GAMING', 'GAMING_1440P', 'CREATIVE', 'DEVELOPMENT', 'GENERAL'].includes(String(reply.value))) {
      const goals = { GAMING: 'Mejorar rendimiento en juegos', GAMING_1440P: 'Jugar a 1440p', CREATIVE: 'Edición y Blender', DEVELOPMENT: 'Programación, Docker y máquinas virtuales', GENERAL: 'Mejorar la fluidez general del PC' } as const;
      return { criteria: previous, upgradeGoal: goals[String(reply.value) as keyof typeof goals] };
    }
    if (reply.kind === 'SET_PERIPHERALS' && ['MONITOR', 'DESK', 'FULL', 'UNSURE'].includes(String(reply.value))) {
      const selected = { MONITOR: ['MONITOR'], DESK: ['MONITOR', 'KEYBOARD', 'MOUSE'], FULL: ['MONITOR', 'KEYBOARD', 'MOUSE', 'HEADSET'], UNSURE: undefined }[String(reply.value) as 'MONITOR' | 'DESK' | 'FULL' | 'UNSURE'];
      return { criteria: { ...previous, ...(selected ? { requestedPeripherals: selected as ConversationCriteriaDto['requestedPeripherals'] } : {}), discovery: { ...(previous.discovery ?? {}), peripheralsAsked: true } } };
    }
    if (reply.kind === 'SET_BUILDER_MODE' && ['GUIDED', 'AUTO'].includes(String(reply.value))) return { criteria: previous, builderMode: reply.value as 'GUIDED' | 'AUTO' };
    if (reply.kind === 'SEND_MESSAGE') return null;
    throw new BadRequestException('La respuesta rápida no es válida para este turno.');
  }

  private mergeCriteria(...values: Array<ConversationCriteriaDto | undefined>): ConversationCriteriaDto { return values.reduce<ConversationCriteriaDto>((current, next) => next ? { ...current, ...next, workloads: next.workloads ? this.mergeWorkloads(current.workloads, next.workloads) : current.workloads, preferences: { ...(current.preferences ?? {}), ...(next.preferences ?? {}) }, discovery: { ...(current.discovery ?? {}), ...(next.discovery ?? {}) } } : current, {}); }
  private mergeWorkloads(previous: ConversationCriteriaDto['workloads'] = [], next: ConversationCriteriaDto['workloads'] = []) { const merged = new Map((previous ?? []).map((item) => [item.slug, item])); for (const item of next ?? []) merged.set(item.slug, item); return [...merged.values()].slice(0, 8); }
  private defaultWorkloadsForUseProfile(profile: UseProfile): ConversationCriteriaDto['workloads'] {
    switch (profile) {
      case UseProfile.CREATIVE:
        return [{ slug: 'blender', importance: 1 }];
      case UseProfile.PROGRAMMING:
        return [{ slug: 'programacion', importance: 1 }];
      case UseProfile.OFFICE:
        return [{ slug: 'ofimatica-basica', importance: 1 }];
      case UseProfile.GAMING:
        return [];
      default:
        return [];
    }
  }
  private extractDeterministicCriteria(message: string, context?: AssistantContextDto): ConversationCriteriaDto { const budgetMax = this.extractBudget(message); const requestedComponent = this.detectComponentType(message, context); const resolution = /(?:1440p|2k|qhd)/i.test(message) ? '1440p' : /(?:2160p|4k)/i.test(message) ? '4k' : /1080p/i.test(message) ? '1080p' : undefined; const fps = this.normalize(message).match(/(\d{2,3})\s*(?:fps|hz)/)?.[1]; const normalized = this.normalize(message); const wifiRequired = /(?:solo|tengo|necesito|con)\s*(?:uso\s*)?(?:wi[\s-]?fi|inalambric)|(?:ethernet|cable de red|con cable)/.test(normalized) ? !/(?:ethernet|cable de red|con cable|tengo cable)/.test(normalized) : undefined; return { ...(budgetMax ? { budgetMax } : {}), ...(requestedComponent ? { requestedComponent } : {}), ...(resolution ? { resolution } : {}), ...(fps && Number(fps) >= 30 && Number(fps) <= 360 ? { targetFps: Number(fps) } : {}), ...(wifiRequired !== undefined ? { preferences: { wifiRequired } } : {}) }; }
  private async effectiveWorkloads(
    criteria: ConversationCriteriaDto,
  ): Promise<ConversationCriteriaDto['workloads']> {
    const knownWorkloads = await this.workloads.findAll();

    const knownSlugs = new Set(
      knownWorkloads.map((workload) => workload.slug),
    );

    const validExplicit = (criteria.workloads ?? [])
      .filter((item) => knownSlugs.has(item.slug));

    if (validExplicit.length) {
      const total =
        validExplicit.reduce(
          (sum, item) => sum + item.importance,
          0,
        ) || 1;

      return validExplicit.map((item) => ({
        slug: item.slug,
        importance: item.importance / total,
      }));
    }

    if (
      criteria.useProfile === UseProfile.GAMING &&
      knownSlugs.has('gaming-general')
    ) {
      return [
        {
          slug: 'gaming-general',
          importance: 1,
        },
      ];
    }

    if (
      criteria.useProfile === UseProfile.CREATIVE &&
      knownSlugs.has('blender')
    ) {
      return [
        {
          slug: 'blender',
          importance: 1,
        },
      ];
    }

    if (
      criteria.useProfile === UseProfile.PROGRAMMING &&
      knownSlugs.has('programacion')
    ) {
      return [
        {
          slug: 'programacion',
          importance: 1,
        },
      ];
    }

    if (
      criteria.useProfile === UseProfile.OFFICE &&
      knownSlugs.has('ofimatica-basica')
    ) {
      return [
        {
          slug: 'ofimatica-basica',
          importance: 1,
        },
      ];
    }

    return [];
  }

  private resolveShoppingIntent(input: {
    directIntent?: ShoppingIntent;
    explicitIntent?: ShoppingIntent;
    aiTurn: ChatTurnResult | null;
    previousIntent?: ShoppingIntent;
    context: AssistantContextDto;
  }): ShoppingIntent | undefined {
    if (input.directIntent) {
      return input.directIntent;
    }

    if (input.explicitIntent) {
      return input.explicitIntent;
    }

    const activeCustomBuilder =
      input.previousIntent === ShoppingIntent.CUSTOM_PC &&
      input.context.builderMode !== undefined &&
      input.context.builderStep !== undefined;

    if (activeCustomBuilder) {
      return ShoppingIntent.CUSTOM_PC;
    }

    const inferredIntent = input.aiTurn?.shoppingIntent;

    if (
      (!input.previousIntent || input.aiTurn?.intentChanged === true) &&
      (input.aiTurn?.intentConfidence ?? 0) >= 0.55 &&
      inferredIntent
    ) {
      return inferredIntent;
    }

    return (
      input.previousIntent ??
      inferredIntent
    );
  }

  private async sanitizeCriteria(
    criteria: ConversationCriteriaDto,
  ): Promise<ConversationCriteriaDto> {
    const known = new Set(
      (await this.workloads.findAll())
        .map((item) => item.slug),
    );

    return {
      ...criteria,
      workloads: (criteria.workloads ?? [])
        .filter((item) => known.has(item.slug)),
    };
  }

  private async toRecommendationRequest(criteria: ConversationCriteriaDto): Promise<RecommendationRequestDto> {
    const workloads = await this.effectiveWorkloads(criteria);
    if (!workloads?.length) throw new BadRequestException('Falta el uso principal para recomendar.');
    const { requestedComponent: _requestedComponent, useProfile: _useProfile, discovery: _discovery, requestedPeripherals: _requestedPeripherals, ...rest } = criteria;
    return { ...rest, workloads };
  }
  private builderConversationReplies(step?: string): QuickReplyDto[] { if (!step || step === 'DONE') return []; return [messageReply('builder-why', '¿Por qué esta?'), messageReply('builder-compare', '¿Qué diferencia hay?'), messageReply('builder-save', '¿Puedo ahorrar aquí?'), builderReply('builder-auto-select', 'Que Nova elija', 'AUTO_SELECT')]; }

  private async withProductContext(message: string, context?: AssistantContextDto) { if (!context?.productSlug) return message; const product = await this.catalog.findBySlug(context.productSlug).catch(() => null); return product ? `Producto visible verificado: ${product.name}; tipo ${product.type}; precio ${product.price}; stock ${product.stock}.\nMensaje: ${message}` : message; }
  private detectExplicitShoppingIntent(message: string): ShoppingIntent | undefined { const value = this.normalize(message); if (/(?:prefiero|quiero|mejor).*(?:pc|computador|equipo|uno).*(?:armad|listo|prearmad)|comprar\s+(?:un\s+)?(?:pc|computador|equipo)\s+listo/.test(value)) return ShoppingIntent.PREBUILT_PC; if (/mejorar|upgrade|actualizar\s+mi\s+(?:pc|computador|equipo)|tengo\s+(?:un\s+)?(?:ryzen|intel|rtx|gtx|rx)/.test(value)) return ShoppingIntent.UPGRADE_PC; if (/mejor\s+solo|buscar\s+(?:un\s+)?componente|(?:necesito|quiero)\s+(?:una\s+)?(?:gpu|grafica|cpu|procesador|ram|ssd|fuente|placa|board|motherboard|b[456]\d\d)/.test(value)) return ShoppingIntent.COMPONENT; if (/armar(?:lo|la|me)?|armemos|por\s+(?:partes|componentes)|pieza\s+por\s+pieza|configuracion\s+personalizada/.test(value)) return ShoppingIntent.CUSTOM_PC; return undefined; }
  private detectShoppingIntent(message: string): ShoppingIntent | undefined { const value = this.normalize(message); if (/mejor|upgrade|actualizar|tengo.*(?:ryzen|intel|rtx|gtx|rx)/.test(value)) return ShoppingIntent.UPGRADE_PC; if (/armar|personaliz|por partes|configur/.test(value)) return ShoppingIntent.CUSTOM_PC; if (/componente|gpu|tarjeta grafica|procesador|ram|ssd|fuente|motherboard|placa|board|b[456]\d\d/.test(value)) return ShoppingIntent.COMPONENT; return undefined; }
  private detectComponentType(message: string, context?: AssistantContextDto): ProductType | undefined { const value = this.normalize(message); if (/motherboard|placa\s+madre|placa|board|b[456]\d\d/.test(value)) return ProductType.MOTHERBOARD; if (/gpu|grafica|video/.test(value)) return ProductType.GPU; if (/cpu|procesador/.test(value)) return ProductType.CPU; if (/ram|memoria/.test(value)) return ProductType.RAM; if (/ssd|disco|almacenamiento/.test(value)) return ProductType.STORAGE; if (/fuente|psu/.test(value)) return ProductType.PSU; if (/monitor/.test(value)) return ProductType.MONITOR; if (context?.selectedComponentType && Object.values(ProductType).includes(context.selectedComponentType as ProductType)) return context.selectedComponentType as ProductType; return undefined; }
  private extractCurrentPc(message: string) { const normalized = this.normalize(message); const labeled = (label: string) => message.match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*:\\s*([^\\n]+)`, 'i'))?.[1]?.trim(); const ram = labeled('RAM')?.match(/(\d+)/)?.[1] ?? normalized.match(/(\d+)\s*gb(?:\s*(?:de\s*)?(?:ram|memoria))?/)?.[1]; const psu = normalized.match(/(?:fuente|psu)[^\d]{0,20}(\d{3,4})\s*w/)?.[1]; return { cpu: labeled('CPU') ?? message.match(/(?:amd\s+)?ryzen\s+(?:[3579]\s+)?\d{4}\w*|intel(?:\(r\))?\s+(?:core\s+)?(?:i[3579][ -]?)?\d{4,5}\w*/i)?.[0]?.trim() ?? null, gpu: labeled('GPU') ?? message.match(/(?:nvidia\s+geforce\s+|geforce\s+)?(?:rtx|gtx)\s*\d{3,4}(?:\s*(?:ti|super))?|(?:amd\s+radeon\s+|radeon\s+)?rx\s*\d{3,4}(?:\s*xt)?/i)?.[0]?.trim() ?? null, ramGb: ram ? Number(ram) : null, motherboard: labeled('Motherboard|Board|Placa') ?? null, storage: labeled('Storage|Almacenamiento|Disco') ?? null, psuW: psu ? Number(psu) : null }; }
  private extractUpgradeGoal(message: string) { const normalized = this.normalize(message); if (!/(jugar|fps|render|editar|blender|premiere|docker|virtual|multitarea|lento|tiron|espacio|1440|stream)/.test(normalized)) return undefined; return message.trim().slice(0, 160); }
  private mergeCurrentPc(previous: AssistantContextDto['currentPc'], next: ReturnType<AssistantService['extractCurrentPc']>) { return { cpu: next.cpu ?? previous?.cpu ?? null, gpu: next.gpu ?? previous?.gpu ?? null, ramGb: next.ramGb ?? previous?.ramGb ?? null, motherboard: next.motherboard ?? previous?.motherboard ?? null, storage: next.storage ?? previous?.storage ?? null, psuW: next.psuW ?? previous?.psuW ?? null }; }
  private extractBudget(message: string) { const normalized = this.normalize(message); const million = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:millones?|m)\b/); if (million) return Math.round(Number(million[1].replace(',', '.')) * 1_000_000); const thousand = normalized.match(/(\d+(?:[.,]\d+)?)\s*mil\b/); if (thousand) return Math.round(Number(thousand[1].replace(',', '.')) * 1_000); const explicit = message.match(/(?:\$|cop\s*)?([\d.]{6,})/i)?.[1]; return explicit ? Number(explicit.replace(/[.,]/g, '')) : undefined; }
  private normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  async compare(input: CompareRequestDto) { const result = await this.recommendations.recommend(input.filters); const selected = result.recommendations.filter((item) => input.slugs.includes(item.product.slug)); if (selected.length < 2) throw new BadRequestException('Selecciona al menos dos recomendaciones vigentes para comparar'); return { message: await this.ai.explainComparison(input.question, selected), recommendations: selected }; }
}
