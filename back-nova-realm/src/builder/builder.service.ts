import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { DatabaseService } from '../database/database.service';
import { Product, ProductType } from '../catalog/product.types';
import { AutoBuildRequestDto, BuilderActionDto, BuilderRequestDto, ComponentRecommendationRequestDto, UpgradePcDto } from './builder.dto';
import { WorkloadsService } from '../workloads/workloads.service';
import { Workload } from '../workloads/workload.types';
import { RecommendationPreferencesDto, WorkloadPreferenceDto } from '../recommendations/recommendation.dto';
import { CompatibilityIssue, CompatibilityService, CompatibilityStatus } from './compatibility.service';

export type CompatibilitySeverity = 'INFO' | 'WARNING' | 'ERROR';
export type { CompatibilityIssue } from './compatibility.service';
export type RecommendationRole = 'RECOMMENDED' | 'BEST_VALUE' | 'BUDGET' | 'PREMIUM';
export interface CandidateRationale {
  reasons: string[];
  tradeoffs: string[];
}
export type ComponentCandidate = Product & {
  compatibility: CompatibilityStatus;
  compatibilityReasons: string[];
  recommendationScore: number;
  budgetImpact: number;
  recommendedRole?: RecommendationRole;
  strengths: string[];
  weaknesses: string[];
  rationale: CandidateRationale;
};

const CORE_COMPONENT_TYPES = [ProductType.CPU, ProductType.MOTHERBOARD, ProductType.RAM];
const OPTIONAL_COMPONENT_TYPES = [ProductType.GPU];
const TRAILING_COMPONENT_TYPES = [ProductType.STORAGE, ProductType.PSU, ProductType.COOLING, ProductType.CASE];
const COMPONENT_TYPES = [...CORE_COMPONENT_TYPES, ...OPTIONAL_COMPONENT_TYPES, ...TRAILING_COMPONENT_TYPES];
const PERIPHERAL_TYPES = [ProductType.MONITOR, ProductType.KEYBOARD, ProductType.MOUSE, ProductType.HEADSET];

export type BuilderMode = 'GUIDED' | 'AUTO';
export interface BuilderFlow {
  mode: BuilderMode;
  currentStep: ProductType | 'PERIPHERALS' | 'ASSEMBLY' | 'DONE';
  currentStepLabel: string;
  previousStep?: ProductType;
  editingStep?: ProductType;
  completedSteps: ProductType[];
  progress: number;
  totalSteps: number;
}

@Injectable()
export class BuilderService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly database: DatabaseService,
    private readonly workloads: WorkloadsService,
    private readonly compatibility: CompatibilityService,
  ) {}

  async settings() {
    const rows = await this.database.all<{ key: string; value: string }>('SELECT key, value FROM store_settings WHERE key IN (?, ?)', 'assemblyEnabled', 'assemblyPrice');
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return { assemblyEnabled: values.get('assemblyEnabled') !== 'false', assemblyPrice: Number(values.get('assemblyPrice') ?? 150000) };
  }

  async updateSettings(input: { assemblyEnabled: boolean; assemblyPrice: number }) {
    await this.database.run('INSERT OR REPLACE INTO store_settings (key, value) VALUES (?, ?), (?, ?)', 'assemblyEnabled', String(input.assemblyEnabled), 'assemblyPrice', String(input.assemblyPrice));
    return this.settings();
  }

  async recommendComponents(input: ComponentRecommendationRequestDto) {
    if (!COMPONENT_TYPES.includes(input.componentType) && !PERIPHERAL_TYPES.includes(input.componentType)) throw new BadRequestException('Tipo no disponible para el configurador');
    const selected = await this.products(input.itemSlugs);
    const selectedSlugs = new Set(selected.map((item) => item.slug));
    const workloadEntities = await this.loadWorkloads(input.workloads);
    const minimumGpuPrice = input.componentType === ProductType.CPU && !this.workloadRequiresDiscreteGpu(workloadEntities) ? await this.minimumDiscreteGpuPrice() : 0;
    const valueScore = (product: Product) => input.componentType === ProductType.CPU && minimumGpuPrice > 0
      ? (this.componentScore(product, input.componentType, workloadEntities, selected, input.preferences) * 1_000_000) / Math.max(this.cpuEffectivePrice(product, minimumGpuPrice), 1)
      : this.componentValueScore(product, input.componentType, workloadEntities, selected, input.preferences);
    const remainingBudget = input.budgetMax === undefined
      ? undefined
      : Math.max(0, input.budgetMax - this.subtotal(selected) - (input.assemblySelected ?? input.assembly ? await this.assemblyPrice() : 0));
    const reserve = remainingBudget === undefined ? 0 : await this.minimumReserve(selected, input.componentType, input.workloads);
    const candidateBudget = remainingBudget === undefined ? undefined : Math.max(0, remainingBudget - reserve);
    const candidates = (await this.catalog.findAll({ type: input.componentType, inStock: true }))
      .filter((product) => !selectedSlugs.has(product.slug))
      .filter((product) => candidateBudget === undefined || product.price <= candidateBudget);
    const evaluated = candidates.map((product) => {
      const result = this.compatibility.evaluate(product, selected);
      const compatibility = this.componentCompatibility(product, input.componentType, selected, result);
      return {
        ...product,
        ...compatibility,
        recommendationScore: Math.round(this.componentScore(product, input.componentType, workloadEntities, selected, input.preferences)),
        budgetImpact: remainingBudget === undefined ? product.price : Math.round((product.price / Math.max(remainingBudget, 1)) * 100),
        strengths: this.candidateStrengths(product, input.componentType, selected, workloadEntities),
        weaknesses: this.candidateWeaknesses(product, input.componentType, selected, workloadEntities),
        rationale: { reasons: [], tradeoffs: [] },
      } as ComponentCandidate;
    });
    const compatible = evaluated
      .filter((product) => product.compatibility === 'COMPATIBLE')
      .filter((product) => input.componentType !== ProductType.MOTHERBOARD || input.preferences?.wifiRequired !== true || product.technicalSpecs.wifi === true)
      .sort((a, b) => {
      if (input.preference === 'cheaper') return a.price - b.price || this.componentScore(b, input.componentType, workloadEntities, selected, input.preferences) - this.componentScore(a, input.componentType, workloadEntities, selected, input.preferences);
      const scoreDifference = this.componentScore(b, input.componentType, workloadEntities, selected, input.preferences) - this.componentScore(a, input.componentType, workloadEntities, selected, input.preferences);
      const valueDifference = valueScore(b) - valueScore(a);
      return input.preference === 'powerful' ? scoreDifference || valueDifference : valueDifference || scoreDifference;
      });
    const recommendations = this.assignRoles(compatible.slice(0, 8), input.componentType, workloadEntities, selected, input.preferences, input.preference, minimumGpuPrice);
    const unknownCount = evaluated.filter((item) => item.compatibility === 'UNKNOWN').length;
    const wifiUnavailable = input.componentType === ProductType.MOTHERBOARD && input.preferences?.wifiRequired === true && !compatible.length;
    return { componentType: input.componentType, recommendations, warnings: recommendations.length ? [] : [wifiUnavailable ? 'No encontré una motherboard compatible con Wi-Fi integrado en el catálogo actual.' : unknownCount ? 'Hay opciones sin datos técnicos suficientes; se excluyeron hasta poder comprobarlas.' : 'No encontré opciones disponibles que cumplan el presupuesto y la compatibilidad.'] };
  }

  async recommendPeripherals(types: ProductType[], budgetMax?: number, resolution?: string, minimumRefreshHz?: number) {
    const products = await this.catalog.findAll({ types, inStock: true });
    return products
      .filter((product) => !budgetMax || product.price <= budgetMax)
      .sort((a, b) => {
        if (a.type === ProductType.MONITOR && b.type === ProductType.MONITOR) {
          const exactA = resolution && String(a.technicalSpecs.resolution ?? '').toLowerCase() === resolution.toLowerCase() ? 1 : 0;
          const exactB = resolution && String(b.technicalSpecs.resolution ?? '').toLowerCase() === resolution.toLowerCase() ? 1 : 0;
          const refreshA = minimumRefreshHz && Number(a.technicalSpecs.refreshHz ?? 0) >= minimumRefreshHz ? 1 : 0;
          const refreshB = minimumRefreshHz && Number(b.technicalSpecs.refreshHz ?? 0) >= minimumRefreshHz ? 1 : 0;
          return exactB - exactA || refreshB - refreshA || a.price - b.price;
        }
        return a.price - b.price;
      });
  }

  async summarize(input: BuilderRequestDto) {
    const products = await this.products(input.itemSlugs);
    const settings = await this.settings();
    const components = products.filter((product) => COMPONENT_TYPES.includes(product.type));
    const peripherals = products.filter((product) => PERIPHERAL_TYPES.includes(product.type));
    const subtotal = products.reduce((total, product) => total + product.price, 0);
    const assemblySelected = input.assemblySelected ?? input.assembly ?? false;
    const assembly = assemblySelected && settings.assemblyEnabled ? settings.assemblyPrice : 0;
    const guidedSteps = await this.resolveGuidedSteps(components, input.workloads);
    const compatibilityIssues = this.compatibility.issues(components, false);
    if (input.complete) {
      for (const type of guidedSteps) {
        if (!components.some((product) => product.type === type)) compatibilityIssues.push({ code: `MISSING_${type}`, severity: 'ERROR', message: `Falta seleccionar ${type.toLowerCase()} para completar la build.` });
      }
    }
    compatibilityIssues.push(...await this.balanceWarnings(components, input.workloads, input.preferences, input.budgetMax, subtotal + assembly));
    const warnings = compatibilityIssues.map((issue) => issue.message);
    if (input.budgetMax && subtotal + assembly > input.budgetMax) warnings.push(`La configuración supera el presupuesto en ${subtotal + assembly - input.budgetMax} COP.`);
    const complete = guidedSteps.every((type) => components.some((product) => product.type === type));
    const hasErrors = compatibilityIssues.some((issue) => issue.severity === 'ERROR');
    const hasUnknown = compatibilityIssues.some((issue) => issue.severity === 'WARNING' && /^(CPU_SOCKET|RAM_TYPE|PSU_POWER|CASE_FORM_FACTOR|COOLING_)/.test(issue.code));
    return { products, components, peripherals, subtotal, assembly, total: subtotal + assembly, budgetRemaining: input.budgetMax ? input.budgetMax - subtotal - assembly : null, assemblyEnabled: settings.assemblyEnabled, warnings, compatibilityIssues, compatibility: hasErrors ? 'INCOMPATIBLE' : hasUnknown ? 'UNKNOWN' : 'COMPATIBLE', complete, compatible: !hasErrors && !hasUnknown };
  }

  async autoBuild(input: AutoBuildRequestDto) {
    const products = await this.catalog.findAll({ types: COMPONENT_TYPES, inStock: true });
    const workloadEntities = await this.loadWorkloads(input.workloadSlugs?.map((slug) => ({ slug, importance: 1 })));
    const assembly = input.assembly ?? false;
    const settings = await this.settings();
    const assemblyCost = assembly && settings.assemblyEnabled ? settings.assemblyPrice : 0;
    const componentBudget = input.budgetMax - assemblyCost;
    const cheapest = await this.findCheapestBuild(products, workloadEntities, input.preferences);
    if (!cheapest || this.subtotal(cheapest) > componentBudget) {
      const summary = await this.summarize({ itemSlugs: [], budgetMax: input.budgetMax, assemblySelected: assembly, complete: true, workloads: input.workloadSlugs?.map((slug) => ({ slug, importance: 1 })), preferences: input.preferences });
      return { ...summary, warnings: [...summary.warnings, 'No puedo completar una configuración razonable dentro de ese presupuesto con el catálogo actual.'] };
    }
    const targetBudget = Math.max(this.subtotal(cheapest), Math.floor(componentBudget * 0.95));
    const selected = await this.upgradeBuild(cheapest, products, targetBudget, workloadEntities);
    const slugs = selected.map((product) => product.slug);
    return this.summarize({ itemSlugs: slugs, budgetMax: input.budgetMax, assemblySelected: assembly, complete: true, workloads: input.workloadSlugs?.map((slug) => ({ slug, importance: 1 })), preferences: input.preferences });
  }

  async applyAction(input: BuilderActionDto) {
    const current = [...new Set(input.currentSlugs)];
    const assemblySelected = input.assemblySelected ?? input.assembly ?? false;
    let target = input.productSlug ? await this.catalog.findBySlug(input.productSlug) : input.productId ? await this.catalog.findAll({ inStock: true }).then((items) => items.find((item) => item.id === input.productId)) : undefined;
    if (input.action === 'START_GUIDED') {
      const summary = await this.summarize({ itemSlugs: current, budgetMax: input.budgetMax, assemblySelected, workloads: input.workloads, preferences: input.preferences });
      return { action: input.action, product: null, summary, flow: await this.flow(current, 'GUIDED', input.workloads), recommendations: await this.nextRecommendations(current, input.budgetMax, input.workloads, assemblySelected, input.preferences) };
    }
    if (input.action === 'AUTO_BUILD') {
      const summary = await this.autoBuild({ budgetMax: input.budgetMax ?? 500000, workloadSlugs: input.workloads?.map((workload) => workload.slug), assembly: assemblySelected, preferences: input.preferences });
      return { action: input.action, product: null, summary, flow: await this.flow(summary.products.map((item) => item.slug), 'AUTO', input.workloads), recommendations: [] };
    }
    if (input.action === 'GO_TO_STEP') {
      if (!input.componentType || !COMPONENT_TYPES.includes(input.componentType)) throw new BadRequestException('GO_TO_STEP requiere un tipo de componente válido.');
      const resolvedSteps = await this.resolveGuidedSteps(await this.products(current), input.workloads);
      if (!resolvedSteps.includes(input.componentType)) throw new BadRequestException('Ese componente no forma parte de los pasos resueltos para esta configuración.');
      const summary = await this.summarize({ itemSlugs: current, budgetMax: input.budgetMax, assemblySelected, workloads: input.workloads, preferences: input.preferences });
      const flow = await this.flow(current, input.mode ?? 'GUIDED', input.workloads, input.componentType);
      const recommendations = await this.recommendComponents({ componentType: input.componentType, itemSlugs: current, budgetMax: input.budgetMax, workloads: input.workloads, preferences: input.preferences, assemblySelected });
      return { action: input.action, product: null, summary, flow, recommendations: recommendations.recommendations };
    }
    if (input.action === 'RETURN_TO_CURRENT_STEP') {
      const summary = await this.summarize({ itemSlugs: current, budgetMax: input.budgetMax, assemblySelected, workloads: input.workloads, preferences: input.preferences });
      const flow = await this.flow(current, input.mode ?? 'GUIDED', input.workloads);
      const recommendations = flow.currentStep !== 'DONE' && COMPONENT_TYPES.includes(flow.currentStep as ProductType)
        ? await this.recommendComponents({ componentType: flow.currentStep as ProductType, itemSlugs: current, budgetMax: input.budgetMax, workloads: input.workloads, preferences: input.preferences, assemblySelected })
        : undefined;
      return { action: input.action, summary, flow, recommendations: recommendations?.recommendations ?? [] };
    }
    let effectiveAction = input.action;
    if (input.action === 'AUTO_SELECT') {
      const autoSelectStep =
        input.componentType &&
        COMPONENT_TYPES.includes(input.componentType)
          ? input.componentType
          : (
              await this.flow(
                current,
                input.mode ?? 'GUIDED',
                input.workloads,
              )
            ).currentStep;
      if (
        autoSelectStep === 'DONE' ||
        !COMPONENT_TYPES.includes(autoSelectStep as ProductType)
      ) {
        throw new BadRequestException(
          'No hay un componente pendiente para seleccionar.',
        );
      }
      const result = await this.recommendComponents({ componentType: autoSelectStep as ProductType, itemSlugs: current, budgetMax: input.budgetMax, assemblySelected, workloads: input.workloads, preferences: input.preferences, preference: input.preference });
      target = result.recommendations.find((item) => item.recommendedRole === 'RECOMMENDED') ?? result.recommendations[0];
      effectiveAction = 'ADD_TO_BUILD';
    }
    if (effectiveAction !== 'CLEAR_BUILD' && effectiveAction !== 'ADD_ASSEMBLY' && effectiveAction !== 'REMOVE_ASSEMBLY' && !target) throw new BadRequestException('No encontré el producto para actualizar la configuración.');
    let slugs = current;
    if (effectiveAction === 'CLEAR_BUILD') slugs = [];
    if (effectiveAction === 'ADD_TO_BUILD' || effectiveAction === 'ADD_PERIPHERAL' || effectiveAction === 'REPLACE_COMPONENT') {
      if (target!.stock <= 0 || !target!.active) throw new BadRequestException('Ese producto no está disponible.');
      slugs = slugs.filter((slug) => slug !== target!.slug);
      const existing = await this.products(slugs);
      slugs = slugs.filter((slug) => !existing.some((item) => item.slug === slug && item.type === target!.type));
      slugs.push(target!.slug);
    }
    if (effectiveAction === 'REMOVE_FROM_BUILD' || effectiveAction === 'REMOVE_PERIPHERAL') slugs = target ? slugs.filter((slug) => slug !== target.slug) : slugs;
    const nextAssembly = effectiveAction === 'ADD_ASSEMBLY' ? true : effectiveAction === 'REMOVE_ASSEMBLY' ? false : assemblySelected;
    const summary = await this.summarize({ itemSlugs: slugs, budgetMax: input.budgetMax, assemblySelected: nextAssembly, workloads: input.workloads, preferences: input.preferences });
    if (summary.compatibilityIssues.some((issue) => issue.severity === 'ERROR' && !issue.code.startsWith('OUT_OF_STOCK'))) {
      throw new ConflictException({ message: 'La pieza elegida no es compatible con la configuración actual.', compatibilityIssues: summary.compatibilityIssues, currentSlugs: current });
    }
    if (input.budgetMax !== undefined && summary.total > input.budgetMax) {
      throw new BadRequestException('La pieza elegida supera el presupuesto disponible.');
    }
    return { action: input.action, product: target ?? null, summary, flow: await this.flow(slugs, input.mode ?? 'GUIDED', input.workloads), recommendations: await this.nextRecommendations(slugs, input.budgetMax, input.workloads, nextAssembly, input.preferences) };
  }

  private async nextRecommendations(slugs: string[], budgetMax?: number, workloads?: WorkloadPreferenceDto[], assemblySelected = false, preferences?: RecommendationPreferencesDto, requestedStep?: ProductType) {
    const step = requestedStep ?? (await this.flow(slugs, 'GUIDED', workloads)).currentStep;
    if (!COMPONENT_TYPES.includes(step as ProductType)) return [];
    return (await this.recommendComponents({ componentType: step as ProductType, itemSlugs: slugs, budgetMax, workloads, preferences, assemblySelected })).recommendations;
  }

  async flow(slugs: string[], mode: BuilderMode = 'GUIDED', workloads?: WorkloadPreferenceDto[], editingStep?: ProductType): Promise<BuilderFlow> {
    const products = await this.products(slugs);
    const selectedTypes = new Set(products.map((product) => product.type));
    const resolvedSteps = await this.resolveGuidedSteps(products, workloads);
    const completed = resolvedSteps.filter((type) => selectedTypes.has(type));
    const current = editingStep ?? resolvedSteps.find((type) => !completed.includes(type)) ?? 'DONE';
    const currentIndex = current === 'DONE' ? resolvedSteps.length : resolvedSteps.indexOf(current);
    const previousStep = currentIndex > 0 ? resolvedSteps[currentIndex - 1] : undefined;
    const totalSteps = resolvedSteps.length;
    return {
      mode,
      currentStep: current,
      currentStepLabel: this.componentLabel(current),
      ...(previousStep ? { previousStep } : {}),
      ...(editingStep ? { editingStep } : {}),
      completedSteps: completed,
      progress: Math.round((completed.length / totalSteps) * 100),
      totalSteps,
    };
  }

  private async resolveGuidedSteps(selected: Product[], workloads?: WorkloadPreferenceDto[]): Promise<ProductType[]> {
    const workloadEntities = await this.loadWorkloads(workloads);
    const cpu = selected.find((product) => product.type === ProductType.CPU);
    const gpu = selected.find((product) => product.type === ProductType.GPU);
    const workloadRequiresGpu = this.workloadRequiresDiscreteGpu(workloadEntities);
    const cpuRequiresGpu = Boolean(cpu && cpu.technicalSpecs.integratedGraphics !== true);
    const gpuRequired = Boolean(gpu || workloadRequiresGpu || cpuRequiresGpu);
    return [...CORE_COMPONENT_TYPES, ...(gpuRequired ? [ProductType.GPU] : []), ...TRAILING_COMPONENT_TYPES];
  }

  private componentLabel(type: BuilderFlow['currentStep']) {
    if (type === 'DONE') return 'Configuración lista';
    return ({
      [ProductType.CPU]: 'Procesador',
      [ProductType.MOTHERBOARD]: 'Motherboard',
      [ProductType.RAM]: 'Memoria RAM',
      [ProductType.GPU]: 'Tarjeta gráfica',
      [ProductType.STORAGE]: 'Almacenamiento',
      [ProductType.PSU]: 'Fuente',
      [ProductType.COOLING]: 'Refrigeración',
      [ProductType.CASE]: 'Chasis',
    } as Record<ProductType, string>)[type as ProductType] ?? String(type);
  }

  private async loadWorkloads(preferences?: WorkloadPreferenceDto[]) {
    if (!preferences?.length) return [];
    const entities = await this.workloads.findBySlugs(preferences.map((item) => item.slug));
    const importance = new Map(preferences.map((item) => [item.slug, item.importance]));
    return entities.map((workload) => ({ workload, importance: importance.get(workload.slug) ?? 1 }));
  }

  private async minimumDiscreteGpuPrice(): Promise<number> {
    const gpus = await this.catalog.findAll({ type: ProductType.GPU, inStock: true });
    return gpus.filter((product) => product.active).sort((a, b) => a.price - b.price)[0]?.price ?? 0;
  }

  private workloadRequiresDiscreteGpu(workloads: Array<{ workload: Workload; importance: number }>): boolean {
    return workloads.some(({ workload }) => workload.type === 'GAME' || workload.type === 'CREATIVE' || workload.type === 'AI' || workload.slug === 'unity' || workload.slug === 'unreal-engine');
  }

  private async selectAutoCpu(
    workloads: Array<{ workload: Workload; importance: number }>,
  ): Promise<Product | undefined> {
    const cpus = (await this.catalog.findAll({ type: ProductType.CPU, inStock: true }))
      .filter((product) => product.active)
      .sort((a, b) => a.price - b.price);

    if (!cpus.length) return undefined;
    if (this.workloadRequiresDiscreteGpu(workloads)) return cpus[0];

    const minimumGpuPrice = await this.minimumDiscreteGpuPrice();
    return [...cpus].sort((a, b) => {
      const aEffective = a.price + (a.technicalSpecs.integratedGraphics === true ? 0 : minimumGpuPrice);
      const bEffective = b.price + (b.technicalSpecs.integratedGraphics === true ? 0 : minimumGpuPrice);
      return aEffective - bEffective || (b.cpuScore ?? 0) - (a.cpuScore ?? 0);
    })[0];
  }

  private cpuEffectivePrice(product: Product, minimumGpuPrice: number): number {
    return product.price + (product.technicalSpecs.integratedGraphics === true ? 0 : minimumGpuPrice);
  }

  private subtotal(products: Product[]) {
    return products.reduce((total, product) => total + product.price, 0);
  }

  private async assemblyPrice() {
    const settings = await this.settings();
    return settings.assemblyEnabled ? settings.assemblyPrice : 0;
  }

  private async minimumReserve(selected: Product[], targetType: ProductType, workloads?: WorkloadPreferenceDto[]) {
    const guidedSteps = await this.resolveGuidedSteps(selected, workloads);
    const missingTypes = guidedSteps.filter((type) => type !== targetType && !selected.some((product) => product.type === type));
    let reserve = 0;
    for (const type of missingTypes) {
      const candidates = await this.catalog.findAll({ type, inStock: true });
      const cheapest = candidates
        .filter((product) => this.isCompatible(product, selected))
        .sort((a, b) => a.price - b.price)[0];
      if (cheapest) reserve += cheapest.price;
    }
    return reserve;
  }

  private async findCheapestBuild(products: Product[], workloads: Array<{ workload: Workload; importance: number }>, preferences?: RecommendationPreferencesDto) {
    const cheapest = (type: ProductType, predicate: (product: Product) => boolean = () => true) => products
      .filter((product) => product.type === type && predicate(product))
      .sort((a, b) => a.price - b.price)[0];
    const cpu = await this.selectAutoCpu(workloads);
    const board = cpu ? cheapest(ProductType.MOTHERBOARD, (product) => this.isUsable(product, [cpu])) : undefined;
    const ram = board && cpu ? cheapest(ProductType.RAM, (product) => this.isUsable(product, [cpu, board])) : undefined;
    const core = [cpu, board, ram].filter((product): product is Product => Boolean(product));
    const guidedSteps = await this.resolveGuidedSteps(core, workloads.map(({ workload, importance }) => ({ slug: workload.slug, importance })));
    const gpu = guidedSteps.includes(ProductType.GPU) ? cheapest(ProductType.GPU, (product) => this.isUsable(product, core)) : undefined;
    const withGpu = [...core, ...(gpu ? [gpu] : [])];
    const storage = cheapest(ProductType.STORAGE, (product) => this.isUsable(product, withGpu));
    const psu = cheapest(ProductType.PSU, (product) => this.isUsable(product, withGpu) && this.psuScore(product, withGpu) > 0);
    const cooling = cheapest(ProductType.COOLING, (product) => this.isUsable(product, withGpu));
    const pcCase = cheapest(ProductType.CASE, (product) => this.isUsable(product, [...withGpu, ...(storage ? [storage] : []), ...(psu ? [psu] : []), ...(cooling ? [cooling] : [])]));
    const selectedByType = new Map([cpu, board, ram, gpu, storage, psu, cooling, pcCase].filter((product): product is Product => Boolean(product)).map((product) => [product.type, product] as const));
    const build = guidedSteps.map((type) => selectedByType.get(type)).filter((product): product is Product => Boolean(product));
    return build.length === guidedSteps.length && guidedSteps.every((type) => build.some((product) => product.type === type)) && this.compatibilityIssues(build).every((issue) => issue.severity !== 'ERROR')
      ? build
      : this.findCheapestCompatibleBuild(products, workloads);
  }

  private async findCheapestCompatibleBuild(products: Product[], workloads: Array<{ workload: Workload; importance: number }>) {
    const sorted = (type: ProductType) => products.filter((product) => product.type === type).sort((a, b) => a.price - b.price);
    for (const cpu of sorted(ProductType.CPU)) {
      for (const board of sorted(ProductType.MOTHERBOARD).filter((candidate) => this.isUsable(candidate, [cpu]))) {
        const ram = sorted(ProductType.RAM).find((candidate) => this.isUsable(candidate, [cpu, board]));
        if (!ram) continue;
        const core = [cpu, board, ram];
        const guidedSteps = await this.resolveGuidedSteps(core, workloads.map(({ workload, importance }) => ({ slug: workload.slug, importance })));
        const gpu = guidedSteps.includes(ProductType.GPU) ? sorted(ProductType.GPU).find((candidate) => this.isUsable(candidate, core)) : undefined;
        const withGpu = [...core, ...(gpu ? [gpu] : [])];
        const storage = sorted(ProductType.STORAGE).find((candidate) => this.isUsable(candidate, withGpu));
        const psu = sorted(ProductType.PSU).find((candidate) => this.isUsable(candidate, withGpu) && this.psuScore(candidate, withGpu) > 0);
        const cooling = sorted(ProductType.COOLING).find((candidate) => this.isUsable(candidate, withGpu));
        const pcCase = sorted(ProductType.CASE).find((candidate) => this.isUsable(candidate, [...withGpu, ...(storage ? [storage] : []), ...(psu ? [psu] : []), ...(cooling ? [cooling] : [])]));
        const selectedByType = new Map([cpu, board, ram, gpu, storage, psu, cooling, pcCase].filter((product): product is Product => Boolean(product)).map((product) => [product.type, product] as const));
        const build = guidedSteps.map((type) => selectedByType.get(type)).filter((product): product is Product => Boolean(product));
        if (build.length === guidedSteps.length && guidedSteps.every((type) => build.some((product) => product.type === type)) && this.compatibilityIssues(build).every((issue) => issue.severity !== 'ERROR')) return build;
      }
    }
    return undefined;
  }

  private async upgradeBuild(base: Product[], products: Product[], budget: number, workloads: Array<{ workload: Workload; importance: number }>) {
    const selected = [...base];
    for (let round = 0; round < COMPONENT_TYPES.length * 3; round += 1) {
      const currentTotal = this.subtotal(selected);
      let best: { type: ProductType; product: Product; gain: number; cost: number } | undefined;
      for (const type of COMPONENT_TYPES) {
        const current = selected.find((product) => product.type === type);
        if (!current) continue;
        for (const candidate of products.filter((product) => product.type === type && product.slug !== current.slug && product.price > current.price)) {
          const next = selected.map((product) => product.type === type ? candidate : product);
          const cost = candidate.price - current.price;
          const gain = this.componentScore(candidate, type, workloads, next) - this.componentScore(current, type, workloads, selected);
          if (gain <= 0 || currentTotal + cost > budget || !this.compatibilityIssues(next).every((issue) => issue.severity !== 'ERROR')) continue;
          if (!best || gain / cost > best.gain / best.cost) best = { type, product: candidate, gain, cost };
        }
      }
      if (!best) break;
      const index = selected.findIndex((product) => product.type === best!.type);
      selected[index] = best.product;
    }
    return selected;
  }

  async analyzeUpgrade(input: UpgradePcDto) {
    const products = await this.catalog.findAll({ inStock: true });
    const cpuScore = this.matchHardwareScore(products, ProductType.CPU, input.cpu);
    const gpuScore = this.matchHardwareScore(products, ProductType.GPU, input.gpu);
    const goal = input.goal.toLowerCase();
    const gaming1440 = /1440|2k|qhd/.test(goal);
    const memoryHeavy = /edicion|editar|blender|render|maquina virtual|virtual machine|docker|after effects|premiere/.test(goal);
    const storageHeavy = /espacio|almacenamiento|disco lleno|guardar mas/.test(goal);
    const priorityType = storageHeavy
      ? ProductType.STORAGE
      : (input.ramGb ?? 0) < (memoryHeavy ? 32 : 16)
        ? ProductType.RAM
        : gaming1440
          ? ProductType.GPU
          : cpuScore !== null && gpuScore !== null
            ? cpuScore + 10 < gpuScore ? ProductType.CPU : ProductType.GPU
            : cpuScore !== null
              ? cpuScore < 75 ? ProductType.CPU : ProductType.GPU
              : gpuScore !== null
                ? gpuScore < 80 ? ProductType.GPU : ProductType.CPU
                : /render|blender|jugar|calidad grafica/.test(goal) ? ProductType.GPU : ProductType.CPU;
    const options = products.filter((product) => product.type === priorityType && (!input.budgetMax || product.price <= input.budgetMax) && this.upgradeCandidateCompatible(product, priorityType, input)).sort((a, b) => this.scoreForType(b, priorityType) - this.scoreForType(a, priorityType) || a.price - b.price);
    const currentScore = priorityType === ProductType.GPU ? gpuScore ?? 0 : priorityType === ProductType.RAM ? input.ramGb ?? 0 : priorityType === ProductType.STORAGE ? 0 : cpuScore ?? 0;
    const improvementThreshold = priorityType === ProductType.RAM ? 8 : 5;
    const meaningfulUpgrades = options.filter((product) => this.scoreForType(product, priorityType) > currentScore + improvementThreshold);
    const first = [...meaningfulUpgrades].sort((a, b) => a.price - b.price)[0] ?? options[0];
    const value = [...meaningfulUpgrades].sort((a, b) => (this.scoreForType(b, priorityType) - currentScore) / b.price - (this.scoreForType(a, priorityType) - currentScore) / a.price)[0] ?? options[0];
    const premium = options[0];
    const bottleneck = this.upgradeBottleneck(cpuScore, gpuScore, input.ramGb, goal);
    const compatibilityChecks = [
      priorityType === ProductType.CPU
        ? { status: 'VERIFY', label: 'Motherboard y socket', detail: input.motherboard ? `Hay que confirmar que ${input.motherboard} use el socket del procesador elegido y que su BIOS sea compatible.` : 'Necesito el modelo de la motherboard para confirmar socket y BIOS.' }
        : null,
      priorityType === ProductType.GPU
        ? { status: input.psuW ? 'CHECKED' : 'VERIFY', label: 'Fuente de poder', detail: input.psuW ? `La fuente reportada es de ${input.psuW} W; antes de comprar validaré potencia, conectores y calidad contra la GPU elegida.` : 'Windows no puede detectar la fuente. Revisa la etiqueta lateral para confirmar potencia, modelo y conectores.' }
        : null,
      priorityType === ProductType.RAM
        ? { status: this.inferMemoryType(input.motherboard) ? 'CHECKED' : 'VERIFY', label: 'Tipo y ranuras de memoria', detail: this.inferMemoryType(input.motherboard) ? `Filtré el catálogo a ${this.inferMemoryType(input.motherboard)}, según la motherboard reportada. Aún hay que confirmar ranuras libres y capacidad máxima.` : 'Necesito el modelo de la motherboard para confirmar DDR4/DDR5 y ranuras libres.' }
        : null,
      priorityType === ProductType.STORAGE
        ? { status: 'VERIFY', label: 'Interfaz y espacio disponible', detail: input.motherboard ? `Antes de elegir entre NVMe y SATA, confirma que ${input.motherboard} tenga un puerto o conector libre.` : 'Necesito el modelo de la motherboard para confirmar si hay un M.2 o un puerto SATA libre.' }
        : null,
    ].filter(Boolean);
    return {
      currentPc: { cpu: input.cpu ?? null, gpu: input.gpu ?? null, ramGb: input.ramGb ?? null, motherboard: input.motherboard ?? null, storage: input.storage ?? null, psuW: input.psuW ?? null },
      goal: input.goal,
      detectedScores: { cpu: cpuScore, gpu: gpuScore, ramGb: input.ramGb ?? null },
      priority: priorityType,
      bottleneck,
      assessment: this.upgradeAssessment(priorityType, input, cpuScore, gpuScore),
      compatibilityChecks,
      bestFirstUpgrade: first ?? null,
      bestValue: value ?? null,
      premium: premium ?? null,
      noNeedToChange: priorityType === ProductType.GPU ? `${input.cpu ?? 'Tu procesador actual'} todavía puede acompañar esta mejora.` : [ProductType.RAM, ProductType.STORAGE].includes(priorityType) ? 'No cambiaría CPU ni GPU antes de resolver este límite y volver a medir el rendimiento.' : `${input.gpu ?? 'Tu GPU actual'} puede esperar mientras mejoras el procesador.`,
      recommendations: options.slice(0, 4),
    };
  }

  private upgradeBottleneck(cpuScore: number | null, gpuScore: number | null, ramGb: number | null | undefined, goal: string) {
    if ((ramGb ?? 0) < (/blender|render|edicion|docker|virtual/.test(goal) ? 32 : 16)) return 'La memoria es el límite más claro para el uso que describes.';
    if (cpuScore === null || gpuScore === null) return 'Puedo orientar la compra, pero no cuantificar el cuello de botella porque uno de los componentes no está en el catálogo de referencia.';
    if (cpuScore + 12 < gpuScore) return 'El procesador está bastante por detrás de la GPU y puede limitar estabilidad y FPS altos.';
    if (gpuScore + 12 < cpuScore) return 'La GPU es el límite más probable, especialmente al subir resolución o calidad gráfica.';
    return 'CPU y GPU se ven razonablemente equilibrados; la mejora debe enfocarse en el objetivo concreto, no en cambiar piezas por cambiar.';
  }

  private upgradeAssessment(priority: ProductType, input: UpgradePcDto, cpuScore: number | null, gpuScore: number | null) {
    const known = cpuScore !== null && gpuScore !== null;
    const target = priority === ProductType.GPU ? 'tarjeta gráfica' : priority === ProductType.RAM ? 'memoria RAM' : priority === ProductType.STORAGE ? 'almacenamiento' : 'procesador';
    return `Empezaría por la ${target}. ${known ? 'Comparé el equilibrio relativo de CPU y GPU con el objetivo indicado.' : 'La recomendación es prudente porque no pude puntuar todo el hardware actual.'} ${input.budgetMax ? 'Las opciones respetan el presupuesto máximo.' : 'Falta un presupuesto para ordenar las opciones por valor real.'}`;
  }

  private upgradeCandidateCompatible(product: Product, priority: ProductType, input: UpgradePcDto) {
    if (priority === ProductType.CPU) {
      const socket = this.inferSocket(input.motherboard);
      return !socket || !product.technicalSpecs.socket || product.technicalSpecs.socket === socket;
    }
    if (priority === ProductType.RAM) {
      const memoryType = this.inferMemoryType(input.motherboard);
      return !memoryType || !product.technicalSpecs.memoryType || product.technicalSpecs.memoryType === memoryType;
    }
    if (priority === ProductType.GPU && input.psuW) {
      return Number(product.technicalSpecs.tdpW ?? 160) + 250 <= input.psuW;
    }
    if (priority === ProductType.STORAGE) return (product.storageGb ?? 0) >= 1000;
    return true;
  }

  private inferSocket(motherboard?: string | null) {
    const value = motherboard?.toLowerCase() ?? '';
    if (/b650|x670|am5/.test(value)) return 'AM5';
    if (/b550|a520|x570|am4/.test(value)) return 'AM4';
    if (/b760|z790|h610|lga\s*1700/.test(value)) return 'LGA1700';
    return null;
  }

  private inferMemoryType(motherboard?: string | null) {
    const value = motherboard?.toLowerCase() ?? '';
    if (/ddr5|b650|x670|b760|z790/.test(value)) return 'DDR5';
    if (/ddr4|b550|a520|x570|h610/.test(value)) return 'DDR4';
    return null;
  }

  private async products(slugs: string[]) {
    if (!slugs.length) return [];
    const products = await this.catalog.findBySlugs(slugs);
    if (products.some((product) => product.stock <= 0 || !product.active)) throw new BadRequestException('La configuración contiene un producto sin stock.');
    return products;
  }

  private isCompatible(product: Product, selected: Product[]) {
    return this.compatibility.evaluate(product, selected).compatibility === 'COMPATIBLE';
  }

  private isUsable(product: Product, selected: Product[]) {
    return this.compatibility.evaluate(product, selected).compatibility !== 'INCOMPATIBLE';
  }

  private scoreForType(product: Product, type: ProductType) {
    if (type === ProductType.GPU) return product.gpuScore ?? 0;
    if (type === ProductType.CPU) return product.cpuScore ?? 0;
    if (type === ProductType.RAM) return product.ramGb ?? 0;
    if (type === ProductType.STORAGE) return product.storageGb ?? 0;
    if (type === ProductType.PSU) return Number(product.technicalSpecs.wattage ?? 0);
    if (type === ProductType.MOTHERBOARD) return product.upgradeabilityScore ?? 50;
    if (type === ProductType.COOLING) return Number(product.technicalSpecs.tdpW ?? 0) || 1;
    if (type === ProductType.CASE) return product.upgradeabilityScore ?? 50;
    return 0;
  }

  private componentScore(product: Product, type: ProductType, workloads: Array<{ workload: Workload; importance: number }>, selected: Product[] = [], preferences?: RecommendationPreferencesDto) {
    if (type === ProductType.PSU) return this.psuScore(product, selected);
    if (!workloads.length) return this.scoreForType(product, type);
    const scoreForWorkload = workloads.reduce((total, { workload, importance }) => {
      const value = type === ProductType.CPU
        ? this.ratio(product.cpuScore, workload.recommendedCpuScore)
        : type === ProductType.GPU
          ? this.ratio(product.gpuScore, workload.recommendedGpuScore)
          : type === ProductType.RAM
            ? this.ramScore(product.ramGb, workload)
            : type === ProductType.STORAGE
              ? this.ratio(product.storageGb, 1000)
              : type === ProductType.MOTHERBOARD
                ? preferences?.futureUpgrade ? product.upgradeabilityScore ?? 70 : 70
                : 60;
      return total + value * importance;
    }, 0);
    const importanceTotal = workloads.reduce((total, item) => total + item.importance, 0);
    return scoreForWorkload / Math.max(importanceTotal, 1);
  }

  private componentValueScore(product: Product, type: ProductType, workloads: Array<{ workload: Workload; importance: number }>, selected: Product[] = [], preferences?: RecommendationPreferencesDto) {
    return (this.componentScore(product, type, workloads, selected, preferences) * 1_000_000) / Math.max(product.price, 1);
  }

  private ramScore(capacity: number | null | undefined, workload: Workload) {
    const value = this.ratio(capacity, workload.recommendedRamGb);
    const target = Math.max(workload.recommendedRamGb, workload.minimumRamGb);
    const actual = capacity ?? 0;
    const overspendPenalty = actual >= target * 4 ? 20 : actual >= target * 2 ? 10 : 0;
    return Math.max(0, value - overspendPenalty);
  }

  private psuScore(product: Product, selected: Product[]) {
    const wattage = Number(product.technicalSpecs.wattage ?? 0);
    const required = this.requiredPsuWatts(selected);
    if (!wattage || wattage < required) return 0;
    const delta = wattage - required;
    if (delta <= 150) return Math.max(90, 100 - Math.round(Math.abs(delta - 75) / 15));
    if (delta <= 300) return Math.max(70, 88 - Math.round((delta - 150) / 15));
    return Math.max(20, 65 - Math.round((delta - 300) / 10));
  }

  private requiredPsuWatts(selected: Product[]) {
    const gpu = selected.find((item) => item.type === ProductType.GPU);
    return gpu ? Number(gpu.technicalSpecs.recommendedPsuWatts ?? 0) || 450 : 450;
  }

  private componentCompatibility(product: Product, type: ProductType, selected: Product[], result: { compatibility: CompatibilityStatus; compatibilityReasons: string[] }) {
    if (type !== ProductType.PSU) return result;
    const score = this.psuScore(product, selected);
    if (score > 0) return result;
    const gpu = selected.find((item) => item.type === ProductType.GPU);
    const required = gpu ? Number(gpu.technicalSpecs.recommendedPsuWatts ?? 0) || 450 : 450;
    return {
      compatibility: 'INCOMPATIBLE' as const,
      compatibilityReasons: [...result.compatibilityReasons, `La fuente debe ofrecer al menos ${required} W para esta configuración.`],
    };
  }

  private ratio(value: number | null | undefined, recommended: number) {
    return Math.min(100, Math.max(0, ((value ?? 0) / Math.max(recommended, 1)) * 100));
  }

  private compatibilityIssues(products: Product[], requireComplete = false): CompatibilityIssue[] { return this.compatibility.issues(products, requireComplete); }

  private assignRoles(
    candidates: ComponentCandidate[],
    componentType: ProductType,
    workloads: Array<{ workload: Workload; importance: number }>,
    selectedProducts: Product[],
    preferences?: RecommendationPreferencesDto,
    preference?: 'cheaper' | 'powerful',
    minimumGpuPrice = 0,
  ) {
    if (!candidates.length) return candidates;
    const score = (candidate: ComponentCandidate) => this.componentScore(candidate, componentType, workloads, selectedProducts, preferences);
    const value = (candidate: ComponentCandidate) => componentType === ProductType.CPU && minimumGpuPrice > 0
      ? (this.componentScore(candidate, componentType, workloads, selectedProducts, preferences) * 1_000_000) / Math.max(this.cpuEffectivePrice(candidate, minimumGpuPrice), 1)
      : this.componentValueScore(candidate, componentType, workloads, selectedProducts, preferences);
    const cheapest = [...candidates].sort((a, b) => a.price - b.price || score(b) - score(a))[0];
    const valueCandidates = candidates.filter((candidate) => !this.isNormalOfficeRamOverspend(candidate, componentType, workloads) || candidates.every((item) => this.isNormalOfficeRamOverspend(item, componentType, workloads)));
    const bestValue = [...valueCandidates].sort((a, b) => value(b) - value(a) || score(b) - score(a) || a.price - b.price)[0] ?? candidates[0];
    const strongest = [...candidates].sort((a, b) => score(b) - score(a) || value(b) - value(a) || a.price - b.price)[0];
    const recommended = preference === 'cheaper'
      ? cheapest
      : preference === 'powerful'
        ? strongest
        : preferences?.valuePriority
          ? bestValue
          : strongest;
    const roles = new Map<string, RecommendationRole>();
    roles.set(recommended.slug, 'RECOMMENDED');
    const setDistinct = (candidate: ComponentCandidate | undefined, role: RecommendationRole) => {
      if (candidate && !roles.has(candidate.slug)) roles.set(candidate.slug, role);
    };
    setDistinct([...candidates].sort((a, b) => value(b) - value(a) || score(b) - score(a) || a.price - b.price).find((candidate) => score(candidate) >= 60) ?? bestValue, 'BEST_VALUE');
    setDistinct(cheapest, 'BUDGET');
    const premium = [...candidates]
      .sort((a, b) => score(b) - score(a) || (b.upgradeabilityScore ?? 0) - (a.upgradeabilityScore ?? 0))
      .find((candidate) => candidate.slug !== recommended.slug && (score(candidate) >= score(recommended) + 8 || (candidate.upgradeabilityScore ?? 0) >= (recommended.upgradeabilityScore ?? 0) + 12));
    setDistinct(premium, 'PREMIUM');
    return candidates.map((candidate) => {
      const recommendedRole = roles.get(candidate.slug);
      const rationale = this.candidateRationale(candidate, componentType, workloads, selectedProducts, preferences, recommendedRole);
      return {
        ...candidate,
        ...(recommendedRole ? { recommendedRole } : {}),
        rationale,
        strengths: [...new Set([...candidate.strengths, ...rationale.reasons])].slice(0, 3),
        weaknesses: [...new Set([...candidate.weaknesses, ...rationale.tradeoffs])].slice(0, 2),
      };
    });
  }

  private isNormalOfficeRamOverspend(candidate: Product, type: ProductType, workloads: Array<{ workload: Workload; importance: number }>) {
    if (type !== ProductType.RAM || !workloads.length) return false;
    if (!workloads.every(({ workload }) => workload.type === 'PROFESSIONAL' && workload.recommendedRamGb <= 16)) return false;
    const target = Math.max(...workloads.map(({ workload }) => workload.recommendedRamGb));
    return (candidate.ramGb ?? 0) >= target * 4;
  }

  private candidateRationale(candidate: ComponentCandidate, type: ProductType, workloads: Array<{ workload: Workload; importance: number }>, selectedProducts: Product[], preferences?: RecommendationPreferencesDto, role?: RecommendationRole): CandidateRationale {
    const reasons: string[] = ['Es compatible con los componentes seleccionados.'];
    const tradeoffs: string[] = [];
    const recommendedRam = Math.max(0, ...workloads.map(({ workload }) => workload.recommendedRamGb));
    const workloadNames = workloads.some(({ workload }) => workload.slug === 'ofimatica-basica') ? 'ofimática' : workloads.map(({ workload }) => workload.name.toLowerCase()).join(', ');
    if (type === ProductType.RAM && recommendedRam) {
      const capacity = candidate.ramGb ?? 0;
      if (capacity === recommendedRam) reasons.push(`Cumple los ${recommendedRam} GB recomendados para ${workloadNames || 'el uso indicado'}.`);
      else if (capacity < recommendedRam) tradeoffs.push(`Queda por debajo de los ${recommendedRam} GB recomendados para ${workloadNames || 'estos usos'}.`);
      else if (capacity >= recommendedRam * 2 && workloads.every(({ workload }) => workload.type === 'PROFESSIONAL' && workload.recommendedRamGb <= 16)) tradeoffs.push(`Más caro sin mejora importante para ${workloadNames || 'ofimática'}.`);
      else reasons.push(`Aporta ${capacity} GB para multitarea y cargas simultáneas.`);
    }
    if (type === ProductType.MOTHERBOARD && preferences?.wifiRequired) {
      reasons.push('Tiene Wi-Fi integrado, requisito indicado por el usuario.');
    }
    if (type === ProductType.PSU) {
      const required = this.requiredPsuWatts(selectedProducts);
      if (candidate.technicalSpecs.wattage && Number(candidate.technicalSpecs.wattage) <= required + 150) reasons.push(`Está dentro del rango de ${required} a ${required + 150} W recomendado para esta configuración.`);
      if (Number(candidate.technicalSpecs.wattage ?? 0) > required + 300) tradeoffs.push('Tiene mucha más potencia de la necesaria para esta configuración.');
    }
    if (role === 'BEST_VALUE') reasons.push('Es la opción más económica que alcanza el objetivo actual.');
    if (role === 'BUDGET') reasons.push('Es la alternativa de menor precio que conserva compatibilidad.');
    if (role === 'PREMIUM') reasons.push('Ofrece margen adicional de capacidad o actualización que sí puede aprovecharse.');
    if (preferences?.futureUpgrade && (candidate.upgradeabilityScore ?? 0) >= 75) reasons.push('Ofrece más margen de actualización.');
    if (!tradeoffs.length && role === 'PREMIUM') tradeoffs.push('Requiere más presupuesto para aprovechar su capacidad adicional.');
    return { reasons: [...new Set(reasons)].slice(0, 4), tradeoffs: [...new Set(tradeoffs)].slice(0, 3) };
  }

  private candidateStrengths(product: Product, type: ProductType, selected: Product[], workloads: Array<{ workload: Workload; importance: number }>) {
    const strengths = this.compatibility.evaluate(product, selected).compatibilityReasons.slice(0, 2);
    if (type === ProductType.RAM && (product.ramGb ?? 0) >= Math.max(32, ...workloads.map(({ workload }) => workload.recommendedRamGb))) strengths.push('Capacidad adecuada para multitarea exigente.');
    if (type === ProductType.MOTHERBOARD && (product.upgradeabilityScore ?? 0) >= 70) strengths.push('Buen margen para mejoras futuras.');
    return strengths.slice(0, 3);
  }

  private candidateWeaknesses(product: Product, type: ProductType, _selected: Product[], workloads: Array<{ workload: Workload; importance: number }>) {
    const weaknesses: string[] = [];
    if (type === ProductType.RAM && workloads.some(({ workload }) => (product.ramGb ?? 0) < workload.recommendedRamGb)) weaknesses.push('Queda por debajo de la memoria recomendada para uno de tus usos.');
    if (type === ProductType.PSU && Number(product.technicalSpecs.wattage ?? 0) >= 1000) weaknesses.push('Puede ser más potencia de la necesaria para esta build.');
    return weaknesses;
  }

  private async balanceWarnings(products: Product[], workloadsInput?: WorkloadPreferenceDto[], preferences?: RecommendationPreferencesDto, budgetMax?: number, currentTotal = 0): Promise<CompatibilityIssue[]> {
    const issues: CompatibilityIssue[] = [];
    const cpu = products.find((item) => item.type === ProductType.CPU);
    const gpu = products.find((item) => item.type === ProductType.GPU);
    const ram = products.find((item) => item.type === ProductType.RAM);
    const psu = products.find((item) => item.type === ProductType.PSU);
    const cooling = products.find((item) => item.type === ProductType.COOLING);
    const pcCase = products.find((item) => item.type === ProductType.CASE);
    const workloads = await this.loadWorkloads(workloadsInput);
    const recommendedRam = Math.max(0, ...workloads.map(({ workload }) => workload.recommendedRamGb));
    if (ram && recommendedRam && (ram.ramGb ?? 0) < recommendedRam) issues.push({ code: 'BALANCE_WARNING_RAM', severity: 'WARNING', message: `${ram.ramGb ?? 0} GB funcionan, pero tus usos recomiendan ${recommendedRam} GB para trabajar con margen.` });
    if (ram && recommendedRam && (ram.ramGb ?? 0) >= recommendedRam * 4 && workloads.every(({ workload }) => workload.type === 'PROFESSIONAL' && workload.recommendedRamGb <= 16)) issues.push({ code: 'BALANCE_WARNING_RAM_OVERSPEND', severity: 'WARNING', message: `${ram.ramGb ?? 0} GB superan ampliamente lo esperado para tus usos actuales; podrías invertir esa diferencia en una pieza que sí cambie el rendimiento.` });
    if (cpu && gpu && (cpu.cpuScore ?? 0) - (gpu.gpuScore ?? 0) >= 12 && (budgetMax ?? 0) - currentTotal > 700000) issues.push({ code: 'BALANCE_WARNING_GPU', severity: 'WARNING', message: 'La gráfica queda bastante por detrás del procesador y todavía hay presupuesto; movería más inversión a la GPU.' });
    const requiredPsu = gpu ? Number(gpu.technicalSpecs.recommendedPsuWatts ?? 0) || 450 : 450;
    if (psu && requiredPsu && Number(psu.technicalSpecs.wattage ?? 0) > requiredPsu + 300) issues.push({ code: 'BALANCE_WARNING_PSU', severity: 'WARNING', message: 'La fuente está muy sobredimensionada; puedes ahorrar sin perder el margen recomendado para la GPU.' });
    if (preferences?.wifiRequired && products.some((item) => item.type === ProductType.MOTHERBOARD && item.technicalSpecs.wifi !== true)) issues.push({ code: 'BALANCE_WARNING_WIFI', severity: 'WARNING', message: 'La motherboard seleccionada no acredita Wi-Fi integrado, aunque lo marcaste como requisito.' });
    if (cooling && cpu && cooling.price > cpu.price * 0.75 && (cpu.cpuScore ?? 0) < 85) issues.push({ code: 'BALANCE_WARNING_COOLING', severity: 'WARNING', message: 'La refrigeración consume demasiado presupuesto para este procesador; priorizaría rendimiento o memoria.' });
    const missingPerformance = !gpu || !ram || !products.some((item) => item.type === ProductType.STORAGE);
    if (pcCase && missingPerformance && pcCase.price >= 600000) issues.push({ code: 'BALANCE_WARNING_CASE', severity: 'WARNING', message: 'El chasis es costoso mientras faltan piezas de rendimiento; reservaría ese dinero para la build.' });
    return issues;
  }

  private matchHardwareScore(products: Product[], type: ProductType.CPU | ProductType.GPU, hardware?: string | null) {
    if (!hardware) return null;
    const key = this.hardwareKey(hardware);
    const product = products.find((item) => {
      if (item.type !== type) return false;
      const candidateKey = this.hardwareKey(type === ProductType.CPU ? item.cpu ?? '' : item.gpu ?? '');
      return candidateKey.includes(key) || key.includes(candidateKey);
    });
    return product ? this.scoreForType(product, type) : null;
  }

  private hardwareKey(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
}
