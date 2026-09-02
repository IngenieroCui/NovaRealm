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
    const compatibilityIssues = this.compatibilityIssues(components, true);
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
    const target = input.productSlug ? await this.catalog.findBySlug(input.productSlug) : input.productId ? await this.catalog.findAll({ inStock: true }).then((items) => items.find((item) => item.id === input.productId)) : undefined;
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
    return { action: input.action, product: target ?? null, summary: await this.summarize({ itemSlugs: slugs, assembly }) };
  }

  async analyzeUpgrade(input: UpgradePcDto) {
    const products = await this.catalog.findAll({ inStock: true });
    const cpuScore = this.matchHardwareScore(products, ProductType.CPU, input.cpu);
    const gpuScore = this.matchHardwareScore(products, ProductType.GPU, input.gpu);
    const goal = input.goal.toLowerCase();
    const gaming1440 = /1440|2k|qhd/.test(goal);
    const priorityType = gaming1440 && (gpuScore ?? 0) < (cpuScore ?? 100) + 10 ? ProductType.GPU : (cpuScore ?? 0) < 75 ? ProductType.CPU : ProductType.GPU;
    const options = products.filter((product) => product.type === priorityType && (!input.budgetMax || product.price <= input.budgetMax)).sort((a, b) => this.scoreForType(b, priorityType) - this.scoreForType(a, priorityType) || a.price - b.price);
    const currentScore = priorityType === ProductType.GPU ? gpuScore ?? 0 : cpuScore ?? 0;
    const meaningfulUpgrades = options.filter((product) => this.scoreForType(product, priorityType) > currentScore + 5);
    const first = [...meaningfulUpgrades].sort((a, b) => a.price - b.price)[0] ?? options[0];
    const value = [...meaningfulUpgrades].sort((a, b) => (this.scoreForType(b, priorityType) - currentScore) / b.price - (this.scoreForType(a, priorityType) - currentScore) / a.price)[0] ?? options[0];
    const premium = options[0];
    return {
      currentPc: { cpu: input.cpu ?? null, gpu: input.gpu ?? null, ramGb: input.ramGb ?? null },
      goal: input.goal,
      detectedScores: { cpu: cpuScore, gpu: gpuScore, ramGb: input.ramGb ?? null },
      priority: priorityType,
      bestFirstUpgrade: first ?? null,
      bestValue: value ?? null,
      premium: premium ?? null,
      noNeedToChange: priorityType === ProductType.GPU ? 'El Ryzen 5 5600 todavía tiene sentido para este objetivo.' : 'La GPU actual puede esperar mientras mejoras el procesador o la memoria.',
      recommendations: options.slice(0, 4),
    };
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
