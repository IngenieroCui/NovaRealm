import { BadRequestException } from '@nestjs/common';
import { WorkloadsService } from './workloads.service';

describe('WorkloadsService', () => {
  it('rejects a workload whose recommended requirement is below its minimum', async () => {
    const service = new WorkloadsService({} as any);

    await expect(
      service.create({
        slug: 'perfil-invalido',
        name: 'Perfil inválido',
        type: 'PROFESSIONAL',
        description: 'Solo para probar validación.',
        cpuWeight: 0.3,
        gpuWeight: 0.2,
        ramWeight: 0.25,
        storageWeight: 0.15,
        vramWeight: 0.1,
        minimumCpuScore: 70,
        recommendedCpuScore: 60,
        minimumGpuScore: 30,
        recommendedGpuScore: 45,
        minimumRamGb: 8,
        recommendedRamGb: 16,
        minimumVramGb: 2,
        recommendedVramGb: 4,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
