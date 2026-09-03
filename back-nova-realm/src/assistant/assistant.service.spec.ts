import { AssistantService } from './assistant.service';
import { ShoppingIntent } from './assistant.dto';

describe('AssistantService conversational orchestration', () => {
  const ai = { chatTurn: jest.fn(), explainRecommendations: jest.fn(), explainComparison: jest.fn(), answerWithVerifiedContext: jest.fn(), answerBuilderQuestion: jest.fn() };
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
    ai.answerWithVerifiedContext.mockResolvedValue('Explicación contextual de Nova');
    ai.answerBuilderQuestion.mockResolvedValue('Respuesta sobre la pieza sin avanzar.');
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
    ai.chatTurn.mockResolvedValue(turn({ shoppingIntent: ShoppingIntent.CUSTOM_PC, intentChanged: true, extracted: criteria }));
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
    expect(ai.answerWithVerifiedContext).toHaveBeenCalledWith('builder-action', expect.any(String), 'ADD_TO_BUILD', expect.objectContaining({ selectedProduct: cpu }));
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
});
