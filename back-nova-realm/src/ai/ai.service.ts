import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RecommendationRequestDto } from '../recommendations/recommendation.dto';
import { ScoredRecommendation } from '../recommendations/recommendation.types';
import { Workload } from '../workloads/workload.types';
import { AiMessage, AiProvider } from './ai.provider';
import { CloudflareAiProvider } from './cloudflare-ai.provider';
import { OllamaAiProvider } from './ollama-ai.provider';
import { ShoppingIntent } from '../assistant/assistant.dto';

export interface InterpretedIntent {
  needsMoreInformation: boolean;
  question?: string;
  filters?: RecommendationRequestDto;
  shoppingIntent?: ShoppingIntent;
}

const NOVA_PERSONALITY = `Eres Nova, asesora tecnológica de NovaRealm. Hablas como una asesora humana dentro de una tienda online colombiana/neutra. Tu respuesta parece una conversación, no un informe: frases cortas, cercana, clara y segura, sin sonar corporativa ni excesivamente informal. Normalmente escribe 1 o 2 párrafos breves y 30-70 palabras. No uses headings, introducciones de IA ni paredes de texto. Evita frases como "de acuerdo con tus necesidades", "he analizado", "basado en los criterios" y "a continuación". No repitas en texto los datos que ya aparecen en cards; aporta criterio para decidir. No enumeres alternativas salvo que el usuario pida una comparación. Puedes usar negrita Markdown con moderación. Nunca inventes productos, precios, stock, compatibilidad, benchmarks, fitScore ni totales; usa solo datos verificados y no afirmes que una acción ocurrió si el sistema no la confirmó. No recomiendes siempre lo más caro.`;

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
    const workloadCatalog = workloads
      .map(
        (item) =>
          `${item.slug}: ${item.name}. Descripción: ${item.description}`,
      )
      .join('\n');
    const system = `${NOVA_PERSONALITY}

Tu tarea en este paso es convertir la conversación en JSON estructurado. Slugs permitidos:
${workloadCatalog}

Devuelve únicamente JSON con esta forma:
{
  "needsMoreInformation": false,
  "shoppingIntent": "PREBUILT_PC|CUSTOM_PC|UPGRADE_PC|COMPONENT|PC_WITH_PERIPHERALS",
  "question": null,
  "filters": {
    "budgetMax": 5000000,
    "budgetPreferred": 4500000,
    "resolution": "1080p|1440p|4k",
    "targetFps": 144,
    "workloads": [{ "slug": "valorant", "importance": 0.5 }],
    "preferences": { "futureUpgrade": false }
  }
}

Conserva criterios previos y refínalos con el último mensaje. Usa solo slugs de la lista. Los importances deben ser mayores que 0 y sumar aproximadamente 1. Excel, Word, PowerPoint, correo, navegación o tareas básicas se mapean obligatoriamente a ofimatica-basica; no uses programacion salvo que el usuario mencione código, un IDE o desarrollo. Si falta presupuesto o falta el uso principal, responde needsMoreInformation=true y formula UNA pregunta breve. No conviertas la conversación en formulario. No agregues texto fuera del JSON.`;

    const recent = conversation.slice(-8).map((item) => ({
      role: item.role,
      content: item.content.slice(0, 2000),
    }));
    const prompt = currentFilters
      ? `Filtros actuales verificados: ${JSON.stringify(currentFilters)}\nÚltimo mensaje: ${message}`
      : message;
    const raw = await this.call(
      [
        { role: 'system', content: system },
        ...recent,
        { role: 'user', content: prompt },
      ],
      true,
    );
    const intent = this.validateIntent(this.parseJson(raw), workloads);
    return this.applyExplicitOfficeIntent(
      message,
      intent,
      currentFilters,
      workloads,
      conversation,
    );
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
    return this.call([
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
    return this.call([
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

  private async call(messages: AiMessage[], json = false) {
    return this.provider.complete(messages, json);
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
    };
  }
}
