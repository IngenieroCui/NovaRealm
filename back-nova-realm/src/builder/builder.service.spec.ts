import { BuilderService } from './builder.service';
import { Product, ProductType } from '../catalog/product.types';
import { CompatibilityService } from './compatibility.service';

function product(type: ProductType, slug: string, price: number, specs: Record<string, string | number | boolean> = {}): Product {
  return {
    id: Math.random(), name: slug, slug, description: slug, price, stock: 5, imageUrl: '', active: true, type,
    cpu: type === ProductType.CPU ? slug : null, gpu: type === ProductType.GPU ? slug : null,
    ramGb: type === ProductType.RAM ? 32 : null, storageGb: type === ProductType.STORAGE ? 1000 : null,
    vramGb: type === ProductType.GPU ? 8 : null, cpuScore: type === ProductType.CPU ? 70 : null,
    gpuScore: type === ProductType.GPU ? 70 : null, productivityScore: null, upgradeabilityScore: null,
    features: [], technicalSpecs: specs, createdAt: '', updatedAt: '',
  };
}

describe('BuilderService critical actions', () => {
  const cpu = product(ProductType.CPU, 'cpu', 400000, { socket: 'AM4', tdpW: 65 });
  const parts = [
    cpu,
    product(ProductType.MOTHERBOARD, 'board', 400000, { socket: 'AM4', memoryType: 'DDR4' }),
    product(ProductType.RAM, 'ram', 200000, { memoryType: 'DDR4' }),
    product(ProductType.GPU, 'gpu', 900000, { tdpW: 160 }),
    product(ProductType.STORAGE, 'storage', 200000),
    product(ProductType.PSU, 'psu', 300000, { wattage: 650 }),
    product(ProductType.COOLING, 'cooling', 150000),
    product(ProductType.CASE, 'case', 250000),
  ];
  const catalog = {
    findAll: jest.fn().mockResolvedValue(parts),
    findBySlug: jest.fn((slug: string) => Promise.resolve(parts.find((item) => item.slug === slug))),
    findBySlugs: jest.fn((slugs: string[]) => Promise.resolve(parts.filter((item) => slugs.includes(item.slug)))),
  };
  const database = { all: jest.fn().mockResolvedValue([{ key: 'assemblyEnabled', value: 'true' }, { key: 'assemblyPrice', value: '150000' }]), run: jest.fn() };
  const workloads = { findBySlugs: jest.fn().mockResolvedValue([]) };
  let service: BuilderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BuilderService(catalog as never, database as never, workloads as never, new CompatibilityService());
  });

  it('AUTO_SELECT adds the selected product to the build', async () => {
    jest.spyOn(service, 'recommendComponents').mockResolvedValue({ componentType: ProductType.CPU, recommendations: [cpu], warnings: [] });
    const result = await service.applyAction({ action: 'AUTO_SELECT', currentSlugs: [], componentType: ProductType.CPU, budgetMax: 5000000 });
    expect(result.product?.slug).toBe('cpu');
    expect(result.summary.products.map((item) => item.slug)).toContain('cpu');
  });

  it('AUTO_SELECT uses the edited component type and resumes normal flow', async () => {
    const recommendComponents = jest.spyOn(service, 'recommendComponents').mockResolvedValue({ componentType: ProductType.CPU, recommendations: [cpu], warnings: [] });

    const result = await service.applyAction({
      action: 'AUTO_SELECT',
      currentSlugs: ['cpu', 'board', 'ram'],
      componentType: ProductType.CPU,
      budgetMax: 5000000,
      mode: 'GUIDED',
    });

    expect(recommendComponents).toHaveBeenCalledWith(expect.objectContaining({ componentType: ProductType.CPU }));
    expect(result.flow.currentStep).toBe(ProductType.GPU);
    expect(result.flow.editingStep).toBeUndefined();
  });

  it('never exceeds the budget when the catalog can complete the build', async () => {
    const result = await service.autoBuild({ budgetMax: 5000000 });
    expect(result.complete).toBe(true);
    expect(result.total).toBeLessThanOrEqual(5000000);
  });

  it('preserves assembly when another action updates the build', async () => {
    const result = await service.applyAction({ action: 'ADD_ASSEMBLY', currentSlugs: ['cpu'], budgetMax: 5000000 });
    expect(result.summary.assembly).toBe(150000);
    expect(result.summary.total).toBe(550000);
  });
});

describe('BuilderService recommendation correctness', () => {
  const workload = (slug: string, type: string, recommendedRamGb: number) => ({
    id: 1, slug, name: slug, type, description: slug,
    cpuWeight: 0.3, gpuWeight: 0.2, ramWeight: 0.4, storageWeight: 0.05, vramWeight: 0.05,
    minimumCpuScore: 20, recommendedCpuScore: 50, minimumGpuScore: 10, recommendedGpuScore: 25,
    minimumRamGb: Math.min(8, recommendedRamGb), recommendedRamGb, minimumVramGb: 0, recommendedVramGb: 0,
    createdAt: '', updatedAt: '',
  });

  const createService = (catalogProducts: Product[], catalogWorkloads: ReturnType<typeof workload>[] = []) => {
    const catalog = {
      findAll: jest.fn((query?: { type?: ProductType; types?: ProductType[] }) => Promise.resolve(catalogProducts.filter((item) => !query?.type || item.type === query.type).filter((item) => !query?.types || query.types.includes(item.type)))),
      findBySlug: jest.fn((slug: string) => Promise.resolve(catalogProducts.find((item) => item.slug === slug))),
      findBySlugs: jest.fn((slugs: string[]) => Promise.resolve(catalogProducts.filter((item) => slugs.includes(item.slug)))),
    };
    const database = { all: jest.fn().mockResolvedValue([{ key: 'assemblyEnabled', value: 'true' }, { key: 'assemblyPrice', value: '150000' }]), run: jest.fn() };
    const workloads = { findBySlugs: jest.fn((slugs: string[]) => Promise.resolve(catalogWorkloads.filter((item) => slugs.includes(item.slug)))) };
    return new BuilderService(catalog as never, database as never, workloads as never, new CompatibilityService());
  };

  it('office: 16 GB beats 64 GB for recommendation and value', async () => {
    const ram16 = { ...product(ProductType.RAM, 'ram16', 189000, { memoryType: 'DDR4' }), ramGb: 16 };
    const ram64 = { ...product(ProductType.RAM, 'ram64', 599000, { memoryType: 'DDR4' }), ramGb: 64 };
    const office = workload('ofimatica-basica', 'PROFESSIONAL', 16);
    const service = createService([ram16, ram64], [office]);
    const result = await service.recommendComponents({ componentType: ProductType.RAM, itemSlugs: [], workloads: [{ slug: office.slug, importance: 1 }], preferences: { valuePriority: true } });
    expect(result.recommendations[0].slug).toBe('ram16');
    expect(result.recommendations.find((item) => item.slug === 'ram64')?.recommendedRole).not.toBe('BEST_VALUE');
  });

  it('Docker and virtual machines give useful higher RAM scores', async () => {
    const ram32 = { ...product(ProductType.RAM, 'ram32', 339000, { memoryType: 'DDR4' }), ramGb: 32 };
    const ram64 = { ...product(ProductType.RAM, 'ram64', 599000, { memoryType: 'DDR4' }), ramGb: 64 };
    const office = workload('ofimatica-basica', 'PROFESSIONAL', 16);
    const docker = workload('docker', 'DEVELOPMENT', 32);
    const vm = workload('maquinas-virtuales', 'DEVELOPMENT', 64);
    const service = createService([ram32, ram64], [office, docker, vm]);
    const officeScore = (service as any).componentScore(ram32, ProductType.RAM, [{ workload: office, importance: 1 }]);
    const dockerScore = (service as any).componentScore(ram32, ProductType.RAM, [{ workload: docker, importance: 1 }]);
    const vmScore = (service as any).componentScore(ram64, ProductType.RAM, [{ workload: vm, importance: 1 }]);
    expect(dockerScore).toBeGreaterThan(officeScore);
    expect(vmScore).toBeGreaterThan(officeScore);
  });

  it('Wi-Fi requirement excludes non-Wi-Fi motherboards', async () => {
    const cpu = { ...product(ProductType.CPU, 'cpu', 400000, { socket: 'AM4', integratedGraphics: true }) };
    const wifi = product(ProductType.MOTHERBOARD, 'wifi-board', 500000, { socket: 'AM4', memoryType: 'DDR4', wifi: true });
    const wired = product(ProductType.MOTHERBOARD, 'wired-board', 300000, { socket: 'AM4', memoryType: 'DDR4', wifi: false });
    const service = createService([cpu, wifi, wired]);
    const result = await service.recommendComponents({ componentType: ProductType.MOTHERBOARD, itemSlugs: ['cpu'], preferences: { wifiRequired: true } });
    expect(result.recommendations.map((item) => item.slug)).toEqual(['wifi-board']);
  });

  it('ranks 550/650 W PSUs ahead of excessive power for an RX6600', async () => {
    const gpu = product(ProductType.GPU, 'rx6600', 899000, { tdpW: 160, recommendedPsuWatts: 550 });
    const psu550 = product(ProductType.PSU, 'psu550', 249000, { wattage: 550 });
    const psu650 = product(ProductType.PSU, 'psu650', 299000, { wattage: 650 });
    const psu1000 = product(ProductType.PSU, 'psu1000', 749000, { wattage: 1000 });
    const service = createService([gpu, psu550, psu650, psu1000]);
    const result = await service.recommendComponents({ componentType: ProductType.PSU, itemSlugs: ['rx6600'] });
    expect(result.recommendations.slice(0, 2).map((item) => item.slug).sort()).toEqual(['psu550', 'psu650']);
    expect(result.recommendations.find((item) => item.slug === 'psu1000')?.recommendedRole).not.toBe('RECOMMENDED');
  });

  it('omits GPU for office with an integrated-graphics CPU and keeps it for Blender', async () => {
    const cpu = product(ProductType.CPU, 'igpu-cpu', 400000, { socket: 'AM4', integratedGraphics: true });
    const office = workload('ofimatica-basica', 'PROFESSIONAL', 16);
    const blender = workload('blender', 'CREATIVE', 32);
    const service = createService([cpu], [office, blender]);
    const officeSteps = await (service as any).resolveGuidedSteps([cpu], [{ slug: office.slug, importance: 1 }]);
    const blenderSteps = await (service as any).resolveGuidedSteps([cpu], [{ slug: blender.slug, importance: 1 }]);
    expect(officeSteps).not.toContain(ProductType.GPU);
    expect(blenderSteps).toContain(ProductType.GPU);
  });

  it('AUTO office chooses the cheaper complete iGPU path', async () => {
    const i3 = product(ProductType.CPU, 'i3-12100f', 399000, { socket: 'AM4', integratedGraphics: false });
    const ryzen = product(ProductType.CPU, 'ryzen-5600g', 499000, { socket: 'AM4', integratedGraphics: true });
    const board = product(ProductType.MOTHERBOARD, 'office-board', 350000, { socket: 'AM4', memoryType: 'DDR4' });
    const ram = { ...product(ProductType.RAM, 'office-ram', 200000, { memoryType: 'DDR4' }), ramGb: 16 };
    const gpu = product(ProductType.GPU, 'minimum-gpu', 899000, { tdpW: 160 });
    const storage = product(ProductType.STORAGE, 'office-storage', 200000);
    const psu = product(ProductType.PSU, 'office-psu', 300000, { wattage: 650 });
    const cooling = product(ProductType.COOLING, 'office-cooling', 150000);
    const pcCase = product(ProductType.CASE, 'office-case', 250000);
    const office = workload('ofimatica-basica', 'PROFESSIONAL', 16);
    const service = createService([i3, ryzen, board, ram, gpu, storage, psu, cooling, pcCase], [office]);

    const result = await service.autoBuild({ budgetMax: 5000000, workloadSlugs: [office.slug] });

    expect(result.components.find((item) => item.type === ProductType.CPU)?.slug).toBe('ryzen-5600g');
    expect(result.components.some((item) => item.type === ProductType.GPU)).toBe(false);
  });

  it('AUTO gaming still includes a discrete GPU', async () => {
    const i3 = product(ProductType.CPU, 'i3-12100f', 399000, { socket: 'AM4', integratedGraphics: false });
    const ryzen = product(ProductType.CPU, 'ryzen-5600g', 499000, { socket: 'AM4', integratedGraphics: true });
    const board = product(ProductType.MOTHERBOARD, 'gaming-board', 350000, { socket: 'AM4', memoryType: 'DDR4' });
    const ram = { ...product(ProductType.RAM, 'gaming-ram', 200000, { memoryType: 'DDR4' }), ramGb: 16 };
    const gpu = product(ProductType.GPU, 'gaming-gpu', 899000, { tdpW: 160 });
    const storage = product(ProductType.STORAGE, 'gaming-storage', 200000);
    const psu = product(ProductType.PSU, 'gaming-psu', 300000, { wattage: 650 });
    const cooling = product(ProductType.COOLING, 'gaming-cooling', 150000);
    const pcCase = product(ProductType.CASE, 'gaming-case', 250000);
    const gaming = workload('valorant', 'GAME', 16);
    const service = createService([i3, ryzen, board, ram, gpu, storage, psu, cooling, pcCase], [gaming]);

    const result = await service.autoBuild({ budgetMax: 5000000, workloadSlugs: [gaming.slug] });

    expect(result.components.some((item) => item.type === ProductType.GPU)).toBe(true);
  });

  it('AUTO Blender still includes a discrete GPU', async () => {
    const cpu = product(ProductType.CPU, 'blender-cpu', 399000, { socket: 'AM4', integratedGraphics: true });
    const board = product(ProductType.MOTHERBOARD, 'blender-board', 350000, { socket: 'AM4', memoryType: 'DDR4' });
    const ram = { ...product(ProductType.RAM, 'blender-ram', 200000, { memoryType: 'DDR4' }), ramGb: 32 };
    const gpu = product(ProductType.GPU, 'blender-gpu', 899000, { tdpW: 160 });
    const storage = product(ProductType.STORAGE, 'blender-storage', 200000);
    const psu = product(ProductType.PSU, 'blender-psu', 300000, { wattage: 650 });
    const cooling = product(ProductType.COOLING, 'blender-cooling', 150000);
    const pcCase = product(ProductType.CASE, 'blender-case', 250000);
    const blender = workload('blender', 'CREATIVE', 32);
    const service = createService([cpu, board, ram, gpu, storage, psu, cooling, pcCase], [blender]);

    const result = await service.autoBuild({ budgetMax: 5000000, workloadSlugs: [blender.slug] });

    expect(result.components.some((item) => item.type === ProductType.GPU)).toBe(true);
  });

  it('GO_TO_STEP preserves the build and returns the requested editing step', async () => {
    const cpu = product(ProductType.CPU, 'igpu-cpu', 400000, { socket: 'AM4', integratedGraphics: true });
    const ram = { ...product(ProductType.RAM, 'ram16', 189000, { memoryType: 'DDR4' }), ramGb: 16 };
    const office = workload('ofimatica-basica', 'PROFESSIONAL', 16);
    const service = createService([cpu, ram], [office]);
    const currentSlugs = ['igpu-cpu'];
    const result = await service.applyAction({ action: 'GO_TO_STEP', currentSlugs, componentType: ProductType.RAM, workloads: [{ slug: office.slug, importance: 1 }] });
    expect(currentSlugs).toEqual(['igpu-cpu']);
    expect(result.summary.products.map((item) => item.slug)).toEqual(['igpu-cpu']);
    expect(result.flow.currentStep).toBe(ProductType.RAM);
    expect(result.flow.editingStep).toBe(ProductType.RAM);
  });

  it('rejects an incompatible replacement without deleting downstream products', async () => {
    const oldCpu = product(ProductType.CPU, 'old-cpu', 400000, { socket: 'AM4' });
    const newCpu = product(ProductType.CPU, 'new-cpu', 500000, { socket: 'AM5' });
    const board = product(ProductType.MOTHERBOARD, 'board', 400000, { socket: 'AM4', memoryType: 'DDR4' });
    const service = createService([oldCpu, newCpu, board]);
    const currentSlugs = ['old-cpu', 'board'];
    await expect(service.applyAction({ action: 'REPLACE_COMPONENT', currentSlugs, productSlug: 'new-cpu', budgetMax: 5000000 })).rejects.toThrow('compatible');
    expect(currentSlugs).toEqual(['old-cpu', 'board']);
  });
});
