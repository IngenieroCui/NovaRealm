import { BadRequestException, Injectable } from '@nestjs/common';
import { AiService, ChatTurnResult } from '../ai/ai.service';
import { BuilderService, ComponentCandidate } from '../builder/builder.service';
import { ProductType } from '../catalog/product.types';
import { CatalogService } from '../catalog/catalog.service';
import { RecommendationRequestDto } from '../recommendations/recommendation.dto';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { WorkloadsService } from '../workloads/workloads.service';
import { AssistantActionRequestDto, AssistantContextDto, AwaitingField, ChatRequestDto, CompareRequestDto, ConversationCriteriaDto, ConversationStage, QuickReplyDto, ShoppingIntent } from './assistant.dto';
import { builderReply, messageReply, quickRepliesFor } from './quick-reply.factory';

const BUILDER_COMPONENT_TYPES = [ProductType.CPU, ProductType.MOTHERBOARD, ProductType.RAM, ProductType.GPU, ProductType.STORAGE, ProductType.PSU, ProductType.COOLING, ProductType.CASE];
const WINDOWS_SPECS_COMMAND = `$cpu=(Get-CimInstance Win32_Processor).Name; $gpu=(Get-CimInstance Win32_VideoController).Name -join ', '; $ram=[math]::Round(((Get-CimInstance Win32_PhysicalMemory | Measure-Object Capacity -Sum).Sum/1GB)); $board=(Get-CimInstance Win32_BaseBoard | ForEach-Object { $_.Manufacturer + ' ' + $_.Product }) -join ', '; $disk=(Get-CimInstance Win32_DiskDrive).Model -join ', '; [pscustomobject]@{ CPU=$cpu; GPU=$gpu; RAM="$ram GB"; Motherboard=$board; Storage=$disk } | Format-List`;
const SYSTEM_INFO_GUIDE = {
  title: 'Obtener las especificaciones en Windows', command: WINDOWS_SPECS_COMMAND,
  steps: ['Haz clic derecho en Inicio y abre Terminal o PowerShell. No necesitas permisos de administrador.', 'Copia y pega el comando, presiona Enter y espera unos segundos.', 'Copia aquí el resultado. El comando solo lee nombres de hardware; no cambia nada ni muestra archivos personales.'],
  note: 'La fuente de poder no aparece en Windows. Si luego recomendamos una GPU, te pediré mirar la etiqueta de la fuente o enviar su modelo.',
};

@Injectable()
export class AssistantService {
  constructor(private readonly ai: AiService, private readonly workloads: WorkloadsService, private readonly recommendations: RecommendationsService, private readonly builder: BuilderService, private readonly catalog: CatalogService) {}

  async chat(input: ChatRequestDto) {
    const previousCriteria = input.criteria ?? input.filters ?? {};
    const direct = input.quickReply ? this.applyQuickReply(input.quickReply, previousCriteria) : null;
    const analysisMessage = await this.withProductContext(input.message, input.context);
    let aiTurn: ChatTurnResult | null = null;
    if (!direct) {
      try { aiTurn = await this.ai.chatTurn(analysisMessage, input.conversation ?? [], await this.workloads.findAll(), previousCriteria, input.context?.shoppingIntent ?? input.shoppingIntent); }
      catch { return this.aiUnavailable(previousCriteria, input.context?.shoppingIntent ?? input.shoppingIntent); }
    }
    const explicitIntent = this.detectExplicitShoppingIntent(input.message);
    const previousIntent = input.context?.shoppingIntent ?? input.shoppingIntent;
    const inferredIntent = aiTurn?.shoppingIntent;
    const shoppingIntent = direct?.intent ?? explicitIntent ?? ((aiTurn?.intentChanged || !previousIntent) && (aiTurn?.intentConfidence ?? 0) >= 0.55 ? inferredIntent : undefined) ?? previousIntent ?? inferredIntent ?? this.detectShoppingIntent(input.message);
    const intentChanged = Boolean(previousIntent && shoppingIntent !== previousIntent);
    const criteria = this.mergeCriteria(previousCriteria, aiTurn?.extracted, this.extractDeterministicCriteria(input.message, input.context), direct?.criteria);
    const builderMode = intentChanged ? direct?.builderMode : direct?.builderMode ?? aiTurn?.builderPreference ?? input.context?.builderMode;
    const base = this.base(shoppingIntent, criteria);
    if (shoppingIntent === ShoppingIntent.CUSTOM_PC && builderMode === 'GUIDED' && input.context?.builderStep && BUILDER_COMPONENT_TYPES.includes(input.context.builderStep as ProductType)) return this.handleGuidedBuilder(input, criteria, base);
    if (shoppingIntent === ShoppingIntent.UPGRADE_PC) return this.handleUpgrade(input, criteria, aiTurn, base);
    if (shoppingIntent === ShoppingIntent.COMPONENT) return this.handleComponent(input, criteria, aiTurn, base);
    if (shoppingIntent === ShoppingIntent.CUSTOM_PC) return this.handleCustomPc(input, criteria, builderMode, aiTurn, base);
    return this.handlePrebuilt(input, criteria, aiTurn, base);
  }

  async action(input: AssistantActionRequestDto) {
    const criteria = input.criteria ?? {};
    const result = await this.builder.applyAction(input.builderAction);
    const candidates = (result.recommendations ?? []) as ComponentCandidate[];
    const recommended = candidates.find((item) => item.recommendedRole === 'RECOMMENDED') ?? candidates[0];
    let message: string;
    try {
      message = await this.ai.composeConversationReply({ userMessage: input.builderAction.label ?? input.builderAction.action, shoppingIntent: ShoppingIntent.CUSTOM_PC, criteria, stage: result.flow?.currentStep === 'DONE' ? ConversationStage.COMPLETE : ConversationStage.BUILDER, awaiting: null, verified: { action: result.action, selectedProduct: result.product, build: result.summary, flow: result.flow, nextCandidates: candidates.slice(0, 5) } });
    } catch { return this.aiUnavailable(criteria, ShoppingIntent.CUSTOM_PC, { build: result.summary, flow: result.flow, componentRecommendations: candidates }); }
    return this.response({ message, ...this.base(ShoppingIntent.CUSTOM_PC, criteria), build: result.summary, flow: result.flow, componentRecommendations: candidates, lastRecommendedProductSlug: recommended?.slug, lastComparedProductSlugs: [], lastBuilderAdviceTopic: result.flow?.currentStep, builderPreference: input.context?.builderPreference, quickReplies: this.builderConversationReplies(result.flow?.currentStep) }, result.flow?.currentStep === 'DONE' ? ConversationStage.COMPLETE : ConversationStage.BUILDER, null, true, 'builder-action');
  }

  private async handlePrebuilt(input: ChatRequestDto, criteria: ConversationCriteriaDto, turn: ChatTurnResult | null, base: Record<string, unknown>) {
    const awaiting = this.discoveryAwaiting(criteria);
    if (awaiting) return this.discoveryResponse(input, criteria, turn, base, awaiting, awaiting === 'USE' ? ConversationStage.DISCOVER_USE : ConversationStage.DISCOVER_BUDGET);
    const filters = this.toRecommendationRequest(criteria);
    const result = await this.recommendations.recommend(filters);
    let message: string;
    try { message = result.recommendations.length ? await this.ai.explainRecommendations(filters, result.recommendations) : await this.ai.answerWithVerifiedContext('recommendation-answer', 'Explica que no hay opciones responsables y propone ajustar un solo criterio.', input.message, { criteria, availableRecommendations: [] }); }
    catch { return this.aiUnavailable(criteria, base.shoppingIntent as ShoppingIntent); }
    return this.response({ message, ...base, filters, criteria, recommendations: result.recommendations, scoring: result.scoring, quickReplies: [] }, ConversationStage.RECOMMENDING, null, true, 'recommendation-answer');
  }

  private async handleCustomPc(input: ChatRequestDto, criteria: ConversationCriteriaDto, mode: 'GUIDED' | 'AUTO' | undefined, turn: ChatTurnResult | null, base: Record<string, unknown>) {
    const awaiting = this.discoveryAwaiting(criteria);
    if (awaiting) return this.discoveryResponse(input, criteria, turn, base, awaiting, awaiting === 'USE' ? ConversationStage.DISCOVER_USE : ConversationStage.DISCOVER_BUDGET);
    if (!mode) return this.discoveryResponse(input, criteria, turn, base, 'BUILDER_MODE', ConversationStage.BUILDER_MODE);
    const workloads = criteria.workloads ?? [];
    if (mode === 'AUTO') {
      const build = await this.builder.autoBuild({ budgetMax: criteria.budgetMax!, workloadSlugs: workloads.map((item) => item.slug), assembly: input.context?.assemblySelected });
      const flow = await this.builder.flow(build.products.map((item) => item.slug), 'AUTO');
      let message: string;
      try { message = await this.ai.composeConversationReply({ userMessage: input.message, shoppingIntent: ShoppingIntent.CUSTOM_PC, criteria, stage: ConversationStage.COMPLETE, awaiting: null, verified: { build, flow } }); }
      catch { return this.aiUnavailable(criteria, ShoppingIntent.CUSTOM_PC, { build, flow }); }
      return this.response({ message, ...base, build, flow, quickReplies: [] }, ConversationStage.COMPLETE, null, true, 'builder-answer');
    }
    const result = await this.builder.applyAction({ action: 'START_GUIDED', currentSlugs: input.context?.buildSlugs ?? [], budgetMax: criteria.budgetMax, workloads, mode: 'GUIDED', assemblySelected: input.context?.assemblySelected });
    let message: string;
    try { message = await this.ai.composeConversationReply({ userMessage: input.message, shoppingIntent: ShoppingIntent.CUSTOM_PC, criteria, stage: ConversationStage.BUILDER, awaiting: null, verified: { build: result.summary, flow: result.flow, candidates: result.recommendations } }); }
    catch { return this.aiUnavailable(criteria, ShoppingIntent.CUSTOM_PC, { build: result.summary, flow: result.flow }); }
    const candidates = result.recommendations as ComponentCandidate[];
    return this.response({ message, ...base, build: result.summary, flow: result.flow, componentRecommendations: candidates, lastRecommendedProductSlug: candidates.find((item) => item.recommendedRole === 'RECOMMENDED')?.slug ?? candidates[0]?.slug, quickReplies: this.builderConversationReplies(result.flow.currentStep) }, ConversationStage.BUILDER, null, true, 'builder-answer');
  }

  private async handleComponent(input: ChatRequestDto, criteria: ConversationCriteriaDto, turn: ChatTurnResult | null, base: Record<string, unknown>) {
    if (!criteria.requestedComponent) return this.discoveryResponse(input, criteria, turn, base, 'COMPONENT_SELECTION', ConversationStage.COMPONENT);
    const awaiting = this.discoveryAwaiting(criteria);
    if (awaiting) return this.discoveryResponse(input, criteria, turn, base, awaiting, awaiting === 'USE' ? ConversationStage.DISCOVER_USE : ConversationStage.DISCOVER_BUDGET);
    const result = await this.builder.recommendComponents({ componentType: criteria.requestedComponent as ProductType, itemSlugs: input.context?.buildSlugs ?? [], budgetMax: criteria.budgetMax, workloads: criteria.workloads, assemblySelected: input.context?.assemblySelected });
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
    if (!upgradeGoal) return this.discoveryResponse(input, criteria, turn, { ...base, currentPc }, 'USE', ConversationStage.UPGRADE);
    if (!criteria.budgetMax) return this.discoveryResponse(input, criteria, turn, { ...base, currentPc, upgradeGoal }, 'BUDGET', ConversationStage.UPGRADE);
    const upgrade = await this.builder.analyzeUpgrade({ ...currentPc, goal: upgradeGoal, budgetMax: criteria.budgetMax });
    let message: string;
    try { message = await this.ai.composeConversationReply({ userMessage: input.message, shoppingIntent: ShoppingIntent.UPGRADE_PC, criteria, stage: ConversationStage.UPGRADE, awaiting: null, verified: { upgrade } }); }
    catch { return this.aiUnavailable(criteria, ShoppingIntent.UPGRADE_PC, { currentPc, upgradeGoal, upgradeAnalysis: upgrade }); }
    return this.response({ message, ...base, currentPc, upgradeGoal, upgradeAnalysis: upgrade, upgradeRecommendations: upgrade.recommendations, quickReplies: [] }, ConversationStage.UPGRADE, null, true, 'upgrade-answer');
  }

  private async handleGuidedBuilder(input: ChatRequestDto, criteria: ConversationCriteriaDto, base: Record<string, unknown>) {
    const currentSlugs = input.context?.buildSlugs ?? [];
    const flow = await this.builder.flow(currentSlugs, 'GUIDED');
    const build = await this.builder.summarize({ itemSlugs: currentSlugs, budgetMax: criteria.budgetMax, workloads: criteria.workloads, assemblySelected: input.context?.assemblySelected });
    if (!BUILDER_COMPONENT_TYPES.includes(flow.currentStep as ProductType)) {
      let message: string;
      try { message = await this.ai.answerWithVerifiedContext('builder-answer', 'Responde la duda sobre la configuración terminada sin modificarla.', input.message, { criteria, build, flow }); }
      catch { return this.aiUnavailable(criteria, ShoppingIntent.CUSTOM_PC, { build, flow }); }
      return this.response({ message, ...base, build, flow, quickReplies: [] }, ConversationStage.COMPLETE, null, true, 'builder-answer');
    }
    const currentStep = flow.currentStep as ProductType;
    const candidateResult = await this.builder.recommendComponents({ componentType: currentStep, itemSlugs: currentSlugs, budgetMax: criteria.budgetMax, workloads: criteria.workloads, assemblySelected: input.context?.assemblySelected, preference: input.context?.builderPreference === 'balanced' ? undefined : input.context?.builderPreference });
    const candidates = candidateResult.recommendations;
    const recommended = candidates.find((item) => item.recommendedRole === 'RECOMMENDED') ?? candidates[0];
    let message: string;
    try { message = await this.ai.answerBuilderQuestion(input.message, { workload: criteria.workloads ?? [], budgetMax: criteria.budgetMax, remainingBudget: build.budgetRemaining, currentStep, currentBuild: build.components, candidates, lastRecommendedProductSlug: input.context?.lastRecommendedProductSlug ?? recommended?.slug, lastComparedProductSlugs: input.context?.lastComparedProductSlugs, balanceWarnings: build.warnings }); }
    catch { return this.aiUnavailable(criteria, ShoppingIntent.CUSTOM_PC, { build, flow, componentRecommendations: candidates }); }
    return this.response({ message, ...base, build, flow, componentRecommendations: candidates, warnings: candidateResult.warnings, lastRecommendedProductSlug: recommended?.slug ?? input.context?.lastRecommendedProductSlug, lastComparedProductSlugs: input.context?.lastComparedProductSlugs, lastBuilderAdviceTopic: currentStep, builderPreference: input.context?.builderPreference, quickReplies: this.builderConversationReplies(currentStep) }, ConversationStage.BUILDER, null, true, 'builder-answer');
  }

  private async discoveryResponse(input: ChatRequestDto, criteria: ConversationCriteriaDto, turn: ChatTurnResult | null, base: Record<string, unknown>, awaiting: Exclude<AwaitingField, null>, stage: ConversationStage) {
    let message = turn?.nextQuestionPurpose === awaiting ? turn.reply : undefined;
    if (!message) {
      try { message = await this.ai.composeConversationReply({ userMessage: input.message, shoppingIntent: base.shoppingIntent as ShoppingIntent, criteria, stage, awaiting, verified: { reason: `El backend necesita únicamente ${awaiting}` } }); }
      catch { return this.aiUnavailable(criteria, base.shoppingIntent as ShoppingIntent); }
    }
    return this.response({ message, ...base, criteria, filters: criteria, quickReplies: quickRepliesFor(awaiting, base.shoppingIntent as ShoppingIntent) }, stage, awaiting, true, turn?.nextQuestionPurpose === awaiting ? 'interpret+reply' : 'conversation-reply');
  }

  private async ensureQuestion(turn: ChatTurnResult | null, instruction: string, userMessage: string, verified: unknown) {
    if (turn?.reply) return turn.reply;
    try { return await this.ai.answerWithVerifiedContext('structured-action', instruction, userMessage, verified); }
    catch { return 'No pude consultar a Nova en este momento. Puedes intentar nuevamente.'; }
  }

  private response(value: Record<string, unknown>, stage: ConversationStage, awaiting: AwaitingField, aiUsed: boolean, operation: string) { return { ...value, stage, awaiting, needsMoreInformation: awaiting !== null, ...(process.env.NODE_ENV === 'development' ? { debug: { aiUsed, operation, stage } } : {}) }; }
  private base(intent: ShoppingIntent, criteria: ConversationCriteriaDto) { return { shoppingIntent: intent, criteria, filters: criteria, recommendations: [] }; }
  private aiUnavailable(criteria: ConversationCriteriaDto, intent?: ShoppingIntent, extra: Record<string, unknown> = {}) { const stage = intent === ShoppingIntent.CUSTOM_PC ? ConversationStage.BUILDER : intent === ShoppingIntent.UPGRADE_PC ? ConversationStage.UPGRADE : intent === ShoppingIntent.COMPONENT ? ConversationStage.COMPONENT : ConversationStage.DISCOVER_INTENT; return this.response({ message: 'No pude consultar a Nova en este momento. Puedes intentar nuevamente.', ...this.base(intent ?? ShoppingIntent.PREBUILT_PC, criteria), quickReplies: [], ...extra }, stage, null, false, 'fallback'); }
  private discoveryAwaiting(criteria: ConversationCriteriaDto): 'USE' | 'BUDGET' | null { if (!criteria.workloads?.length) return 'USE'; if (!criteria.budgetMax) return 'BUDGET'; return null; }

  private applyQuickReply(reply: QuickReplyDto, previous: ConversationCriteriaDto) {
    if (reply.kind === 'SET_INTENT' && Object.values(ShoppingIntent).includes(reply.value as ShoppingIntent)) return { intent: reply.value as ShoppingIntent, criteria: previous };
    if (reply.kind === 'SET_BUDGET' && typeof reply.value === 'number' && reply.value >= 500000) return { criteria: { ...previous, budgetMax: Math.round(reply.value) } };
    if (reply.kind === 'SET_WORKLOAD' && typeof reply.value === 'string') return { criteria: { ...previous, workloads: [{ slug: reply.value, importance: 1 }] } };
    if (reply.kind === 'SET_BUILDER_MODE' && ['GUIDED', 'AUTO'].includes(String(reply.value))) return { criteria: previous, builderMode: reply.value as 'GUIDED' | 'AUTO' };
    if (reply.kind === 'SEND_MESSAGE') return null;
    throw new BadRequestException('La respuesta rápida no es válida para este turno.');
  }

  private mergeCriteria(...values: Array<ConversationCriteriaDto | undefined>): ConversationCriteriaDto { return values.reduce<ConversationCriteriaDto>((current, next) => next ? { ...current, ...next, preferences: { ...(current.preferences ?? {}), ...(next.preferences ?? {}) } } : current, {}); }
  private extractDeterministicCriteria(message: string, context?: AssistantContextDto): ConversationCriteriaDto { const budgetMax = this.extractBudget(message); const requestedComponent = this.detectComponentType(message, context); const resolution = /(?:1440p|2k|qhd)/i.test(message) ? '1440p' : /(?:2160p|4k)/i.test(message) ? '4k' : /1080p/i.test(message) ? '1080p' : undefined; const fps = this.normalize(message).match(/(\d{2,3})\s*(?:fps|hz)/)?.[1]; return { ...(budgetMax ? { budgetMax } : {}), ...(requestedComponent ? { requestedComponent } : {}), ...(resolution ? { resolution } : {}), ...(fps && Number(fps) >= 30 && Number(fps) <= 360 ? { targetFps: Number(fps) } : {}) }; }
  private toRecommendationRequest(criteria: ConversationCriteriaDto): RecommendationRequestDto { if (!criteria.workloads?.length) throw new BadRequestException('Falta el uso principal para recomendar.'); const { requestedComponent: _requestedComponent, ...rest } = criteria; return { ...rest, workloads: criteria.workloads }; }
  private builderConversationReplies(step?: string): QuickReplyDto[] { if (!step || step === 'DONE') return []; return [messageReply('builder-why', '¿Por qué esta?'), messageReply('builder-compare', '¿Qué diferencia hay?'), messageReply('builder-save', '¿Puedo ahorrar aquí?'), builderReply('builder-auto-select', 'Que Nova elija', 'AUTO_SELECT')]; }

  private async withProductContext(message: string, context?: AssistantContextDto) { if (!context?.productSlug) return message; const product = await this.catalog.findBySlug(context.productSlug).catch(() => null); return product ? `Producto visible verificado: ${product.name}; tipo ${product.type}; precio ${product.price}; stock ${product.stock}.\nMensaje: ${message}` : message; }
  private detectExplicitShoppingIntent(message: string): ShoppingIntent | undefined { const value = this.normalize(message); if (/(?:prefiero|quiero|mejor).*(?:pc|computador|equipo|uno).*(?:armad|listo|prearmad)|comprar\s+(?:un\s+)?(?:pc|computador|equipo)\s+listo/.test(value)) return ShoppingIntent.PREBUILT_PC; if (/mejorar|upgrade|actualizar\s+mi\s+(?:pc|computador|equipo)|tengo\s+(?:un\s+)?(?:ryzen|intel|rtx|gtx|rx)/.test(value)) return ShoppingIntent.UPGRADE_PC; if (/mejor\s+solo|buscar\s+(?:un\s+)?componente|(?:necesito|quiero)\s+(?:una\s+)?(?:gpu|grafica|cpu|procesador|ram|ssd|fuente)/.test(value)) return ShoppingIntent.COMPONENT; if (/armar(?:lo|la|me)?|armemos|por\s+(?:partes|componentes)|pieza\s+por\s+pieza|configuracion\s+personalizada/.test(value)) return ShoppingIntent.CUSTOM_PC; return undefined; }
  private detectShoppingIntent(message: string): ShoppingIntent { const value = this.normalize(message); if (/mejor|upgrade|actualizar|tengo.*(?:ryzen|intel|rtx|gtx|rx)/.test(value)) return ShoppingIntent.UPGRADE_PC; if (/armar|personaliz|por partes|configur/.test(value)) return ShoppingIntent.CUSTOM_PC; if (/componente|gpu|tarjeta grafica|procesador|ram|ssd|fuente/.test(value)) return ShoppingIntent.COMPONENT; return ShoppingIntent.PREBUILT_PC; }
  private detectComponentType(message: string, context?: AssistantContextDto): ProductType | undefined { const value = this.normalize(message); if (/gpu|grafica|video/.test(value)) return ProductType.GPU; if (/cpu|procesador/.test(value)) return ProductType.CPU; if (/ram|memoria/.test(value)) return ProductType.RAM; if (/ssd|disco|almacenamiento/.test(value)) return ProductType.STORAGE; if (/fuente|psu/.test(value)) return ProductType.PSU; if (/monitor/.test(value)) return ProductType.MONITOR; if (context?.selectedComponentType && Object.values(ProductType).includes(context.selectedComponentType as ProductType)) return context.selectedComponentType as ProductType; return undefined; }
  private extractCurrentPc(message: string) { const normalized = this.normalize(message); const labeled = (label: string) => message.match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*:\\s*([^\\n]+)`, 'i'))?.[1]?.trim(); const ram = labeled('RAM')?.match(/(\d+)/)?.[1] ?? normalized.match(/(\d+)\s*gb(?:\s*(?:de\s*)?(?:ram|memoria))?/)?.[1]; const psu = normalized.match(/(?:fuente|psu)[^\d]{0,20}(\d{3,4})\s*w/)?.[1]; return { cpu: labeled('CPU') ?? message.match(/(?:amd\s+)?ryzen\s+(?:[3579]\s+)?\d{4}\w*|intel(?:\(r\))?\s+(?:core\s+)?(?:i[3579][ -]?)?\d{4,5}\w*/i)?.[0]?.trim() ?? null, gpu: labeled('GPU') ?? message.match(/(?:nvidia\s+geforce\s+|geforce\s+)?(?:rtx|gtx)\s*\d{3,4}(?:\s*(?:ti|super))?|(?:amd\s+radeon\s+|radeon\s+)?rx\s*\d{3,4}(?:\s*xt)?/i)?.[0]?.trim() ?? null, ramGb: ram ? Number(ram) : null, motherboard: labeled('Motherboard|Board|Placa') ?? null, storage: labeled('Storage|Almacenamiento|Disco') ?? null, psuW: psu ? Number(psu) : null }; }
  private extractUpgradeGoal(message: string) { const normalized = this.normalize(message); if (!/(jugar|fps|render|editar|blender|premiere|docker|virtual|multitarea|lento|tiron|espacio|1440|stream)/.test(normalized)) return undefined; return message.trim().slice(0, 160); }
  private mergeCurrentPc(previous: AssistantContextDto['currentPc'], next: ReturnType<AssistantService['extractCurrentPc']>) { return { cpu: next.cpu ?? previous?.cpu ?? null, gpu: next.gpu ?? previous?.gpu ?? null, ramGb: next.ramGb ?? previous?.ramGb ?? null, motherboard: next.motherboard ?? previous?.motherboard ?? null, storage: next.storage ?? previous?.storage ?? null, psuW: next.psuW ?? previous?.psuW ?? null }; }
  private extractBudget(message: string) { const million = this.normalize(message).match(/(\d+(?:[.,]\d+)?)\s*(?:millones?|m)\b/); if (million) return Math.round(Number(million[1].replace(',', '.')) * 1_000_000); const explicit = message.match(/(?:\$|cop\s*)?([\d.]{6,})/i)?.[1]; return explicit ? Number(explicit.replace(/[.,]/g, '')) : undefined; }
  private normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  async compare(input: CompareRequestDto) { const result = await this.recommendations.recommend(input.filters); const selected = result.recommendations.filter((item) => input.slugs.includes(item.product.slug)); if (selected.length < 2) throw new BadRequestException('Selecciona al menos dos recomendaciones vigentes para comparar'); return { message: await this.ai.explainComparison(input.question, selected), recommendations: selected }; }
}
