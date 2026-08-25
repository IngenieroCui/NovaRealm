import { BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ProductType } from './product.types';

describe('CatalogService', () => {
  it('rejects a prebuilt PC without the scores required for recommendations', async () => {
    const database = {
      all: jest.fn().mockResolvedValue([]),
      run: jest.fn(),
    };
    const service = new CatalogService(database as any);

    await expect(
      service.create({
        name: 'PC incompleto',
        slug: 'pc-incompleto',
        description: 'Perfil de prueba',
        price: 3_000_000,
        type: ProductType.PREBUILT_PC,
        cpu: 'CPU sin referencia',
        gpu: 'GPU sin referencia',
        ramGb: 16,
        storageGb: 512,
        vramGb: 8,
        upgradeabilityScore: 60,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(database.run).not.toHaveBeenCalled();
  });

  it('reuses component scores when creating a PC with matching hardware', async () => {
    const database = {
      all: jest.fn(async (_: string, type: ProductType) => [
        type === ProductType.CPU
          ? {
              type,
              cpu: 'AMD Ryzen 5 7600',
              cpuScore: 77,
              active: 1,
              features: '[]',
            }
          : {
              type,
              gpu: 'GeForce RTX 4060 8 GB',
              gpuScore: 77,
              active: 1,
              features: '[]',
            },
      ]),
    };
    const service = new CatalogService(database as any);

    const profile = await (service as any).completePrebuiltProfile({
      type: ProductType.PREBUILT_PC,
      cpu: 'AMD Ryzen 5 7600',
      gpu: 'GeForce RTX 4060',
    });

    expect(profile).toMatchObject({ cpuScore: 77, gpuScore: 77 });
  });
});
