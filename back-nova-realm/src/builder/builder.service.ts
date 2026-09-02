import { BadRequestException, Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { DatabaseService } from '../database/database.service';
import { Product, ProductType } from '../catalog/product.types';
import { AutoBuildRequestDto, BuilderActionDto, BuilderRequestDto, ComponentRecommendationRequestDto, UpgradePcDto } from './builder.dto';

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
  constructor(private readonly catalog: CatalogService, private readonly database: DatabaseService) {}

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
    const candidates = (await this.catalog.findAll({ type: input.componentType, inStock: true })).filter((product) => !selectedSlugs.has(product.slug)).filter((product) => !input.budgetMax || product.price <= input.budgetMax!);
    const compatible = candidates.filter((product) => this.isCompatible(product, selected)).sort((a, b) => {
      if (input.preference === 'powerful') return this.scoreForType(b, input.componentType) - this.scoreForType(a, input.componentType) || b.price - a.price;
      return a.price - b.price;
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
    const assembly = input.assembly && settings.assemblyEnabled ? settings.assemblyPrice : 0;
    const compatibilityIssues = this.compatibilityIssues(components, input.complete ?? false);
    const warnings = compatibilityIssues.map((issue) => issue.message);
    if (input.budgetMax && subtotal + assembly > input.budgetMax) warnings.push(`La configuración supera el presupuesto en ${subtotal + assembly - input.budgetMax} COP.`);
    return { products, components, peripherals, subtotal, assembly, total: subtotal + assembly, budgetRemaining: input.budgetMax ? input.budgetMax - subtotal - assembly : null, assemblyEnabled: settings.assemblyEnabled, warnings, compatibilityIssues, compatible: !compatibilityIssues.some((issue) => issue.severity === 'ERROR') };
  }

  async autoBuild(input: AutoBuildRequestDto) {
    const products = await this.catalog.findAll({ types: COMPONENT_TYPES, inStock: true });
    const pick = (type: ProductType, maxPrice: number, predicate: (product: Product) => boolean = () => true) => {
      const candidates = products.filter((product) => product.type === type && predicate(product));
      return (candidates.filter((product) => product.price <= maxPrice).sort((a, b) => this.scoreForType(b, type) - this.scoreForType(a, type) || a.price - b.price)[0]
        ?? candidates.sort((a, b) => a.price - b.price)[0]);
    };
    const budget = input.budgetMax;
    const cpu = pick(ProductType.CPU, budget * .17);
    const board = cpu ? pick(ProductType.MOTHERBOARD, budget * .13, (item) => item.technicalSpecs.socket === cpu.technicalSpecs.socket) : undefined;
    const ram = board ? pick(ProductType.RAM, budget * .12, (item) => item.technicalSpecs.memoryType === board.technicalSpecs.memoryType) : undefined;
    const gpu = pick(ProductType.GPU, budget * .34);
    const storage = pick(ProductType.STORAGE, budget * .08);
    const psu = pick(ProductType.PSU, budget * .08, (item) => Number(item.technicalSpecs.wattage ?? 0) >= Number(cpu?.technicalSpecs.tdpW ?? 65) + Number(gpu?.technicalSpecs.tdpW ?? 160) + 150);
      const cooling = pick(ProductType.COOLING, budget * .06);
    const pcCase = pick(ProductType.CASE, budget * .06);
    const slugs = [cpu, board, ram, gpu, storage, psu, cooling, pcCase].filter((product): product is Product => Boolean(product)).map((product) => product.slug);
    return this.summarize({ itemSlugs: slugs, budgetMax: input.budgetMax, assembly: input.assembly ?? false });
  }

  async applyAction(input: BuilderActionDto) {
    const current = [...new Set(input.currentSlugs)];
    let target = input.productSlug ? await this.catalog.findBySlug(input.productSlug) : input.productId ? await this.catalog.findAll({ inStock: true }).then((items) => items.find((item) => item.id === input.productId)) : undefined;
    if (input.action === 'START_GUIDED') {
      const summary = await this.summarize({ itemSlugs: current, budgetMax: input.budgetMax, assembly: false });
      return { action: input.action, product: null, summary, flow: await this.flow(current, 'GUIDED'), recommendations: await this.nextRecommendations(current, input.budgetMax) };
    }
    if (input.action === 'AUTO_BUILD') {
      const summary = await this.autoBuild({ budgetMax: input.budgetMax ?? 500000, assembly: input.assembly ?? false });
      return { action: input.action, product: null, summary, flow: await this.flow(summary.products.map((item) => item.slug), 'AUTO'), recommendations: [] };
    }
    if (input.action === 'AUTO_SELECT') {
      if (!input.componentType) throw new BadRequestException('Indica el tipo de componente que Nova debe elegir.');
      const result = await this.recommendComponents({ componentType: input.componentType, itemSlugs: current, budgetMax: input.budgetMax, preference: 'powerful' });
      target = result.recommendations[0];
    }
    if (input.action !== 'CLEAR_BUILD' && input.action !== 'ADD_ASSEMBLY' && input.action !== 'REMOVE_ASSEMBLY' && !target) throw new BadRequestException('No encontré el producto para actualizar la configuración.');
    let slugs = current;
    if (input.action === 'CLEAR_BUILD') slugs = [];
    if (input.action === 'ADD_TO_BUILD' || input.action === 'ADD_PERIPHERAL' || input.action === 'REPLACE_COMPONENT') {
      if (target!.stock <= 0 || !target!.active) throw new BadRequestException('Ese producto no está disponible.');
      slugs = slugs.filter((slug) => slug !== target!.slug);
      if (input.action === 'REPLACE_COMPONENT' || input.action === 'ADD_TO_BUILD' || input.action === 'ADD_PERIPHERAL') {
        const existing = await this.products(slugs);
        slugs = slugs.filter((slug) => !existing.some((item) => item.type === target!.type));
      }
      slugs.push(target!.slug);
    }
    if (input.action === 'REMOVE_FROM_BUILD' || input.action === 'REMOVE_PERIPHERAL') slugs = target ? slugs.filter((slug) => slug !== target.slug) : slugs;
    const assembly = input.action === 'ADD_ASSEMBLY' ? true : input.action === 'REMOVE_ASSEMBLY' ? false : input.assembly ?? false;
    const summary = await this.summarize({ itemSlugs: slugs, budgetMax: input.budgetMax, assembly });
    return { action: input.action, product: target ?? null, summary, flow: await this.flow(slugs, input.mode ?? 'GUIDED'), recommendations: await this.nextRecommendations(slugs, input.budgetMax) };
  }

  private async nextRecommendations(slugs: string[], budgetMax?: number) {
    const step = (await this.flow(slugs, 'GUIDED')).currentStep;
    if (!GUIDED_STEPS.includes(step as ProductType)) return [];
    return (await this.recommendComponents({ componentType: step as ProductType, itemSlugs: slugs, budgetMax })).recommendations;
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
    return product.price;
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
