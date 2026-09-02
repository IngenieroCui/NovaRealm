import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { DatabaseService } from '../database/database.service';
import { Product, ProductType } from '../catalog/product.types';
import { AutoBuildRequestDto, BuilderActionDto, BuilderRequestDto, ComponentRecommendationRequestDto, UpgradePcDto } from './builder.dto';
import { WorkloadsService } from '../workloads/workloads.service';
import { Workload } from '../workloads/workload.types';
import { WorkloadPreferenceDto } from '../recommendations/recommendation.dto';

export type CompatibilitySeverity = 'INFO' | 'WARNING' | 'ERROR';
export interface CompatibilityIssue {
  code: string;
  severity: CompatibilitySeverity;
  message: string;
}

const COMPONENT_TYPES = [ProductType.CPU, ProductType.MOTHERBOARD, ProductType.RAM, ProductType.GPU, ProductType.STORAGE, ProductType.PSU, ProductType.COOLING, ProductType.CASE];
const PERIPHERAL_TYPES = [ProductType.MONITOR, ProductType.KEYBOARD, ProductType.MOUSE, ProductType.HEADSET];
const GUIDED_STEPS = [...COMPONENT_TYPES];

export type BuilderMode = 'GUIDED' | 'AUTO';
export interface BuilderFlow {
  mode: BuilderMode;
  currentStep: ProductType | 'PERIPHERALS' | 'ASSEMBLY' | 'DONE';
  currentStepLabel: string;
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
    const remainingBudget = input.budgetMax === undefined
      ? undefined
      : Math.max(0, input.budgetMax - this.subtotal(selected) - (input.assemblySelected ?? input.assembly ? await this.assemblyPrice() : 0));
    const reserve = remainingBudget === undefined ? 0 : await this.minimumReserve(selected, input.componentType);
    const candidateBudget = remainingBudget === undefined ? undefined : Math.max(0, remainingBudget - reserve);
    const candidates = (await this.catalog.findAll({ type: input.componentType, inStock: true }))
      .filter((product) => !selectedSlugs.has(product.slug))
      .filter((product) => candidateBudget === undefined || product.price <= candidateBudget);
    const compatible = candidates.filter((product) => this.isCompatible(product, selected)).sort((a, b) => {
      if (input.preference === 'cheaper') return a.price - b.price || this.componentScore(b, input.componentType, workloadEntities) - this.componentScore(a, input.componentType, workloadEntities);
      const scoreDifference = this.componentScore(b, input.componentType, workloadEntities) - this.componentScore(a, input.componentType, workloadEntities);
      const valueDifference = this.componentValueScore(b, input.componentType, workloadEntities) - this.componentValueScore(a, input.componentType, workloadEntities);
      return input.preference === 'powerful' ? scoreDifference || valueDifference : valueDifference || scoreDifference;
    });
    return { componentType: input.componentType, recommendations: compatible.slice(0, 5), warnings: compatible.length ? [] : ['No encontré opciones disponibles que cumplan el presupuesto y la compatibilidad básica.'] };
  }

  async recommendPeripherals(budgetMax?: number, minimumRefreshHz?: number) {
    const products = await this.catalog.findAll({ types: PERIPHERAL_TYPES, inStock: true });
    return products.filter((product) => !budgetMax || product.price <= budgetMax).filter((product) => !minimumRefreshHz || product.type !== ProductType.MONITOR || Number(product.technicalSpecs.refreshHz ?? 0) >= minimumRefreshHz).sort((a, b) => a.price - b.price).slice(0, 8);
  }

  async summarize(input: BuilderRequestDto) {
    const products = await this.products(input.itemSlugs);
    const settings = await this.settings();
    const components = products.filter((product) => COMPONENT_TYPES.includes(product.type));
    const peripherals = products.filter((product) => PERIPHERAL_TYPES.includes(product.type));
    const subtotal = products.reduce((total, product) => total + product.price, 0);
    const assemblySelected = input.assemblySelected ?? input.assembly ?? false;
    const assembly = assemblySelected && settings.assemblyEnabled ? settings.assemblyPrice : 0;
    const compatibilityIssues = this.compatibilityIssues(components, input.complete ?? false);
    const warnings = compatibilityIssues.map((issue) => issue.message);
    if (input.budgetMax && subtotal + assembly > input.budgetMax) warnings.push(`La configuración supera el presupuesto en ${subtotal + assembly - input.budgetMax} COP.`);
    const complete = COMPONENT_TYPES.every((type) => components.some((product) => product.type === type));
    return { products, components, peripherals, subtotal, assembly, total: subtotal + assembly, budgetRemaining: input.budgetMax ? input.budgetMax - subtotal - assembly : null, assemblyEnabled: settings.assemblyEnabled, warnings, compatibilityIssues, complete, compatible: !compatibilityIssues.some((issue) => issue.severity === 'ERROR') };
  }

  async autoBuild(input: AutoBuildRequestDto) {
    const products = await this.catalog.findAll({ types: COMPONENT_TYPES, inStock: true });
    const workloadEntities = await this.loadWorkloads(input.workloadSlugs?.map((slug) => ({ slug, importance: 1 })));
    const assembly = input.assembly ?? false;
    const settings = await this.settings();
    const assemblyCost = assembly && settings.assemblyEnabled ? settings.assemblyPrice : 0;
    const componentBudget = input.budgetMax - assemblyCost;
    const cheapest = this.findCheapestBuild(products, workloadEntities);
    if (!cheapest || this.subtotal(cheapest) > componentBudget) {
      const summary = await this.summarize({ itemSlugs: [], budgetMax: input.budgetMax, assemblySelected: assembly, complete: true, workloads: input.workloadSlugs?.map((slug) => ({ slug, importance: 1 })) });
      return { ...summary, warnings: [...summary.warnings, 'No puedo completar una configuración razonable dentro de ese presupuesto con el catálogo actual.'] };
    }
    const targetBudget = Math.max(this.subtotal(cheapest), Math.floor(componentBudget * 0.95));
    const selected = await this.upgradeBuild(cheapest, products, targetBudget, workloadEntities);
    const slugs = selected.map((product) => product.slug);
    return this.summarize({ itemSlugs: slugs, budgetMax: input.budgetMax, assemblySelected: assembly, complete: true, workloads: input.workloadSlugs?.map((slug) => ({ slug, importance: 1 })) });
  }

  async applyAction(input: BuilderActionDto) {
    const current = [...new Set(input.currentSlugs)];
    const assemblySelected = input.assemblySelected ?? input.assembly ?? false;
    let target = input.productSlug ? await this.catalog.findBySlug(input.productSlug) : input.productId ? await this.catalog.findAll({ inStock: true }).then((items) => items.find((item) => item.id === input.productId)) : undefined;
    if (input.action === 'START_GUIDED') {
      const summary = await this.summarize({ itemSlugs: current, budgetMax: input.budgetMax, assemblySelected, workloads: input.workloads });
      return { action: input.action, product: null, summary, flow: await this.flow(current, 'GUIDED'), recommendations: await this.nextRecommendations(current, input.budgetMax, input.workloads, assemblySelected) };
    }
    if (input.action === 'AUTO_BUILD') {
      const summary = await this.autoBuild({ budgetMax: input.budgetMax ?? 500000, workloadSlugs: input.workloads?.map((workload) => workload.slug), assembly: assemblySelected });
      return { action: input.action, product: null, summary, flow: await this.flow(summary.products.map((item) => item.slug), 'AUTO'), recommendations: [] };
    }
    let effectiveAction = input.action;
    if (input.action === 'AUTO_SELECT') {
      const currentStep = (await this.flow(current, 'GUIDED')).currentStep;
      if (!GUIDED_STEPS.includes(currentStep as ProductType)) throw new BadRequestException('La configuración ya no tiene un componente pendiente.');
      const result = await this.recommendComponents({ componentType: currentStep as ProductType, itemSlugs: current, budgetMax: input.budgetMax, assemblySelected, workloads: input.workloads, preference: 'powerful' });
      target = result.recommendations[0];
      effectiveAction = 'ADD_TO_BUILD';
    }
    if (effectiveAction !== 'CLEAR_BUILD' && effectiveAction !== 'ADD_ASSEMBLY' && effectiveAction !== 'REMOVE_ASSEMBLY' && !target) throw new BadRequestException('No encontré el producto para actualizar la configuración.');
    let slugs = current;
    if (effectiveAction === 'CLEAR_BUILD') slugs = [];
    if (effectiveAction === 'ADD_TO_BUILD' || effectiveAction === 'ADD_PERIPHERAL' || effectiveAction === 'REPLACE_COMPONENT') {
      if (target!.stock <= 0 || !target!.active) throw new BadRequestException('Ese producto no está disponible.');
      slugs = slugs.filter((slug) => slug !== target!.slug);
      const existing = await this.products(slugs);
      slugs = slugs.filter((slug) => !existing.some((item) => item.type === target!.type));
      slugs.push(target!.slug);
    }
    if (effectiveAction === 'REMOVE_FROM_BUILD' || effectiveAction === 'REMOVE_PERIPHERAL') slugs = target ? slugs.filter((slug) => slug !== target.slug) : slugs;
    const nextAssembly = effectiveAction === 'ADD_ASSEMBLY' ? true : effectiveAction === 'REMOVE_ASSEMBLY' ? false : assemblySelected;
    const summary = await this.summarize({ itemSlugs: slugs, budgetMax: input.budgetMax, assemblySelected: nextAssembly, workloads: input.workloads });
    if (summary.compatibilityIssues.some((issue) => issue.severity === 'ERROR' && issue.code !== 'OUT_OF_STOCK')) {
      throw new ConflictException('La pieza elegida no es compatible con la configuración actual.');
    }
    if (input.budgetMax !== undefined && summary.total > input.budgetMax) {
      throw new BadRequestException('La pieza elegida supera el presupuesto disponible.');
    }
    return { action: input.action, product: target ?? null, summary, flow: await this.flow(slugs, input.mode ?? 'GUIDED'), recommendations: await this.nextRecommendations(slugs, input.budgetMax, input.workloads, nextAssembly) };
  }

  private async nextRecommendations(slugs: string[], budgetMax?: number, workloads?: WorkloadPreferenceDto[], assemblySelected = false) {
    const step = (await this.flow(slugs, 'GUIDED')).currentStep;
    if (!GUIDED_STEPS.includes(step as ProductType)) return [];
    return (await this.recommendComponents({ componentType: step as ProductType, itemSlugs: slugs, budgetMax, workloads, assemblySelected })).recommendations;
  }

  async flow(slugs: string[], mode: BuilderMode = 'GUIDED'): Promise<BuilderFlow> {
    const products = await this.products(slugs);
    const selectedTypes = new Set(products.map((product) => product.type));
    const completed = GUIDED_STEPS.filter((type) => selectedTypes.has(type));
    const current = GUIDED_STEPS.find((type) => !completed.includes(type)) ?? 'DONE';
    const totalSteps = GUIDED_STEPS.length;
    return {
      mode,
      currentStep: current,
      currentStepLabel: current === 'DONE' ? 'Configuración lista' : current === 'MOTHERBOARD' ? 'Motherboard' : current === 'RAM' ? 'Memoria RAM' : current === 'GPU' ? 'Tarjeta gráfica' : current === 'PSU' ? 'Fuente' : current === 'STORAGE' ? 'Almacenamiento' : current === 'COOLING' ? 'Refrigeración' : current === 'CASE' ? 'Chasis' : 'Procesador',
      completedSteps: completed,
      progress: Math.round((completed.length / totalSteps) * 100),
      totalSteps,
    };
  }

  private async loadWorkloads(preferences?: WorkloadPreferenceDto[]) {
    if (!preferences?.length) return [];
    const entities = await this.workloads.findBySlugs(preferences.map((item) => item.slug));
    const importance = new Map(preferences.map((item) => [item.slug, item.importance]));
    return entities.map((workload) => ({ workload, importance: importance.get(workload.slug) ?? 1 }));
  }

  private subtotal(products: Product[]) {
    return products.reduce((total, product) => total + product.price, 0);
  }

  private async assemblyPrice() {
    const settings = await this.settings();
    return settings.assemblyEnabled ? settings.assemblyPrice : 0;
  }

  private async minimumReserve(selected: Product[], targetType: ProductType) {
    const missingTypes = COMPONENT_TYPES.filter((type) => type !== targetType && !selected.some((product) => product.type === type));
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

  private findCheapestBuild(products: Product[], workloads: Array<{ workload: Workload; importance: number }>) {
    const cheapest = (type: ProductType, predicate: (product: Product) => boolean = () => true) => products
      .filter((product) => product.type === type && predicate(product))
      .sort((a, b) => a.price - b.price)[0];
    const cpu = cheapest(ProductType.CPU);
    const board = cpu ? cheapest(ProductType.MOTHERBOARD, (product) => this.isCompatible(product, [cpu])) : undefined;
    const ram = board ? cheapest(ProductType.RAM, (product) => this.isCompatible(product, [cpu, board])) : undefined;
    const gpu = cheapest(ProductType.GPU);
    const storage = cheapest(ProductType.STORAGE);
    const psu = cheapest(ProductType.PSU, (product) => this.isCompatible(product, [cpu, gpu]));
    const cooling = cheapest(ProductType.COOLING);
    const pcCase = cheapest(ProductType.CASE);
    const build = [cpu, board, ram, gpu, storage, psu, cooling, pcCase].filter((product): product is Product => Boolean(product));
    return build.length === COMPONENT_TYPES.length && this.isCompatible(build[0], build.slice(1)) && this.compatibilityIssues(build).every((issue) => issue.severity !== 'ERROR')
      ? build
      : this.findCheapestCompatibleBuild(products);
  }

  private findCheapestCompatibleBuild(products: Product[]) {
    const sorted = (type: ProductType) => products.filter((product) => product.type === type).sort((a, b) => a.price - b.price);
    for (const cpu of sorted(ProductType.CPU)) {
      for (const board of sorted(ProductType.MOTHERBOARD).filter((candidate) => this.isCompatible(candidate, [cpu]))) {
        const ram = sorted(ProductType.RAM).find((candidate) => this.isCompatible(candidate, [cpu, board]));
        const gpu = sorted(ProductType.GPU)[0];
        const storage = sorted(ProductType.STORAGE)[0];
        const psu = sorted(ProductType.PSU).find((candidate) => this.isCompatible(candidate, [cpu, gpu]));
        const cooling = sorted(ProductType.COOLING)[0];
        const pcCase = sorted(ProductType.CASE)[0];
        const build = [cpu, board, ram, gpu, storage, psu, cooling, pcCase].filter((product): product is Product => Boolean(product));
        if (build.length === COMPONENT_TYPES.length && this.compatibilityIssues(build).every((issue) => issue.severity !== 'ERROR')) return build;
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
          const gain = this.componentScore(candidate, type, workloads) - this.componentScore(current, type, workloads);
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
    const test = [...selected, product];
    return this.compatibilityIssues(test).every((issue) => issue.severity !== 'ERROR');
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

  private componentScore(product: Product, type: ProductType, workloads: Array<{ workload: Workload; importance: number }>) {
    if (!workloads.length) return this.scoreForType(product, type);
    const scoreForWorkload = workloads.reduce((total, { workload, importance }) => {
      const value = type === ProductType.CPU
        ? this.ratio(product.cpuScore, workload.recommendedCpuScore)
        : type === ProductType.GPU
          ? this.ratio(product.gpuScore, workload.recommendedGpuScore)
          : type === ProductType.RAM
            ? this.ratio(product.ramGb, workload.recommendedRamGb)
            : type === ProductType.STORAGE
              ? this.ratio(product.storageGb, 1000)
              : type === ProductType.MOTHERBOARD
                ? 70
                : type === ProductType.PSU
                  ? this.ratio(Number(product.technicalSpecs.wattage ?? 0), 850)
                  : 60;
      return total + value * importance;
    }, 0);
    const importanceTotal = workloads.reduce((total, item) => total + item.importance, 0);
    return scoreForWorkload / Math.max(importanceTotal, 1);
  }

  private componentValueScore(product: Product, type: ProductType, workloads: Array<{ workload: Workload; importance: number }>) {
    return (this.componentScore(product, type, workloads) * 1_000_000) / Math.max(product.price, 1);
  }

  private ratio(value: number | null | undefined, recommended: number) {
    return Math.min(100, Math.max(0, ((value ?? 0) / Math.max(recommended, 1)) * 100));
  }

  private compatibilityIssues(products: Product[], requireComplete = false): CompatibilityIssue[] {
    const issues: CompatibilityIssue[] = [];
    const cpu = products.find((item) => item.type === ProductType.CPU);
    const board = products.find((item) => item.type === ProductType.MOTHERBOARD);
    const ram = products.find((item) => item.type === ProductType.RAM);
    const gpu = products.find((item) => item.type === ProductType.GPU);
    const psu = products.find((item) => item.type === ProductType.PSU);
    if (cpu && board && cpu.technicalSpecs.socket && board.technicalSpecs.socket && cpu.technicalSpecs.socket !== board.technicalSpecs.socket) issues.push({ code: 'CPU_SOCKET', severity: 'ERROR', message: `CPU y motherboard no comparten socket (${cpu.technicalSpecs.socket} / ${board.technicalSpecs.socket}).` });
    if (ram && board && ram.technicalSpecs.memoryType && board.technicalSpecs.memoryType && ram.technicalSpecs.memoryType !== board.technicalSpecs.memoryType) issues.push({ code: 'RAM_MEMORY_TYPE', severity: 'ERROR', message: `La RAM ${ram.technicalSpecs.memoryType} no es compatible con la motherboard ${board.technicalSpecs.memoryType}.` });
    if (psu) {
      const required = Number(cpu?.technicalSpecs.tdpW ?? 65) + Number(gpu?.technicalSpecs.tdpW ?? 160) + 150;
      if (Number(psu.technicalSpecs.wattage ?? 0) < required) issues.push({ code: 'PSU_POWER', severity: 'ERROR', message: `La fuente necesita al menos ${required} W para estos componentes.` });
    }
    if (products.some((item) => item.stock <= 0 || !item.active)) issues.push({ code: 'OUT_OF_STOCK', severity: 'ERROR', message: 'Hay un producto sin stock o inactivo en la configuración.' });
    if (requireComplete) {
      for (const type of COMPONENT_TYPES) if (!products.some((item) => item.type === type)) issues.push({ code: `MISSING_${type}`, severity: 'ERROR', message: `Falta seleccionar ${type.toLowerCase()} para completar la build.` });
    }
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
