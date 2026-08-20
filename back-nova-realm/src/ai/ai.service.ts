import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RecommendationRequestDto } from '../recommendations/recommendation.dto';
import { ScoredRecommendation } from '../recommendations/recommendation.types';
import { Workload } from '../workloads/workload.types';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaResponse {
  message?: { content?: string };
}

export interface InterpretedIntent {
  needsMoreInformation: boolean;
  question?: string;
  filters?: RecommendationRequestDto;
}

const NOVA_PERSONALITY = `Eres Nova, asesora tecnológica de NovaRealm. Habla español natural, sencillo y cercano. No eres agresiva vendiendo y no recomiendas necesariamente lo más caro. Nunca inventes productos, precios, stock, características, benchmarks, porcentajes ni rendimiento. Utiliza exclusivamente los datos entregados por el backend. Explica tecnología para una persona no técnica y evita interrogatorios.`;

const OFFICE_KEYWORDS =
  /\b(excel|word|powerpoint|office|ofimatica|hojas? de calculo|presentaciones?|tareas? basicas?)\b/i;
const DEVELOPMENT_KEYWORDS =
  /\b(programacion|programar|codigo|visual studio|vscode|ide|docker|maquinas virtuales|unity|unreal)\b/i;
const BUDGET_EVIDENCE =
  /(?:\$|cop\s*)\s*\d[\d.,]*|\b\d+(?:[.,]\d+)?\s*(?:millones?|m|mil(?:\s+pesos)?|pesos)\b|\b\d{6,}\b/i;

@Injectable()
export class AiService {
  private get baseUrl() {
    return (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(
      /\/$/,
      '',
    );
  }

  private get model() {
    return process.env.OLLAMA_MODEL ?? 'qwen3.5:4b';
  }

  async interpret(
    message: string,
    conversation: OllamaMessage[],
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
        content: `${NOVA_PERSONALITY}\nRedacta máximo 130 palabras. Presenta las alternativas y explica en lenguaje simple cuál elegir según prioridad. No cambies ni calcules ningún dato; todos los números deben salir literalmente del JSON verificado. Al hablar de usos, menciona únicamente los workloads y programas presentes en los criterios o resultados; no inventes programas como Visual Studio.`,
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
        content: `${NOVA_PERSONALITY}\nCompara únicamente los equipos del JSON verificado. Responde en máximo 130 palabras, con una recomendación condicional clara. No inventes métricas.`,
      },
      {
        role: 'user',
        content: `${question}\nDatos verificados: ${JSON.stringify(verifiedData)}`,
      },
    ]);
  }

  private async call(messages: OllamaMessage[], json = false) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.OLLAMA_TIMEOUT_MS ?? 45000),
    );
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          // Nova necesita respuestas breves y estructuradas; el razonamiento
          // interno de Qwen solo añade latencia y puede agotar el timeout.
          think: false,
          ...(json ? { format: 'json' } : {}),
          options: { temperature: json ? 0.1 : 0.35 },
        }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`Ollama respondió HTTP ${response.status}`);
      const data = (await response.json()) as OllamaResponse;
      const content = data.message?.content?.trim();
      if (!content) throw new Error('Ollama devolvió una respuesta vacía');
      return content;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Nova no está disponible en este momento. Verifica que Ollama esté encendido y que el modelo ${this.model} esté instalado. (${(error as Error).message})`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseJson(content: string): unknown {
    try {
      const cleaned = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      return JSON.parse(cleaned);
    } catch {
      throw new ServiceUnavailableException(
        'Nova recibió una respuesta inválida del modelo local. Intenta reformular tu mensaje.',
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
    };
  }

  /**
   * Excel, Word y la ofimática no requieren el perfil de programación.
   * Este ajuste determinista evita que una inferencia errónea del modelo local
   * cambie una necesidad explícita por un workload más exigente.
   */
  private applyExplicitOfficeIntent(
    message: string,
    intent: InterpretedIntent,
    currentFilters: RecommendationRequestDto | undefined,
    workloads: Workload[],
    conversation: OllamaMessage[],
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
