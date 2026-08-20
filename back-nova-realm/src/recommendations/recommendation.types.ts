import { Product } from '../catalog/product.types';

export type RecommendationCategory =
  'BEST_MATCH' | 'BEST_VALUE' | 'BUDGET_OPTION' | 'PREMIUM_OPTION';

export interface WorkloadScore {
  slug: string;
  workload: string;
  score: number;
  cpuFit: number;
  gpuFit: number;
  ramFit: number;
  vramFit: number;
  storageFit: number;
}

export interface ScoredRecommendation {
  category: RecommendationCategory;
  categoryLabel: string;
  product: Product;
  fitScore: number;
  performanceFit: number;
  budgetFit: number;
  valueFit: number;
  upgradeabilityFit: number;
  workloadScores: WorkloadScore[];
  strengths: string[];
  weaknesses: string[];
}
