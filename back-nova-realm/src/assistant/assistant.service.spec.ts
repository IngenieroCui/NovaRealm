import { AssistantService } from './assistant.service';
import { ChatRequestDto, ShoppingIntent } from './assistant.dto';
import { DiscoveryPolicyService } from './discovery-policy.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('AssistantService conversational orchestration', () => {
  const ai = { chatTurn: jest.fn(), generateGreeting: jest.fn(), explainRecommendations: jest.fn(), explainComparison: jest.fn(), answerWithVerifiedContext: jest.fn(), answerBuilderQuestion: jest.fn(), composeConversationReply: jest.fn() };
  const workloads = { findAll: jest.fn().mockResolvedValue([{ slug: 'valorant' }, { slug: 'blender' }, { slug: 'programacion' }]) };
  const recommendations = { recommend: jest.fn() };
  const builder = { recommendComponents: jest.fn(), autoBuild: jest.fn(), applyAction: jest.fn(), summarize: jest.fn(), flow: jest.fn(), analyzeUpgrade: jest.fn() };
  const catalog = { findBySlug: jest.fn() };
  const service = new AssistantService(ai as never, workloads as never, recommendations as never, builder as never, catalog as never);
  const criteria = { budgetMax: 5000000, workloads: [{ slug: 'valorant', importance: 0.5 }, { slug: 'blender', importance: 0.5 }] };
  const emptyBuild = { products: [], components: [], peripherals: [], subtotal: 0, assembly: 0, total: 0, budgetRemaining: 5000000, assemblyEnabled: true, complete: false, warnings: [], compatibilityIssues: [], compatible: true };
  const turn = (overrides: Record<string, unknown> = {}) => ({ shoppingIntent: ShoppingIntent.PREBUILT_PC, intentChanged: false, intentConfidence: 0.9, extracted: {}, missingFields: [], nextQuestionPurpose: null, reply: 'Respuesta de Nova', ...overrides });

  beforeEach(() => {
    jest.clearAllMocks();
    ai.chatTurn.mockResolvedValue(turn());
    ai.generateGreeting.mockResolvedValue('Hola, soy Nova. ¿Qué equipo tienes en mente?');
    ai.answerWithVerifiedContext.mockResolvedValue('Explicación contextual de Nova');
    ai.answerBuilderQuestion.mockResolvedValue('Respuesta sobre la pieza sin avanzar.');
    ai.composeConversationReply.mockResolvedValue('Pregunta contextual de Nova.');
    ai.explainRecommendations.mockResolvedValue('Nova explica la recomendación.');
    recommendations.recommend.mockResolvedValue({ recommendations: [], scoring: {} });
    builder.summarize.mockResolvedValue(emptyBuild);
  });

  it('case 1: asks only for budget and emits only budget quick replies', async () => {
    ai.chatTurn.mockResolvedValue(turn({ extracted: { workloads: criteria.workloads }, reply: 'Valorant y Blender cambian el balance. ¿Hasta cuánto quieres gastar?' }));
    const response = await service.chat({ message: 'Valorant y Blender', context: { shoppingIntent: ShoppingIntent.PREBUILT_PC } });
    expect(response.awaiting).toBe('BUDGET');
    expect(response.quickReplies.every((reply: { kind: string }) => reply.kind === 'SET_BUDGET')).toBe(true);
    expect(response.quickReplies.map((reply: { label: string }) => reply.label)).not.toContain('Armar por componentes');
  });

  it('case 2: applies a structured intent without NLP', async () => {
    const response = await service.chat({ message: 'Armar por componentes', context: { shoppingIntent: ShoppingIntent.PREBUILT_PC }, quickReply: { id: 'intent-custom', label: 'Armar por componentes', kind: 'SET_INTENT', value: ShoppingIntent.CUSTOM_PC } });
    expect(ai.chatTurn).not.toHaveBeenCalled();
    expect(response.shoppingIntent).toBe(ShoppingIntent.CUSTOM_PC);
  });

  it('case 3: lets a clear free-text change replace the previous intent', async () => {
    ai.chatTurn.mockResolvedValue(turn({ shoppingIntent: ShoppingIntent.CUSTOM_PC, intentChanged: true, extracted: {}, reply: 'Armémoslo por partes.' }));
    const response = await service.chat({ message: 'Mejor quiero armarlo por partes', context: { shoppingIntent: ShoppingIntent.PREBUILT_PC } });
    expect(response.shoppingIntent).toBe(ShoppingIntent.CUSTOM_PC);
  });

  it('case 4: deterministically keeps budget while merging later workloads', async () => {
    ai.chatTurn.mockResolvedValueOnce(turn({ extracted: { budgetMax: 5000000 } })).mockResolvedValueOnce(turn({ extracted: { workloads: criteria.workloads } }));
    const first = await service.chat({ message: 'Tengo 5 millones', context: { shoppingIntent: ShoppingIntent.PREBUILT_PC } });
    const second = await service.chat({ message: 'Valorant y Blender', criteria: first.criteria, context: { shoppingIntent: ShoppingIntent.PREBUILT_PC } });
    expect(second.criteria).toMatchObject(criteria);
    expect(second.awaiting).toBeNull();
  });

  it('case 5: recommends immediately when one message contains enough data', async () => {
    ai.chatTurn.mockResolvedValue(turn({ extracted: criteria }));
    recommendations.recommend.mockResolvedValue({ recommendations: [{ product: { slug: 'pc-uno' } }], scoring: {} });
    const response = await service.chat({ message: 'Quiero uno listo para Valorant y Blender, máximo 5 millones.' });
    expect(response.awaiting).toBeNull();
    expect(recommendations.recommend).toHaveBeenCalled();
  });

  it('case 6: asks only for builder mode when custom criteria are complete', async () => {
    ai.chatTurn.mockResolvedValue(turn({ shoppingIntent: ShoppingIntent.CUSTOM_PC, intentChanged: true, extracted: { ...criteria, resolution: '1080p', targetFps: 144 } }));
    const response = await service.chat({ message: '6 millones, Docker, Visual Studio y Valorant. Quiero armarlo.' });
    expect(response.awaiting).toBe('BUILDER_MODE');
    expect(response.quickReplies.map((reply: { kind: string }) => reply.kind)).toEqual(['SET_BUILDER_MODE', 'SET_BUILDER_MODE']);
  });

  it('case 7: applies a selected CPU in backend and lets Nova explain the motherboard step', async () => {
    const cpu = { slug: 'ryzen-7600', name: 'Ryzen 5 7600', type: 'CPU' };
    const board = { slug: 'b650', name: 'B650', type: 'MOTHERBOARD', recommendedRole: 'RECOMMENDED' };
    builder.applyAction.mockResolvedValue({ action: 'ADD_TO_BUILD', product: cpu, summary: { ...emptyBuild, products: [cpu], components: [cpu] }, flow: { mode: 'GUIDED', currentStep: 'MOTHERBOARD' }, recommendations: [board] });
    const response = await service.action({ builderAction: { action: 'ADD_TO_BUILD', currentSlugs: [], productSlug: 'ryzen-7600' }, criteria });
    expect(builder.applyAction).toHaveBeenCalled();
    expect(ai.composeConversationReply).toHaveBeenCalledWith(expect.objectContaining({ userMessage: 'ADD_TO_BUILD', verified: expect.objectContaining({ selectedProduct: cpu }) }));
    expect(response.componentRecommendations).toEqual([board]);
  });

  it('case 8: answers a RAM question without applying any builder action', async () => {
    const ram = { slug: 'ram-32', name: '32 GB RAM', type: 'RAM', recommendedRole: 'RECOMMENDED' };
    builder.flow.mockResolvedValue({ mode: 'GUIDED', currentStep: 'RAM' });
    builder.recommendComponents.mockResolvedValue({ recommendations: [ram], warnings: [] });
    builder.summarize.mockResolvedValue({ ...emptyBuild, products: [{ slug: 'cpu' }], components: [{ slug: 'cpu' }] });
    const response = await service.chat({ message: '¿32GB realmente me sirven para Docker?', criteria, context: { shoppingIntent: ShoppingIntent.CUSTOM_PC, builderMode: 'GUIDED', builderStep: 'RAM', buildSlugs: ['cpu'] } });
    expect(response.flow.currentStep).toBe('RAM');
    expect(builder.applyAction).not.toHaveBeenCalled();
    expect(ai.answerBuilderQuestion).toHaveBeenCalled();
  });

  it('case 9: forwards the last recommendation for a pronoun follow-up', async () => {
    const board = { slug: 'b550', name: 'B550', type: 'MOTHERBOARD', recommendedRole: 'RECOMMENDED' };
    builder.flow.mockResolvedValue({ mode: 'GUIDED', currentStep: 'MOTHERBOARD' });
    builder.recommendComponents.mockResolvedValue({ recommendations: [board], warnings: [] });
    await service.chat({ message: '¿Por qué?', criteria, context: { shoppingIntent: ShoppingIntent.CUSTOM_PC, builderMode: 'GUIDED', builderStep: 'MOTHERBOARD', buildSlugs: ['cpu'], lastRecommendedProductSlug: 'b550' } });
    expect(ai.answerBuilderQuestion.mock.calls[0][1].lastRecommendedProductSlug).toBe('b550');
  });

  it('case 10: interprets a complete upgrade in one AI turn and analyzes it', async () => {
    ai.chatTurn.mockResolvedValue(turn({ shoppingIntent: ShoppingIntent.UPGRADE_PC, intentChanged: true, extracted: { budgetMax: 2000000, resolution: '1440p', workloads: [{ slug: 'valorant', importance: 1 }] } }));
    builder.analyzeUpgrade.mockResolvedValue({ priority: 'GPU', recommendations: [], bottleneck: 'GPU', assessment: 'Mejora clara' });
    const response = await service.chat({ message: 'Tengo Ryzen 5600, RTX 3060 y 16 GB. Quiero 1440p. Tengo 2 millones.' });
    expect(builder.analyzeUpgrade).toHaveBeenCalledTimes(1);
    expect(response.awaiting).toBeNull();
    expect(response.upgradeAnalysis.priority).toBe('GPU');
  });

  it('preserves structured workloads through the real DTO transformation', async () => {
    const dto = plainToInstance(ChatRequestDto, { message: 'Guiarme paso a paso', criteria: { budgetMax: 7000000, workloads: [{ slug: 'blender', importance: 1 }] } }, { enableImplicitConversion: true });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(dto.criteria?.workloads).toEqual([{ slug: 'blender', importance: 1 }]);
  });

  it('starts discovery with intent quick replies when there is no product context', async () => {
    const response = await service.start({});
    expect(response.stage).toBe('DISCOVER_INTENT');
    expect(response.awaiting).toBe('INTENT');
    expect(response.quickReplies.every((reply: { kind: string }) => reply.kind === 'SET_INTENT')).toBe(true);
    expect(ai.generateGreeting).toHaveBeenCalled();
  });

  it('passes a verified product to the contextual start greeting', async () => {
    const product = { slug: 'pc-uno', name: 'PC Uno', price: 5_000_000, type: 'PREBUILT_PC', stock: 1 };
    catalog.findBySlug.mockResolvedValue(product);
    const response = await service.start({ context: { productSlug: 'pc-uno' } });
    expect(ai.generateGreeting).toHaveBeenCalledWith(expect.objectContaining({ product }));
    expect(response.product).toBe(product);
    expect(response.awaiting).toBeNull();
  });

  it('applies structured discovery replies without replacing existing criteria', () => {
    const previous = { workloads: [{ slug: 'programacion', importance: 1 }], budgetMax: 5_000_000 };
    expect((service as any).applyQuickReply({ id: 'wifi', label: 'Solo uso Wi-Fi', kind: 'SET_CONNECTIVITY', value: 'WIFI_ONLY' }, previous).criteria.preferences.wifiRequired).toBe(true);
    expect((service as any).applyQuickReply({ id: 'target', label: '1440p · 144 Hz', kind: 'SET_GAMING_TARGET', value: '1440P_144' }, previous).criteria).toMatchObject({ workloads: previous.workloads, budgetMax: 5_000_000, resolution: '1440p', targetFps: 144 });
    expect((service as any).applyQuickReply({ id: 'docker', label: 'Docker y servicios locales', kind: 'SET_DEVELOPMENT_LOAD', value: 'DOCKER' }, previous).criteria).toMatchObject({ workloads: [{ slug: 'programacion', importance: 1 }, { slug: 'docker', importance: 1 }], preferences: { multitaskingLevel: 'HEAVY' } });
  });
});

describe('DiscoveryPolicyService', () => {
  const policy = new DiscoveryPolicyService();

  it('asks connectivity for custom office use when Wi-Fi is unknown', () => {
    expect(policy.next(ShoppingIntent.CUSTOM_PC, { workloads: [{ slug: 'ofimatica-basica', importance: 1 }] })).toMatchObject({ awaiting: 'CONNECTIVITY' });
  });

  it('asks budget after custom office connectivity is known', () => {
    expect(policy.next(ShoppingIntent.CUSTOM_PC, { workloads: [{ slug: 'ofimatica-basica', importance: 1 }], preferences: { wifiRequired: true } })).toMatchObject({ awaiting: 'BUDGET' });
  });

  it('asks development load for programming without Docker or VMs', () => {
    expect(policy.next(ShoppingIntent.CUSTOM_PC, { workloads: [{ slug: 'programacion', importance: 1 }], budgetMax: 5_000_000 })).toMatchObject({ awaiting: 'DEVELOPMENT_LOAD' });
  });

  it('does not ask development load when Docker is already known', () => {
    expect(policy.next(ShoppingIntent.CUSTOM_PC, { workloads: [{ slug: 'programacion', importance: 0.5 }, { slug: 'docker', importance: 0.5 }], budgetMax: 5_000_000 })).not.toMatchObject({ awaiting: 'DEVELOPMENT_LOAD' });
  });

  it('asks gaming target only while resolution or FPS is missing', () => {
    expect(policy.next(ShoppingIntent.CUSTOM_PC, { workloads: [{ slug: 'valorant', importance: 1 }], budgetMax: 5_000_000 })).toMatchObject({ awaiting: 'GAMING_TARGET' });
    expect(policy.next(ShoppingIntent.CUSTOM_PC, { workloads: [{ slug: 'valorant', importance: 1 }], resolution: '1080p', targetFps: 144, budgetMax: 5_000_000 })).not.toMatchObject({ awaiting: 'GAMING_TARGET' });
  });

  it('asks intent when no shopping intent exists', () => {
    expect(policy.next(undefined, {})).toMatchObject({ awaiting: 'INTENT', stage: 'DISCOVER_INTENT' });
  });
});
