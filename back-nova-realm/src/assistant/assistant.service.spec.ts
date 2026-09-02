import { AssistantService } from './assistant.service';
import { ShoppingIntent } from './assistant.dto';

describe('AssistantService consultation flows', () => {
  const ai = { interpret: jest.fn(), explainRecommendations: jest.fn() };
  const workloads = { findAll: jest.fn().mockResolvedValue([]) };
  const recommendations = { recommend: jest.fn() };
  const builder = { analyzeUpgrade: jest.fn() };
  const catalog = { findBySlug: jest.fn() };
  const service = new AssistantService(
    ai as never,
    workloads as never,
    recommendations as never,
    builder as never,
    catalog as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('guides an upgrade customer to collect missing Windows specifications safely', async () => {
    const response = await service.chat({
      message: 'Quiero mejorar mi PC',
      shoppingIntent: ShoppingIntent.UPGRADE_PC,
    });

    expect(response.needsMoreInformation).toBe(true);
    expect(response.systemInfoGuide.command).toContain('Get-CimInstance');
    expect(response.systemInfoGuide.steps).toHaveLength(3);
    expect(builder.analyzeUpgrade).not.toHaveBeenCalled();
  });

  it('parses the labeled output produced by the PowerShell guide', async () => {
    const response = await service.chat({
      message: [
        'CPU: AMD Ryzen 5 5600X 6-Core Processor',
        'GPU: NVIDIA GeForce RTX 3060 Ti',
        'RAM: 32 GB',
        'Motherboard: Micro-Star International Co. B550M PRO-VDH',
        'Storage: Samsung SSD 980 1TB',
      ].join('\n'),
      shoppingIntent: ShoppingIntent.UPGRADE_PC,
    });

    expect(response.currentPc).toMatchObject({
      cpu: 'AMD Ryzen 5 5600X 6-Core Processor',
      gpu: 'NVIDIA GeForce RTX 3060 Ti',
      ramGb: 32,
      motherboard: 'Micro-Star International Co. B550M PRO-VDH',
    });
    expect(response.message).toContain('qué te está molestando');
    expect(builder.analyzeUpgrade).not.toHaveBeenCalled();
  });

  it('keeps custom builds in discovery until the intended use is known', async () => {
    ai.interpret.mockResolvedValue({
      needsMoreInformation: true,
      question: '¿Para qué vas a usar el equipo?',
    });

    const response = await service.chat({
      message: 'Quiero armar mi PC',
      shoppingIntent: ShoppingIntent.CUSTOM_PC,
    });

    expect(response.needsMoreInformation).toBe(true);
    expect(response.message).toBe('¿Para qué vas a usar el equipo?');
    expect(response.quickActions).toContain('Gaming');
  });

  it('does not expose builder progress before the user chooses a mode', async () => {
    ai.interpret.mockResolvedValue({
      needsMoreInformation: false,
      filters: { budgetMax: 5000000, workloads: [{ slug: 'gaming', importance: 1 }] },
    });

    const response = await service.chat({
      message: 'Ya tengo presupuesto, ¿qué modo prefiero?',
      shoppingIntent: ShoppingIntent.CUSTOM_PC,
      filters: { budgetMax: 5000000, workloads: [{ slug: 'gaming', importance: 1 }] },
    });

    expect(response.actions?.map((action) => action.action)).toEqual(['START_GUIDED', 'AUTO_BUILD']);
    expect(response.flow).toBeUndefined();
  });

  it('lets an explicit component in the current message override previous context', () => {
    const detect = (service as unknown as { detectComponentType: (message: string, context: { selectedComponentType: string; builderStep: string }) => string | undefined }).detectComponentType.bind(service);
    expect(detect('Mejor miremos RAM', { selectedComponentType: 'GPU', builderStep: 'GPU' })).toBe('RAM');
  });

  it('lets an explicit prebuilt intent replace a previous custom intent', async () => {
    ai.interpret.mockResolvedValue({ needsMoreInformation: true, filters: undefined });
    const response = await service.chat({
      message: 'Mejor quiero comprar una lista ya armada.',
      context: { shoppingIntent: ShoppingIntent.CUSTOM_PC, buildSlugs: [] },
    });
    expect(response.shoppingIntent).toBe(ShoppingIntent.PREBUILT_PC);
  });
});
