export enum ProductType {
  PREBUILT_PC = 'PREBUILT_PC',
  CPU = 'CPU',
  GPU = 'GPU',
  RAM = 'RAM',
  MOTHERBOARD = 'MOTHERBOARD',
  STORAGE = 'STORAGE',
  PSU = 'PSU',
  CASE = 'CASE',
  COOLING = 'COOLING',
}

export interface Product {
  id: number;
  name: string;
  slug: string;
  description: string;
  price: number;
  stock: number;
  imageUrl: string;
  active: boolean;
  type: ProductType;
  cpu: string | null;
  gpu: string | null;
  ramGb: number | null;
  storageGb: number | null;
  vramGb: number | null;
  cpuScore: number | null;
  gpuScore: number | null;
  productivityScore: number | null;
  upgradeabilityScore: number | null;
  features: string[];
  createdAt: string;
  updatedAt: string;
}

export type ProductRow = Omit<Product, 'active' | 'features'> & {
  active: number;
  features: string;
};
