import { BuilderService } from './builder.service';
import { Product, ProductType } from '../catalog/product.types';

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
    service = new BuilderService(catalog as never, database as never, workloads as never);
  });

  it('AUTO_SELECT adds the selected product to the build', async () => {
    jest.spyOn(service, 'recommendComponents').mockResolvedValue({ componentType: ProductType.CPU, recommendations: [cpu], warnings: [] });
    const result = await service.applyAction({ action: 'AUTO_SELECT', currentSlugs: [], componentType: ProductType.CPU, budgetMax: 5000000 });
    expect(result.product?.slug).toBe('cpu');
    expect(result.summary.products.map((item) => item.slug)).toContain('cpu');
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
