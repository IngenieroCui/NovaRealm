import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RecommendationRequestDto } from '../recommendations/recommendation.dto';
import { ScoredRecommendation } from '../recommendations/recommendation.types';
import { Workload } from '../workloads/workload.types';
import { AiMessage, AiProvider } from './ai.provider';
import { CloudflareAiProvider } from './cloudflare-ai.provider';
import { OllamaAiProvider } from './ollama-ai.provider';
import { AssistantContextDto, AwaitingField, ConversationCriteriaDto, ConversationStage, ShoppingIntent, UseProfile } from '../assistant/assistant.dto';
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
  nextQuestionPurpose: AwaitingField;
  reply: string;
}

const NOVA_PERSONALITY = `Eres Nova, asesora tecnológica de NovaRealm.

Hablas en español de forma cercana, humana y clara.
Eres una persona que conoce hardware ayudando a otra persona a comprar,
no un informe técnico ni un vendedor insistente.

Primero responde lo que la persona realmente preguntó.

Después, si ayuda, da una recomendación concreta.

Relaciona tus explicaciones con lo que la persona ya te contó.

Puedes decir: "Yo me quedaría con...", "Aquí ahorraría...", "En tu caso...",
"Con lo que me contaste...", "Esta sí vale la diferencia..." y
"No creo que necesites pagar de más por...".

No uses repetidamente: "Recomiendo X porque", "De acuerdo con tus necesidades",
"Basado en los criterios", "He analizado", "La economía es clave" ni
"El producto recomendado es".

No inventes clientes reales ni estadísticas, productos, precios, stock,
compatibilidad, benchmarks, características o rendimiento. Los datos técnicos
vienen del backend. Puedes decir "Para un uso como el tuyo...", pero no
"Clientes como tú normalmente...".

Normalmente responde en 25-90 palabras. Usa máximo dos párrafos cortos salvo
que el usuario pida detalle. Las cards ya muestran nombre, precio y
especificaciones; no repitas todo lo que aparece en ellas.`;

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
    "useProfile": "GAMING|CREATIVE|PROGRAMMING|OFFICE",
    "budgetMax": 5000000,
    "budgetPreferred": 4500000,
    "resolution": "1080p|1440p|4k",
    "targetFps": 144,
    "workloads": [{ "slug": "valorant", "importance": 0.5 }],
      "preferences": {
        "futureUpgrade": false,
        "wifiRequired": true,
        "peripheralsNeeded": false,
        "valuePriority": true,
        "multitaskingLevel": "LIGHT|NORMAL|HEAVY"
      },
    "requestedComponent": "GPU"
  },
  "builderPreference": "GUIDED|AUTO|null",
  "missingFields": ["BUDGET"],
  "nextQuestionPurpose": "INTENT|USE|CONNECTIVITY|GAMING_TARGET|DEVELOPMENT_LOAD|BUDGET|BUILDER_MODE|COMPONENT_SELECTION|PERIPHERALS|null",
  "reply": "respuesta breve y contextual de Nova"
}

"extracted" contiene SOLO datos aportados o corregidos por el último mensaje; no copies criterios previos. Usa únicamente los campos mostrados, y guarda una preferencia solo si el usuario dio evidencia explícita suficiente: no deduzcas preferencias por el tipo de compra. Usa solo slugs de la lista. Los importances deben ser mayores que 0 y sumar aproximadamente 1. Marca intentChanged solo si el turno actual expresa claramente una compra o cambio de flujo. Excel, Word y tareas básicas corresponden a ofimatica-basica; programacion requiere código, IDE o desarrollo. Usa los criterios previos para no volver a preguntar lo conocido. Si falta un dato imprescindible, pregunta solo por el que más cambia la decisión. Para un componente, requestedComponent es obligatorio antes de recomendar.
Usa useProfile solo para categorías amplias de uso.
Ejemplos:
"solo quiero jugar" → useProfile=GAMING
"lo uso para editar video y Blender" → useProfile=CREATIVE
"programación, código, Visual Studio" → useProfile=PROGRAMMING
"Word, Excel, universidad, navegador" → useProfile=OFFICE
Si el usuario nombra un workload específico real que exista en el catálogo proporcionado, extrae también ese slug real. Nunca uses "gaming" como slug de workload.
reply debe sonar natural, reconocer lo ya dicho y tener normalmente 30-80 palabras. No inventes productos, precios ni compatibilidad. No agregues texto fuera del JSON.`;

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
    const turn = this.applyExplicitOfficeTurn(message, this.validateChatTurn(this.parseJson(raw), workloads), workloads);
    return this.sanitizeExplicitPreferences(message, turn);
  }

  async generateGreeting(input: {
    criteria: ConversationCriteriaDto;
    context?: AssistantContextDto;
    product?: Product;
  }): Promise<string> {
    const verifiedProduct = input.product
      ? {
          name: input.product.name,
          slug: input.product.slug,
          type: input.product.type,
          priceCop: this.formatCop(input.product.price),
          stock: input.product.stock,
          cpu: input.product.cpu,
          gpu: input.product.gpu,
          ramGb: input.product.ramGb,
          storageGb: input.product.storageGb,
          features: input.product.features,
        }
      : undefined;
    const raw = await this.call('assistant-start', [
      { role: 'system', content: `${NOVA_PERSONALITY}\nEscribe un saludo breve y humano para iniciar la conversación. ${verifiedProduct ? 'El usuario está viendo el producto verificado del contexto; menciónalo solo si ayuda y no inventes nada.' : 'Invita a contar qué quiere comprar o mejorar.'} Devuelve solo el mensaje, sin JSON, listas ni botones.` },
      { role: 'user', content: `Criterios conocidos: ${JSON.stringify(input.criteria)}\nContexto: ${JSON.stringify(input.context ?? {})}\nProducto verificado: ${JSON.stringify(verifiedProduct ?? null)}` },
    ]);
    const message = raw.trim();
    if (!message || message.includes('₡')) throw new ServiceUnavailableException('Nova no pudo formular el saludo.');
    return message.slice(0, 1000);
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
    preferences?: ConversationCriteriaDto['preferences'];
    useProfile?: UseProfile;
  }) {
    const verified = {
      workload: context.workload,
      budgetMax: context.budgetMax,
      remainingBudget: context.remainingBudget,
      currentStep: context.currentStep,
      currentBuild: context.currentBuild.map((item) => ({ type: item.type, name: item.name, slug: item.slug, priceCop: this.formatCop(item.price), technicalSpecs: item.technicalSpecs })),
      candidates: context.candidates.map((item) => ({ name: item.name, slug: item.slug, priceCop: this.formatCop(item.price), technicalSpecs: item.technicalSpecs, compatibility: item.compatibility, compatibilityReasons: item.compatibilityReasons, recommendationScore: item.recommendationScore, budgetImpact: item.budgetImpact, recommendedRole: item.recommendedRole, strengths: item.strengths, weaknesses: item.weaknesses, rationale: item.rationale })),
      lastRecommendedProductSlug: context.lastRecommendedProductSlug,
      lastComparedProductSlugs: context.lastComparedProductSlugs,
      balanceWarnings: context.balanceWarnings ?? [],
      preferences: context.preferences,
      useProfile: context.useProfile,
    };
    return this.call('builder-answer', [
      { role: 'system', content: `${NOVA_PERSONALITY}\nEstás respondiendo una pregunta DENTRO de un configurador guiado de PC.\n\nNunca recomiendes una PC prearmada completa.\n\nNunca cambies la intención de compra.\n\nNunca avances el configurador.\n\nPrimero responde exactamente la pregunta.\n\nSi la pregunta es "¿Por qué esta?" o equivalente:\n- identifica el candidato referido por lastRecommendedProductSlug;\n- explica 2 razones concretas de los datos del backend;\n- conecta al menos una razón con el uso, presupuesto o configuración actual;\n- menciona un trade-off si existe.\n\nSi pide una comparación, compara como máximo dos candidatos relevantes.\n\nSi pregunta si puede ahorrar, explica qué perdería y si la alternativa más barata todavía cubre la necesidad.\n\nUsa 40-110 palabras en español. Sé amable y práctico. No suenes como un informe técnico. Usa exclusivamente el JSON verificado. El backend ya decidió compatibilidad y roles: jamás los recalcules ni contradigas. No repitas las cards. Si faltan datos, dilo claramente. Puedes usar markdown seguro.` },
      { role: 'user', content: `Pregunta: ${question}\nContexto verificado: ${JSON.stringify(verified)}` },
    ]);
  }

  async answerWithVerifiedContext(operation: string, instruction: string, userMessage: string, verified: unknown) {
    return this.call(operation, [
      { role: 'system', content: `${NOVA_PERSONALITY}\n${instruction} Usa únicamente los datos verificados; si falta algo, dilo sin inventar.` },
      { role: 'user', content: `Mensaje del usuario: ${userMessage}\nDatos verificados: ${JSON.stringify(verified)}` },
    ]);
  }

  async explainBuilderStep(input: {
    criteria: ConversationCriteriaDto;
    currentStep: ProductType;
    build: Product[];
    remainingBudget?: number | null;
    recommendedCandidate?: ComponentCandidate;
    alternatives: ComponentCandidate[];
  }): Promise<string> {
    const raw = await this.call('builder-step-intro', [
      {
        role: 'system',
        content: `${NOVA_PERSONALITY}\n\nYou are introducing one step of the guided PC builder.\n\nUse only verified data.\n\nName the recommended component if one exists.\n\nExplain:\n1. why this type of component matters for this customer's use;\n2. why the backend-recommended candidate makes sense;\n3. one practical trade-off when relevant.\n\nConnect the explanation to something the customer told Nova:\ngaming target, Blender, Docker, office use, Wi-Fi, budget or value priority.\n\nSpeak as Nova, not as a technical report.\n\nConnect the recommendation to at least one piece of customer context when\nthat context exists:\n\n- their programs;\n- their games;\n- resolution/FPS target;\n- Wi-Fi requirement;\n- multitasking;\n- budget;\n- value priority;\n- selected components.\n\nUse one practical example when it genuinely clarifies the decision.\n\nExample style:\n\"For Blender I would spend a little more here because this part directly\naffects the work you told me you do.\"\n\"Since you only use Wi-Fi, this is one of the places where paying the\ndifference makes sense.\"\n\nDo not say:\n\"According to the criteria\"\n\"Based on your requirements\"\n\"The recommended product is\"\n\nDo not invent customer statistics or benchmarks.\n\nDo not enumerate every candidate.\nDo not recommend a complete prebuilt PC.\nDo not change shopping flow.\nDo not ask a discovery question.\n\nUse 45-100 words in Spanish, maximum two short paragraphs.`,
      },
      {
        role: 'user',
        content: `Datos verificados:\n${JSON.stringify({
          criteria: input.criteria,
          currentStep: input.currentStep,
          build: input.build,
          remainingBudget: input.remainingBudget,
          recommendedCandidate: input.recommendedCandidate,
          alternatives: input.alternatives,
        })}`,
      },
    ]);
    return raw.trim().slice(0, 1000);
  }

  async composeConversationReply(input: {
    userMessage: string;
    shoppingIntent: ShoppingIntent;
    criteria: ConversationCriteriaDto;
    stage: ConversationStage;
    awaiting: AwaitingField;
    verified?: unknown;
  }) {
    const expected = input.awaiting ?? 'NONE';
    const awaitingInstruction: Record<string, string> = {
      INTENT:
        'Pregunta únicamente qué quiere comprar o mejorar. No preguntes presupuesto ni uso todavía.',
      USE:
        'Pregunta únicamente para qué usará el PC o qué juegos/programas usará. NO preguntes presupuesto.',
      CONNECTIVITY:
        'Pregunta únicamente si necesita Wi-Fi o puede usar Ethernet.',
      GAMING_TARGET:
        'Pregunta únicamente por resolución y objetivo de FPS/Hz. NO preguntes presupuesto.',
      DEVELOPMENT_LOAD:
        'Pregunta únicamente si su programación es básica, usa Docker o máquinas virtuales.',
      BUDGET:
        'Pregunta únicamente por el presupuesto máximo. NO vuelvas a preguntar el uso.',
      BUILDER_MODE:
        'No recomiendes ningún producto ni especificación. Solo pregunta si quiere hacerlo pieza por pieza o recibir una configuración completa.',
      COMPONENT_SELECTION:
        'Pregunta únicamente qué tipo de componente está buscando.',
      PERIPHERALS:
        'Pregunta únicamente qué periféricos necesita.',
    };
    const system = `${NOVA_PERSONALITY}
Redacta el siguiente mensaje real de Nova usando el estado decidido por el backend. Devuelve SOLO JSON:
{"nextQuestionPurpose":"${expected}","reply":"mensaje"}
nextQuestionPurpose debe ser exactamente "${expected}". reply debe tener 30-80 palabras, sin listas. No preguntes por datos que ya aparecen en criteria. ${awaitingInstruction[expected] ?? ''} ${expected === 'BUILDER_MODE' ? 'At BUILDER_MODE the backend has NOT selected hardware yet. Do not mention a CPU, GPU, RAM amount, SSD, kit, product, model or brand as a recommendation.' : ''} Si awaiting es NONE, responde o recomienda sin convertir el turno en otra pregunta de descubrimiento. Si hay candidatos, toma postura por la opción marcada RECOMMENDED, nómbrala y explica el criterio; menciona como máximo una alternativa. Los botones y cards se renderizan aparte. Todo precio numérico verificado está en COP: escríbelo como "$... COP" y nunca uses ₡, dólares u otra moneda.`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.call('conversation-reply', [
        { role: 'system', content: system },
        { role: 'user', content: `Mensaje: ${input.userMessage}\nEstado verificado: ${JSON.stringify({ shoppingIntent: input.shoppingIntent, criteria: input.criteria, stage: input.stage, awaiting: expected, verified: input.verified })}` },
      ], true);
      const parsed = this.parseJson(raw) as Record<string, unknown>;
      const purpose = parsed.nextQuestionPurpose === null ? 'NONE' : String(parsed.nextQuestionPurpose);
      const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
      const wordCount = reply.split(/\s+/).filter(Boolean).length;
      const conversational = wordCount >= 12 && wordCount <= 120 && !/(?:^|\n)\s*[-*•]\s/.test(reply) && !reply.includes('₡') && !this.containsPlaceholderProduct(reply) && !this.violatesAwaitingContract(expected, reply);
      if (purpose === expected && reply && conversational) return reply.slice(0, 1000);
      console.warn(`[NovaAI] operation=conversation-reply valid=false expectedPurpose=${expected} attempt=${attempt + 1}`);
    }
    throw new ServiceUnavailableException('Nova no pudo formular una respuesta coherente con el estado actual.');
  }

  private containsPlaceholderProduct(
    value: string,
  ): boolean {
    return (
      /\[(?:nombre|producto|alternativa|modelo|kit)[^\]]*\]/i.test(
        value,
      ) ||
      /\bNombre del Kit\b/i.test(value) ||
      /\bProducto X\b/i.test(value) ||
      /\bModelo X\b/i.test(value)
    );
  }

  private violatesAwaitingContract(
    awaiting: string,
    reply: string,
  ): boolean {
    if (
      awaiting === 'USE' &&
      /presupuesto|\$|millones?|cop/i.test(reply)
    ) {
      return true;
    }

    if (
      awaiting === 'BUDGET' &&
      /para qué|para que|qué juegos|que juegos|qué programas|que programas|uso principal/i.test(
        reply,
      )
    ) {
      return true;
    }

    if (
      awaiting === 'GAMING_TARGET' &&
      /presupuesto|\$|millones?|cop/i.test(reply)
    ) {
      return true;
    }

    if (
      awaiting === 'BUILDER_MODE' &&
      /ryzen|intel|rtx|radeon|\b\d+\s*gb\b|ssd|nombre del kit|\bkit\b/i.test(
        reply,
      )
    ) {
      return true;
    }

    return false;
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
    const purpose = ['INTENT', 'USE', 'CONNECTIVITY', 'GAMING_TARGET', 'DEVELOPMENT_LOAD', 'BUDGET', 'BUILDER_MODE', 'COMPONENT_SELECTION', 'PERIPHERALS'].includes(String(data.nextQuestionPurpose))
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
    const useProfile = ['GAMING', 'CREATIVE', 'PROGRAMMING', 'OFFICE'].includes(String(data.useProfile)) ? data.useProfile as UseProfile : undefined;
    return {
      ...(useProfile ? { useProfile } : {}),
      ...(number('budgetMax', 500000) ? { budgetMax: number('budgetMax', 500000) } : {}),
      ...(number('budgetPreferred', 500000) ? { budgetPreferred: number('budgetPreferred', 500000) } : {}),
      ...(uses.length ? { workloads: uses } : {}),
      ...(resolution ? { resolution } : {}),
      ...(number('targetFps', 30, 360) ? { targetFps: number('targetFps', 30, 360) } : {}),
      ...(this.validatePreferences(data.preferences)),
      ...(typeof data.requestedComponent === 'string' && ['CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'STORAGE', 'PSU', 'COOLING', 'CASE', 'MONITOR'].includes(data.requestedComponent) ? { requestedComponent: data.requestedComponent } : {}),
    };
  }

  private validatePreferences(raw: unknown): { preferences?: ConversationCriteriaDto['preferences'] } {
    if (!raw || typeof raw !== 'object') return {};
    const data = raw as Record<string, unknown>;
    const preferences = {
      ...(typeof data.futureUpgrade === 'boolean' ? { futureUpgrade: data.futureUpgrade } : {}),
      ...(typeof data.wifiRequired === 'boolean' ? { wifiRequired: data.wifiRequired } : {}),
      ...(typeof data.peripheralsNeeded === 'boolean' ? { peripheralsNeeded: data.peripheralsNeeded } : {}),
      ...(typeof data.valuePriority === 'boolean' ? { valuePriority: data.valuePriority } : {}),
      ...(['LIGHT', 'NORMAL', 'HEAVY'].includes(String(data.multitaskingLevel)) ? { multitaskingLevel: data.multitaskingLevel as 'LIGHT' | 'NORMAL' | 'HEAVY' } : {}),
    };
    return Object.keys(preferences).length ? { preferences } : {};
  }

  private sanitizeExplicitPreferences(message: string, turn: ChatTurnResult): ChatTurnResult {
    if (!turn.extracted.preferences) return turn;
    const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const raw = turn.extracted.preferences;
    const explicit = {
      ...(raw.futureUpgrade !== undefined && /(?:en el futuro|mas adelante|actualizable|ampliar|expandir|upgrade futuro)/.test(normalized) ? { futureUpgrade: raw.futureUpgrade } : {}),
      ...(raw.wifiRequired !== undefined && /(?:wi[\s-]?fi|ethernet|cable|inalambric)/.test(normalized) ? { wifiRequired: raw.wifiRequired } : {}),
      ...(raw.peripheralsNeeded !== undefined && /(?:periferic|teclado|mouse|raton|monitor|pantalla|audifonos|auriculares)/.test(normalized) ? { peripheralsNeeded: raw.peripheralsNeeded } : {}),
      ...(raw.valuePriority !== undefined && /(?:relacion(?: calidad)? precio|calidad[\s-]+precio|econom|ahorr|no quiero gastar|gastar porque si|presupuesto|dinero)/.test(normalized) ? { valuePriority: raw.valuePriority } : {}),
      ...(raw.multitaskingLevel !== undefined && /(?:basico|word|excel|codigo|program|ide|docker|servicios? locales?|maquinas? virtuales?|multitarea|varias? cosas?)/.test(normalized) ? { multitaskingLevel: raw.multitaskingLevel } : {}),
    };
    return { ...turn, extracted: { ...turn.extracted, ...(Object.keys(explicit).length ? { preferences: explicit } : { preferences: undefined }) } };
  }

  private mergeCriteria(previous: ConversationCriteriaDto | undefined, extracted: ConversationCriteriaDto): ConversationCriteriaDto {
    return { ...(previous ?? {}), ...extracted, workloads: extracted.workloads ? this.mergeWorkloads(previous?.workloads, extracted.workloads) : previous?.workloads, preferences: { ...(previous?.preferences ?? {}), ...(extracted.preferences ?? {}) } };
  }

  private mergeWorkloads(previous: ConversationCriteriaDto['workloads'] = [], next: ConversationCriteriaDto['workloads'] = []) {
    const merged = new Map((previous ?? []).map((item) => [item.slug, item]));
    for (const item of next ?? []) merged.set(item.slug, item);
    return [...merged.values()].slice(0, 8);
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
