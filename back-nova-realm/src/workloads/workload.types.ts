export interface Workload {
  id: number;
  slug: string;
  name: string;
  type: string;
  description: string;
  cpuWeight: number;
  gpuWeight: number;
  ramWeight: number;
  storageWeight: number;
  vramWeight: number;
  minimumCpuScore: number;
  recommendedCpuScore: number;
  minimumGpuScore: number;
  recommendedGpuScore: number;
  minimumRamGb: number;
  recommendedRamGb: number;
  minimumVramGb: number;
  recommendedVramGb: number;
  createdAt: string;
  updatedAt: string;
}
