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
  MONITOR = 'MONITOR',
  KEYBOARD = 'KEYBOARD',
  MOUSE = 'MOUSE',
  HEADSET = 'HEADSET',
}

export type ProductTechnicalSpecs = Record<string, string | number | boolean | string[]>;

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
  technicalSpecs: ProductTechnicalSpecs;
  createdAt: string;
  updatedAt: string;
}

export type ProductRow = Omit<Product, 'active' | 'features'> & {
  active: number;
  features: string;
  technicalSpecs: string;
};
