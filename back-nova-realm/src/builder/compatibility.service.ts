import { Injectable } from '@nestjs/common';
import { Product, ProductType } from '../catalog/product.types';

export type CompatibilityStatus = 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN';
export interface CompatibilityResult { compatibility: CompatibilityStatus; compatibilityReasons: string[]; }
export interface CompatibilityIssue { code: string; severity: 'INFO' | 'WARNING' | 'ERROR'; message: string; }

const COMPONENT_TYPES = [ProductType.CPU, ProductType.MOTHERBOARD, ProductType.RAM, ProductType.GPU, ProductType.STORAGE, ProductType.PSU, ProductType.COOLING, ProductType.CASE];

@Injectable()
export class CompatibilityService {
  evaluate(candidate: Product, selected: Product[]): CompatibilityResult {
    if (!candidate.active || candidate.stock <= 0) return { compatibility: 'INCOMPATIBLE', compatibilityReasons: ['El producto no tiene stock disponible.'] };
    const products = [...selected.filter((item) => item.type !== candidate.type), candidate];
    const checks = this.pairChecks(products).filter((check) => this.checkTouchesType(check.code, candidate.type));
    const failed = checks.filter((check) => check.status === 'INCOMPATIBLE');
    if (failed.length) return { compatibility: 'INCOMPATIBLE', compatibilityReasons: failed.map((check) => check.reason) };
    const unknown = checks.filter((check) => check.status === 'UNKNOWN');
    if (unknown.length) return { compatibility: 'UNKNOWN', compatibilityReasons: unknown.map((check) => check.reason) };
    return { compatibility: 'COMPATIBLE', compatibilityReasons: checks.map((check) => check.reason) };
  }

  issues(products: Product[], requireComplete = false): CompatibilityIssue[] {
    const issues: CompatibilityIssue[] = [];
    for (const product of products) if (!product.active || product.stock <= 0) issues.push({ code: `OUT_OF_STOCK_${product.slug}`, severity: 'ERROR', message: `${product.name} no tiene stock disponible.` });
    for (const check of this.pairChecks(products)) {
      if (check.status === 'INCOMPATIBLE') issues.push({ code: check.code, severity: 'ERROR', message: check.reason });
      if (check.status === 'UNKNOWN') issues.push({ code: check.code, severity: 'WARNING', message: check.reason });
    }
    if (requireComplete) for (const type of COMPONENT_TYPES) if (!products.some((item) => item.type === type)) issues.push({ code: `MISSING_${type}`, severity: 'ERROR', message: `Falta seleccionar ${type.toLowerCase()} para completar la build.` });
    return [...new Map(issues.map((issue) => [`${issue.code}:${issue.message}`, issue])).values()];
  }

  specString(product: Product | undefined, ...keys: string[]) {
    for (const key of keys) {
      const value = product?.technicalSpecs[key];
      if (typeof value === 'string' && value.trim()) return this.normalizeToken(value);
    }
    return undefined;
  }

  specNumber(product: Product | undefined, ...keys: string[]) {
    for (const key of keys) {
      const value = Number(product?.technicalSpecs[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return undefined;
  }

  specList(product: Product | undefined, ...keys: string[]) {
    for (const key of keys) {
      const value = product?.technicalSpecs[key];
      if (Array.isArray(value)) return value.map((item) => this.normalizeToken(String(item))).filter(Boolean);
      if (typeof value === 'string' && value.trim()) return value.split(/[,|/]/).map((item) => this.normalizeToken(item)).filter(Boolean);
    }
    return undefined;
  }

  private pairChecks(products: Product[]) {
    const checks: Array<{ code: string; status: CompatibilityStatus; reason: string }> = [];
    const cpu = products.find((item) => item.type === ProductType.CPU);
    const board = products.find((item) => item.type === ProductType.MOTHERBOARD);
    const ram = products.find((item) => item.type === ProductType.RAM);
    const gpu = products.find((item) => item.type === ProductType.GPU);
    const psu = products.find((item) => item.type === ProductType.PSU);
    const cooling = products.find((item) => item.type === ProductType.COOLING);
    const pcCase = products.find((item) => item.type === ProductType.CASE);
    if (cpu && board) {
      const left = this.specString(cpu, 'socket'); const right = this.specString(board, 'socket');
      checks.push(this.equalCheck('CPU_SOCKET', left, right, `Socket ${left ?? '?'} compatible entre ${cpu.name} y ${board.name}.`, `CPU y motherboard no comparten socket (${left ?? '?'} / ${right ?? '?'}).`, 'No hay datos suficientes de socket para comprobar CPU y motherboard.'));
    }
    if (board && ram) {
      const left = this.specString(board, 'ramType', 'memoryType'); const right = this.specString(ram, 'ramType', 'memoryType');
      checks.push(this.equalCheck('RAM_TYPE', left, right, `${right ?? 'La RAM'} coincide con la generación admitida por ${board.name}.`, `La RAM ${right ?? '?'} no es compatible con la motherboard ${left ?? '?'}.`, 'No hay datos suficientes para comprobar la generación DDR de motherboard y RAM.'));
    }
    if (gpu && psu) {
      const minimum = this.specNumber(gpu, 'recommendedPsuWatts') ?? this.powerEstimate(cpu, gpu); const actual = this.specNumber(psu, 'wattage');
      checks.push(this.minimumCheck('PSU_POWER', actual, minimum, `${psu.name} cumple los ${minimum ?? '?'} W recomendados para la gráfica.`, `La fuente ofrece ${actual ?? '?'} W y la configuración requiere al menos ${minimum ?? '?'} W con margen.`, 'No hay datos suficientes para comprobar la potencia requerida por la GPU.'));
    }
    if (board && pcCase) {
      const value = this.specString(board, 'formFactor'); const supported = this.specList(pcCase, 'supportedFormFactors');
      checks.push(this.listCheck('CASE_FORM_FACTOR', value, supported, `${pcCase.name} admite el formato ${value ?? '?'} de la motherboard.`, `${pcCase.name} no admite el formato ${value ?? '?'} de la motherboard.`, 'No hay datos suficientes para comprobar el formato del chasis.'));
    }
    if (cpu && cooling) {
      const socket = this.specString(cpu, 'socket'); const supported = this.specList(cooling, 'supportedSockets');
      checks.push(this.listCheck('COOLING_SOCKET', socket, supported, `${cooling.name} admite el socket ${socket ?? '?'} del procesador.`, `${cooling.name} no admite el socket ${socket ?? '?'} del procesador.`, 'No hay datos suficientes para comprobar el socket de la refrigeración.'));
      const actual = this.specNumber(cooling, 'maxTdpW', 'tdpW'); const minimum = this.specNumber(cpu, 'tdpW');
      checks.push(this.minimumCheck('COOLING_TDP', actual, minimum, `La refrigeración cubre el TDP de ${cpu.name}.`, `La refrigeración soporta ${actual ?? '?'} W y el CPU requiere ${minimum ?? '?'} W.`, 'No hay datos suficientes para comprobar la capacidad térmica de la refrigeración.'));
    }
    return checks;
  }

  private checkTouchesType(code: string, type: ProductType) {
    const map: Partial<Record<ProductType, string[]>> = {
      [ProductType.CPU]: ['CPU_SOCKET', 'COOLING_SOCKET', 'COOLING_TDP'], [ProductType.MOTHERBOARD]: ['CPU_SOCKET', 'RAM_TYPE', 'CASE_FORM_FACTOR'],
      [ProductType.RAM]: ['RAM_TYPE'], [ProductType.GPU]: ['PSU_POWER'], [ProductType.PSU]: ['PSU_POWER'],
      [ProductType.COOLING]: ['COOLING_SOCKET', 'COOLING_TDP'], [ProductType.CASE]: ['CASE_FORM_FACTOR'],
    };
    return map[type]?.includes(code) ?? false;
  }

  private powerEstimate(cpu: Product | undefined, gpu: Product) {
    const gpuTdp = this.specNumber(gpu, 'tdpW');
    return gpuTdp ? Math.ceil((gpuTdp + (this.specNumber(cpu, 'tdpW') ?? 65) + 120) / 50) * 50 : undefined;
  }
  private equalCheck(code: string, left: string | undefined, right: string | undefined, ok: string, bad: string, unknown: string) { if (!left || !right) return { code, status: 'UNKNOWN' as const, reason: unknown }; return left === right ? { code, status: 'COMPATIBLE' as const, reason: ok } : { code, status: 'INCOMPATIBLE' as const, reason: bad }; }
  private minimumCheck(code: string, actual: number | undefined, minimum: number | undefined, ok: string, bad: string, unknown: string) { if (!actual || !minimum) return { code, status: 'UNKNOWN' as const, reason: unknown }; return actual >= minimum ? { code, status: 'COMPATIBLE' as const, reason: ok } : { code, status: 'INCOMPATIBLE' as const, reason: bad }; }
  private listCheck(code: string, value: string | undefined, supported: string[] | undefined, ok: string, bad: string, unknown: string) { if (!value || !supported?.length) return { code, status: 'UNKNOWN' as const, reason: unknown }; return supported.includes(value) ? { code, status: 'COMPATIBLE' as const, reason: ok } : { code, status: 'INCOMPATIBLE' as const, reason: bad }; }
  private normalizeToken(value: string) { return value.trim().toUpperCase().replace(/\s+/g, '').replace('MICRO-ATX', 'MATX').replace('MICROATX', 'MATX'); }
}
