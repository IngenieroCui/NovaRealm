import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RecommendationRequestDto } from '../recommendations/recommendation.dto';
import { ScoredRecommendation } from '../recommendations/recommendation.types';
import { Workload } from '../workloads/workload.types';
import { AiMessage, AiProvider } from './ai.provider';
import { CloudflareAiProvider } from './cloudflare-ai.provider';
import { OllamaAiProvider } from './ollama-ai.provider';
import { ConversationCriteriaDto, ShoppingIntent } from '../assistant/assistant.dto';
import type { ComponentCandidate } from '../builder/builder.service';
import type { Product, ProductType } from '../catalog/product.types';

export interface InterpretedIntent {
  needsMoreInformation: boolean;
  question?: string;
  filters?: RecommendationRequestDto;
  shoppingIntent?: ShoppingIntent;
}

export interface ChatTurnResult {
  shoppingIntent?: ShoppingIntent;
  intentChanged: boolean;
  intentConfidence: number;
  extracted: ConversationCriteriaDto;
  builderPreference?: 'GUIDED' | 'AUTO';
  missingFields: string[];
  nextQuestionPurpose: 'INTENT' | 'USE' | 'BUDGET' | 'BUILDER_MODE' | 'COMPONENT_SELECTION' | null;
  reply: string;
}

const NOVA_PERSONALITY = `Eres Nova, asesora tecnológica de NovaRealm. Conversas como una buena asesora humana de una tienda colombiana: escuchas antes de vender, haces preguntas fáciles de responder y explicas el porqué con palabras cotidianas. Eres cercana, honesta y concreta; si una compra no aporta una mejora clara, lo dices. Normalmente escribes 1 o 2 párrafos breves y 30-80 palabras. No interrogues ni hagas varias preguntas desconectadas a la vez. Reconoce primero lo útil que ya contó la persona y pregunta solo por el dato que más cambia la recomendación. Evita jerga sin explicarla, headings, introducciones de IA, paredes de texto y frases como "de acuerdo con tus necesidades", "he analizado", "basado en los criterios" o "a continuación". No repitas lo que ya muestran las cards: aporta criterio, compromisos y riesgos. Nunca inventes productos, precios, stock, compatibilidad, benchmarks, fitScore ni totales; usa solo datos verificados y no afirmes que una acción ocurrió si el sistema no la confirmó. No recomiendes siempre lo más caro.`;

const OFFICE_KEYWORDS =
  /\b(excel|word|powerpoint|office|ofimatica|hojas? de calculo|presentaciones?|tareas? basicas?)\b/i;
const DEVELOPMENT_KEYWORDS =
  /\b(programacion|programar|codigo|visual studio|vscode|ide|docker|maquinas virtuales|unity|unreal)\b/i;
const BUDGET_EVIDENCE =
  /(?:\$|cop\s*)\s*\d[\d.,]*|\b\d+(?:[.,]\d+)?\s*(?:millones?|m|mil(?:\s+pesos)?|pesos)\b|\b\d{6,}\b/i;

@Injectable()
export class AiService {
  constructor(
    private readonly ollama: OllamaAiProvider,
    private readonly cloudflare: CloudflareAiProvider,
  ) {}

  async interpret(
    message: string,
    conversation: AiMessage[],
    workloads: Workload[],
    currentFilters?: RecommendationRequestDto,
  ): Promise<InterpretedIntent> {
    const turn = await this.chatTurn(message, conversation, workloads, currentFilters, undefined);
    const filters = this.mergeCriteria(currentFilters, turn.extracted);
    return {
      needsMoreInformation: turn.missingFields.length > 0,
      question: turn.reply,
      filters: filters.workloads?.length ? filters as RecommendationRequestDto : undefined,
      shoppingIntent: turn.shoppingIntent,
    };
  }

  async chatTurn(
    message: string,
    conversation: AiMessage[],
    workloads: Workload[],
    currentCriteria?: ConversationCriteriaDto,
    currentIntent?: ShoppingIntent,
  ): Promise<ChatTurnResult> {
    const workloadCatalog = workloads
      .map(
        (item) =>
          `${item.slug}: ${item.name}. Descripción: ${item.description}`,
      )
      .join('\n');
    const system = `${NOVA_PERSONALITY}

Analiza el último turno y redacta la respuesta real de Nova en el mismo JSON. Slugs permitidos:
${workloadCatalog}

Devuelve únicamente JSON con esta forma:
{
  "shoppingIntent": "PREBUILT_PC|CUSTOM_PC|UPGRADE_PC|COMPONENT|PC_WITH_PERIPHERALS",
  "intentChanged": false,
  "intentConfidence": 0.9,
  "extracted": {
    "budgetMax": 5000000,
    "budgetPreferred": 4500000,
    "resolution": "1080p|1440p|4k",
    "targetFps": 144,
    "workloads": [{ "slug": "valorant", "importance": 0.5 }],
    "preferences": { "futureUpgrade": false },
    "requestedComponent": "GPU"
  },
  "builderPreference": "GUIDED|AUTO|null",
  "missingFields": ["BUDGET"],
  "nextQuestionPurpose": "INTENT|USE|BUDGET|BUILDER_MODE|COMPONENT_SELECTION|null",
  "reply": "respuesta breve y contextual de Nova"
}

"extracted" contiene SOLO datos aportados o corregidos por el último mensaje; no copies criterios previos. Usa solo slugs de la lista. Los importances deben ser mayores que 0 y sumar aproximadamente 1. Marca intentChanged solo si el turno actual expresa claramente una compra o cambio de flujo. Excel, Word y tareas básicas corresponden a ofimatica-basica; programacion requiere código, IDE o desarrollo. Usa los criterios previos para no volver a preguntar lo conocido. Si falta un dato imprescindible, pregunta solo por el que más cambia la decisión. Para un componente, requestedComponent es obligatorio antes de recomendar. reply debe sonar natural, reconocer lo ya dicho y tener normalmente 30-80 palabras. No inventes productos, precios ni compatibilidad. No agregues texto fuera del JSON.`;

    const recent = conversation.slice(-8).map((item) => ({
      role: item.role,
      content: item.content.slice(0, 2000),
    }));
    const prompt = `Intención previa: ${currentIntent ?? 'sin definir'}\nCriterios previos verificados: ${JSON.stringify(currentCriteria ?? {})}\nÚltimo mensaje: ${message}`;
    const raw = await this.call(
      'interpret+reply',
      [
        { role: 'system', content: system },
        ...recent,
        { role: 'user', content: prompt },
      ],
      true,
    );
    return this.applyExplicitOfficeTurn(message, this.validateChatTurn(this.parseJson(raw), workloads), workloads);
  }

  async explainRecommendations(
    filters: RecommendationRequestDto,
    recommendations: ScoredRecommendation[],
  ) {
    const verifiedData = recommendations.map((item) => ({
      category: item.categoryLabel,
      product: {
        name: item.product.name,
        slug: item.product.slug,
        price: item.product.price,
        priceCop: this.formatCop(item.product.price),
        stock: item.product.stock,
        cpu: item.product.cpu,
        gpu: item.product.gpu,
        ramGb: item.product.ramGb,
        storageGb: item.product.storageGb,
        vramGb: item.product.vramGb,
      },
      fitScore: item.fitScore,
      performanceFit: item.performanceFit,
      budgetFit: item.budgetFit,
      workloadScores: item.workloadScores.map((score) => ({
        workload: score.workload,
        score: score.score,
      })),
      strengths: item.strengths,
      weaknesses: item.weaknesses,
    }));
    return this.call('recommendation-answer', [
      {
        role: 'system',
        content: `${NOVA_PERSONALITY}\nRedacta máximo 70 palabras. Las cards ya muestran nombres, precios, ajuste y especificaciones: no los repitas uno por uno. Elige una recomendación principal y explica una razón concreta; si aplica, menciona una alternativa más económica sin describirla completa. Si hablas de dinero usa exclusivamente priceCop, nunca price. Todos los números deben salir literalmente del JSON verificado.`,
      },
      {
        role: 'user',
        content: `Criterios: ${JSON.stringify(filters)}\nResultados verificados: ${JSON.stringify(verifiedData)}`,
      },
    ]);
  }

  async explainComparison(
    question: string,
    recommendations: ScoredRecommendation[],
  ) {
    const verifiedData = recommendations.map((item) => ({
      name: item.product.name,
      price: item.product.price,
      priceCop: this.formatCop(item.product.price),
      stock: item.product.stock,
      cpu: item.product.cpu,
      gpu: item.product.gpu,
      ramGb: item.product.ramGb,
      storageGb: item.product.storageGb,
      vramGb: item.product.vramGb,
      fitScore: item.fitScore,
      performanceFit: item.performanceFit,
      workloadScores: item.workloadScores,
    }));
    return this.call('comparison-answer', [
      {
        role: 'system',
        content: `${NOVA_PERSONALITY}\nCompara únicamente los equipos del JSON verificado. Responde en máximo 100 palabras, con una recomendación condicional clara. No inventes métricas. Si hablas de dinero usa priceCop.`,
      },
      {
        role: 'user',
        content: `${question}\nDatos verificados: ${JSON.stringify(verifiedData)}`,
      },
    ]);
  }

  async answerBuilderQuestion(question: string, context: {
    workload: Array<{ slug: string; importance: number }>;
    budgetMax?: number;
    remainingBudget?: number | null;
    currentStep: ProductType;
    currentBuild: Product[];
    candidates: ComponentCandidate[];
    lastRecommendedProductSlug?: string;
    lastComparedProductSlugs?: string[];
    balanceWarnings?: string[];
  }) {
    const verified = {
      workload: context.workload,
      budgetMax: context.budgetMax,
      remainingBudget: context.remainingBudget,
      currentStep: context.currentStep,
      currentBuild: context.currentBuild.map((item) => ({ type: item.type, name: item.name, slug: item.slug, priceCop: this.formatCop(item.price), technicalSpecs: item.technicalSpecs })),
      candidates: context.candidates.map((item) => ({ name: item.name, slug: item.slug, priceCop: this.formatCop(item.price), technicalSpecs: item.technicalSpecs, compatibility: item.compatibility, compatibilityReasons: item.compatibilityReasons, recommendationScore: item.recommendationScore, budgetImpact: item.budgetImpact, recommendedRole: item.recommendedRole, strengths: item.strengths, weaknesses: item.weaknesses })),
      lastRecommendedProductSlug: context.lastRecommendedProductSlug,
      lastComparedProductSlugs: context.lastComparedProductSlugs,
      balanceWarnings: context.balanceWarnings ?? [],
    };
    return this.call('builder-answer', [
      { role: 'system', content: `${NOVA_PERSONALITY}\nEstás acompañando un PC builder que NO debe avanzar por responder una pregunta. Responde la pregunta en 30-80 palabras y toma postura cuando los datos lo permitan. Usa exclusivamente el JSON verificado. El backend ya decidió compatibilidad y roles: jamás los recalcules ni contradigas. No repitas las cards. Si faltan datos, dilo claramente. Puedes usar markdown seguro.` },
      { role: 'user', content: `Pregunta: ${question}\nContexto verificado: ${JSON.stringify(verified)}` },
    ]);
  }

  async answerWithVerifiedContext(operation: string, instruction: string, userMessage: string, verified: unknown) {
    return this.call(operation, [
      { role: 'system', content: `${NOVA_PERSONALITY}\n${instruction} Usa únicamente los datos verificados; si falta algo, dilo sin inventar.` },
      { role: 'user', content: `Mensaje del usuario: ${userMessage}\nDatos verificados: ${JSON.stringify(verified)}` },
    ]);
  }

  private async call(operation: string, messages: AiMessage[], json = false) {
    const started = Date.now();
    const provider = this.provider;
    const providerName = provider === this.cloudflare ? 'cloudflare' : 'ollama';
    try {
      const result = await provider.complete(messages, json);
      console.log(`[NovaAI] provider=${providerName} operation=${operation} success=true latencyMs=${Date.now() - started}`);
      return result;
    } catch (error) {
      console.warn(`[NovaAI] provider=${providerName} operation=${operation} success=false latencyMs=${Date.now() - started}`);
      throw error;
    }
  }

  private validateChatTurn(raw: unknown, workloads: Workload[]): ChatTurnResult {
    if (!raw || typeof raw !== 'object') throw new ServiceUnavailableException('Nova no pudo estructurar la solicitud.');
    const data = raw as Record<string, unknown>;
    const extracted = this.validateCriteria(data.extracted, workloads);
    const purpose = ['INTENT', 'USE', 'BUDGET', 'BUILDER_MODE', 'COMPONENT_SELECTION'].includes(String(data.nextQuestionPurpose))
      ? data.nextQuestionPurpose as ChatTurnResult['nextQuestionPurpose']
      : null;
    return {
      shoppingIntent: Object.values(ShoppingIntent).includes(data.shoppingIntent as ShoppingIntent) ? data.shoppingIntent as ShoppingIntent : undefined,
      intentChanged: data.intentChanged === true,
      intentConfidence: Math.max(0, Math.min(1, Number(data.intentConfidence) || 0)),
      extracted,
      builderPreference: ['GUIDED', 'AUTO'].includes(String(data.builderPreference)) ? data.builderPreference as 'GUIDED' | 'AUTO' : undefined,
      missingFields: Array.isArray(data.missingFields) ? data.missingFields.filter((item): item is string => typeof item === 'string').slice(0, 5) : [],
      nextQuestionPurpose: purpose,
      reply: typeof data.reply === 'string' && data.reply.trim() ? data.reply.trim().slice(0, 1000) : '¿Qué te gustaría conseguir con tu próximo equipo?',
    };
  }

  private applyExplicitOfficeTurn(message: string, turn: ChatTurnResult, workloads: Workload[]): ChatTurnResult {
    const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!OFFICE_KEYWORDS.test(normalized) || DEVELOPMENT_KEYWORDS.test(normalized) || !workloads.some((item) => item.slug === 'ofimatica-basica')) return turn;
    const extracted = { ...turn.extracted, workloads: [{ slug: 'ofimatica-basica', importance: 1 }] };
    if (!BUDGET_EVIDENCE.test(message)) {
      delete extracted.budgetMax;
      delete extracted.budgetPreferred;
    }
    return { ...turn, extracted };
  }

  private validateCriteria(raw: unknown, workloads: Workload[]): ConversationCriteriaDto {
    if (!raw || typeof raw !== 'object') return {};
    const data = raw as Record<string, unknown>;
    const knownSlugs = new Set(workloads.map((item) => item.slug));
    const uses = Array.isArray(data.workloads) ? data.workloads.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object').map((item) => ({ slug: typeof item.slug === 'string' ? item.slug : '', importance: Number(item.importance) })).filter((item) => knownSlugs.has(item.slug) && item.importance > 0 && item.importance <= 1).slice(0, 8) : [];
    const number = (key: string, min: number, max = Number.MAX_SAFE_INTEGER) => Number.isFinite(Number(data[key])) && Number(data[key]) >= min && Number(data[key]) <= max ? Math.round(Number(data[key])) : undefined;
    const resolution = ['1080p', '1440p', '4k'].includes(String(data.resolution)) ? data.resolution as ConversationCriteriaDto['resolution'] : undefined;
    return {
      ...(number('budgetMax', 500000) ? { budgetMax: number('budgetMax', 500000) } : {}),
      ...(number('budgetPreferred', 500000) ? { budgetPreferred: number('budgetPreferred', 500000) } : {}),
      ...(uses.length ? { workloads: uses } : {}),
      ...(resolution ? { resolution } : {}),
      ...(number('targetFps', 30, 360) ? { targetFps: number('targetFps', 30, 360) } : {}),
      ...(data.preferences && typeof data.preferences === 'object' && typeof (data.preferences as Record<string, unknown>).futureUpgrade === 'boolean' ? { preferences: { futureUpgrade: (data.preferences as Record<string, unknown>).futureUpgrade as boolean } } : {}),
      ...(typeof data.requestedComponent === 'string' && ['CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'STORAGE', 'PSU', 'COOLING', 'CASE', 'MONITOR'].includes(data.requestedComponent) ? { requestedComponent: data.requestedComponent } : {}),
    };
  }

  private mergeCriteria(previous: ConversationCriteriaDto | undefined, extracted: ConversationCriteriaDto): ConversationCriteriaDto {
    return { ...(previous ?? {}), ...extracted, preferences: { ...(previous?.preferences ?? {}), ...(extracted.preferences ?? {}) } };
  }

  private formatCop(value: number) {
    return `$${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value)} COP`;
  }

  private get provider(): AiProvider {
    const provider = (process.env.AI_PROVIDER ?? (process.env.VERCEL ? 'cloudflare' : 'ollama')).trim().toLowerCase();
    if (provider === 'cloudflare') return this.cloudflare;
    if (provider === 'ollama') return this.ollama;
    throw new ServiceUnavailableException('Nova no está disponible en este momento.');
  }

  private parseJson(content: string): unknown {
    try {
      const cleaned = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      return JSON.parse(cleaned);
    } catch {
      throw new ServiceUnavailableException(
        'Nova no pudo procesar la solicitud. Intenta reformular tu mensaje.',
      );
    }
  }

  private validateIntent(
    raw: unknown,
    workloads: Workload[],
  ): InterpretedIntent {
    if (!raw || typeof raw !== 'object') {
      throw new ServiceUnavailableException(
        'Nova no pudo estructurar la solicitud.',
      );
    }
    const data = raw as Record<string, unknown>;
    const rawFilters = data.filters as Record<string, unknown> | undefined;
    const knownSlugs = new Set(workloads.map((item) => item.slug));
    const rawUses = Array.isArray(rawFilters?.workloads)
      ? rawFilters.workloads
      : [];
    const normalizedUses = rawUses
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object',
      )
      .map((item) => ({
        slug: typeof item.slug === 'string' ? item.slug : '',
        importance: Number(item.importance ?? 0),
      }))
      .filter(
        (item) =>
          knownSlugs.has(item.slug) &&
          item.importance > 0 &&
          item.importance <= 1,
      )
      .slice(0, 8);
    const budgetMax = Number(rawFilters?.budgetMax);
    const budgetPreferred = Number(rawFilters?.budgetPreferred);
    const targetFps = Number(rawFilters?.targetFps);
    const resolution = ['1080p', '1440p', '4k'].includes(
      String(rawFilters?.resolution),
    )
      ? (rawFilters?.resolution as '1080p' | '1440p' | '4k')
      : undefined;
    const preferences = rawFilters?.preferences as
      Record<string, unknown> | undefined;
    const filters: RecommendationRequestDto | undefined = normalizedUses.length
      ? {
          workloads: normalizedUses,
          ...(Number.isFinite(budgetMax) && budgetMax >= 500000
            ? { budgetMax: Math.round(budgetMax) }
            : {}),
          ...(Number.isFinite(budgetPreferred) && budgetPreferred >= 500000
            ? { budgetPreferred: Math.round(budgetPreferred) }
            : {}),
          ...(resolution ? { resolution } : {}),
          ...(Number.isFinite(targetFps) && targetFps >= 30 && targetFps <= 360
            ? { targetFps: Math.round(targetFps) }
            : {}),
          ...(preferences && typeof preferences.futureUpgrade === 'boolean'
            ? { preferences: { futureUpgrade: preferences.futureUpgrade } }
            : {}),
        }
      : undefined;
    const missingImportant = !filters?.workloads.length || !filters.budgetMax;
    return {
      needsMoreInformation:
        Boolean(data.needsMoreInformation) || missingImportant,
      question:
        typeof data.question === 'string' && data.question.trim()
          ? data.question.trim().slice(0, 220)
          : !filters?.workloads.length
            ? '¿Qué juegos o programas usarás principalmente?'
            : !filters.budgetMax
              ? '¿Cuál es tu presupuesto máximo aproximado?'
              : undefined,
      filters,
      shoppingIntent: Object.values(ShoppingIntent).includes(data.shoppingIntent as ShoppingIntent)
        ? (data.shoppingIntent as ShoppingIntent)
        : undefined,
    };
  }

  /**
   * Excel, Word y la ofimática no requieren el perfil de programación.
   * Este ajuste determinista evita que una inferencia errónea del proveedor de IA
   * cambie una necesidad explícita por un workload más exigente.
   */
  private applyExplicitOfficeIntent(
    message: string,
    intent: InterpretedIntent,
    currentFilters: RecommendationRequestDto | undefined,
    workloads: Workload[],
    conversation: AiMessage[],
  ): InterpretedIntent {
    const normalizedMessage = message
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const officeWorkload = workloads.find(
      (workload) => workload.slug === 'ofimatica-basica',
    );
    if (
      !officeWorkload ||
      !OFFICE_KEYWORDS.test(normalizedMessage) ||
      DEVELOPMENT_KEYWORDS.test(normalizedMessage)
    ) {
      return intent;
    }

    const candidateFilters: Partial<RecommendationRequestDto> =
      intent.filters ?? currentFilters ?? {};
    const hasBudgetEvidence = [
      ...conversation
        .filter((item) => item.role === 'user')
        .map((item) => item.content),
      message,
    ].some((content) => BUDGET_EVIDENCE.test(content));
    const { budgetMax, budgetPreferred, ...filtersWithoutBudget } =
      candidateFilters;
    const filters = {
      ...(hasBudgetEvidence
        ? { ...filtersWithoutBudget, budgetMax, budgetPreferred }
        : filtersWithoutBudget),
      workloads: [{ slug: officeWorkload.slug, importance: 1 }],
    } as RecommendationRequestDto;
    const needsBudget = !filters.budgetMax;
    return {
      needsMoreInformation: needsBudget,
      question: needsBudget
        ? 'Para Excel, Word y tareas básicas basta un equipo sencillo. ¿Cuál es tu presupuesto máximo aproximado?'
        : undefined,
      filters,
      shoppingIntent: intent.shoppingIntent,
    };
  }
}
