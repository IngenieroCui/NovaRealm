import { Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { Product } from '../catalog/product.types';
import { Workload } from '../workloads/workload.types';
import { WorkloadsService } from '../workloads/workloads.service';
import { RecommendationRequestDto } from './recommendation.dto';
import {
  RecommendationCategory,
  ScoredRecommendation,
  WorkloadScore,
} from './recommendation.types';

interface ScoreDraft extends Omit<
  ScoredRecommendation,
  | 'category'
  | 'categoryLabel'
  | 'fitScore'
  | 'valueFit'
  | 'strengths'
  | 'weaknesses'
> {
  efficiency: number;
}

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly workloads: WorkloadsService,
  ) {}

  recommend(input: RecommendationRequestDto) {
    const workloadEntities = this.workloads.findBySlugs(
      input.workloads.map((item) => item.slug),
    );
    const importanceTotal = input.workloads.reduce(
      (sum, item) => sum + item.importance,
      0,
    );
    const candidates = this.catalog
      .findPrebuiltCandidates(input.budgetMax)
      .filter((product) => this.meetsMinimums(product, workloadEntities));

    const drafts = candidates.map((product) => {
      const workloadScores = workloadEntities.map((workload) =>
        this.scoreWorkload(product, workload, input),
      );
      const performanceFit = this.round(
        workloadScores.reduce((sum, score, index) => {
          return (
            sum +
            score.score * (input.workloads[index].importance / importanceTotal)
          );
        }, 0),
      );
      const budgetFit = this.calculateBudgetFit(
        product.price,
        input.budgetMax,
        input.budgetPreferred,
      );
      const upgradeabilityFit = this.round(product.upgradeabilityScore ?? 50);
      return {
        product,
        performanceFit,
        budgetFit,
        upgradeabilityFit,
        workloadScores,
        efficiency: performanceFit / (product.price / 1_000_000),
      } satisfies ScoreDraft;
    });

    const maxEfficiency = Math.max(
      ...drafts.map((draft) => draft.efficiency),
      1,
    );
    const scored = drafts.map((draft) => {
      const { efficiency, ...publicDraft } = draft;
      const valueFit = this.round((efficiency / maxEfficiency) * 100);
      const futureWeight = input.preferences?.futureUpgrade ? 0.16 : 0.1;
      const fitScore = this.round(
        draft.performanceFit * (0.74 - futureWeight) +
          draft.budgetFit * 0.14 +
          draft.upgradeabilityFit * futureWeight +
          valueFit * 0.12,
      );
      const { strengths, weaknesses } = this.explainNumbers(
        draft,
        valueFit,
        input,
      );
      return {
        ...publicDraft,
        valueFit,
        fitScore,
        strengths,
        weaknesses,
      };
    });

    const recommendations = this.assignCategories(scored);
    return {
      filters: input,
      totalCandidates: candidates.length,
      recommendations,
      scoring: {
        version: 'mvp-1',
        description:
          'Fórmula determinista basada en rendimiento por workload, presupuesto, capacidad de actualización y valor.',
        weights: input.preferences?.futureUpgrade
          ? {
              performance: 0.58,
              budget: 0.14,
              upgradeability: 0.16,
              value: 0.12,
            }
          : {
              performance: 0.64,
              budget: 0.14,
              upgradeability: 0.1,
              value: 0.12,
            },
      },
    };
  }

  private meetsMinimums(product: Product, workloads: Workload[]) {
    return workloads.every((workload) => {
      const cpu = product.cpuScore ?? 0;
      const gpu = product.gpuScore ?? 0;
      const ram = product.ramGb ?? 0;
      const vram = product.vramGb ?? 0;
      return (
        cpu >= workload.minimumCpuScore * 0.78 &&
        gpu >= workload.minimumGpuScore * 0.78 &&
        ram >= workload.minimumRamGb &&
        vram >= workload.minimumVramGb
      );
    });
  }

  private scoreWorkload(
    product: Product,
    workload: Workload,
    input: RecommendationRequestDto,
  ): WorkloadScore {
    const isGame = workload.type === 'GAME';
    const resolutionMultiplier = isGame
      ? { '1080p': 1, '1440p': 1.12, '4k': 1.3 }[input.resolution ?? '1080p']
      : 1;
    const fpsMultiplier = isGame
      ? input.targetFps && input.targetFps >= 240
        ? 1.18
        : input.targetFps && input.targetFps >= 144
          ? 1.08
          : 1
      : 1;
    const recommendedGpu =
      workload.recommendedGpuScore * resolutionMultiplier * fpsMultiplier;
    const cpuFpsMultiplier =
      isGame && input.targetFps && input.targetFps >= 144 ? 1.08 : 1;
    const cpuFit = this.ratio(
      product.cpuScore,
      workload.recommendedCpuScore * cpuFpsMultiplier,
    );
    const gpuFit = this.ratio(product.gpuScore, recommendedGpu);
    const ramFit = this.ratio(product.ramGb, workload.recommendedRamGb);
    const vramFit = this.ratio(product.vramGb, workload.recommendedVramGb);
    const storageFit = this.ratio(product.storageGb, 1000);
    const weightTotal =
      workload.cpuWeight +
      workload.gpuWeight +
      workload.ramWeight +
      workload.vramWeight +
      workload.storageWeight;
    const score = this.round(
      (cpuFit * workload.cpuWeight +
        gpuFit * workload.gpuWeight +
        ramFit * workload.ramWeight +
        vramFit * workload.vramWeight +
        storageFit * workload.storageWeight) /
        weightTotal,
    );
    return {
      slug: workload.slug,
      workload: workload.name,
      score,
      cpuFit: this.round(cpuFit),
      gpuFit: this.round(gpuFit),
      ramFit: this.round(ramFit),
      vramFit: this.round(vramFit),
      storageFit: this.round(storageFit),
    };
  }

  private calculateBudgetFit(price: number, max?: number, preferred?: number) {
    const reference = preferred ?? max;
    if (!reference) return 85;
    if (price <= reference * 0.85) return 100;
    if (price <= reference)
      return this.round(100 - ((price / reference - 0.85) / 0.15) * 10);
    if (max && price <= max) {
      return this.round(
        Math.max(
          70,
          90 - ((price - reference) / Math.max(max - reference, 1)) * 20,
        ),
      );
    }
    return 0;
  }

  private assignCategories(
    scored: Array<Omit<ScoredRecommendation, 'category' | 'categoryLabel'>>,
  ) {
    if (!scored.length) return [];
    const remaining = [...scored];
    const result: ScoredRecommendation[] = [];
    const take = (
      category: RecommendationCategory,
      label: string,
      sorter: (
        a: (typeof remaining)[number],
        b: (typeof remaining)[number],
      ) => number,
    ) => {
      if (!remaining.length) return;
      remaining.sort(sorter);
      const selected = remaining.shift()!;
      result.push({ ...selected, category, categoryLabel: label });
    };
    take('BEST_MATCH', 'Mejor opción', (a, b) => b.fitScore - a.fitScore);
    take(
      'BEST_VALUE',
      'Mejor precio / rendimiento',
      (a, b) => b.valueFit - a.valueFit || b.fitScore - a.fitScore,
    );
    take(
      'BUDGET_OPTION',
      'Alternativa económica',
      (a, b) => a.product.price - b.product.price || b.fitScore - a.fitScore,
    );
    take(
      'PREMIUM_OPTION',
      'Mejor pensando a futuro',
      (a, b) =>
        b.performanceFit +
        b.upgradeabilityFit * 0.35 -
        (a.performanceFit + a.upgradeabilityFit * 0.35),
    );
    return result;
  }

  private explainNumbers(
    draft: ScoreDraft,
    valueFit: number,
    input: RecommendationRequestDto,
  ) {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    if (draft.performanceFit >= 92)
      strengths.push('Rendimiento muy cercano al objetivo indicado');
    else if (draft.performanceFit >= 82)
      strengths.push('Buen equilibrio para los usos seleccionados');
    if ((draft.product.ramGb ?? 0) >= 32)
      strengths.push(`${draft.product.ramGb} GB de RAM para multitarea`);
    if ((draft.product.vramGb ?? 0) >= 12)
      strengths.push(
        `${draft.product.vramGb} GB de VRAM para cargas gráficas exigentes`,
      );
    if (draft.upgradeabilityFit >= 85)
      strengths.push('Plataforma con buen margen de actualización');
    if (valueFit >= 90)
      strengths.push('Muy buena relación entre ajuste y precio');
    const weakWorkloads = draft.workloadScores.filter(
      (score) => score.score < 78,
    );
    if (weakWorkloads.length)
      weaknesses.push(
        `Hace más concesiones en ${weakWorkloads.map((score) => score.workload).join(', ')}`,
      );
    if ((draft.product.ramGb ?? 0) < 32 && input.workloads.length > 1)
      weaknesses.push('16 GB pueden limitar la multitarea pesada');
    if (input.budgetMax && draft.product.price > input.budgetMax * 0.94)
      weaknesses.push('Utiliza casi todo el presupuesto máximo');
    if (!weaknesses.length)
      weaknesses.push(
        'No presenta una limitación importante para los criterios actuales',
      );
    return {
      strengths: strengths.slice(0, 3),
      weaknesses: weaknesses.slice(0, 2),
    };
  }

  private ratio(value: number | null, recommended: number) {
    return Math.min(
      100,
      Math.max(0, ((value ?? 0) / Math.max(recommended, 1)) * 100),
    );
  }

  private round(value: number) {
    return Math.round(Math.min(100, Math.max(0, value)));
  }
}
