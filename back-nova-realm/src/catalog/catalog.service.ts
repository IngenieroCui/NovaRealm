import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProductQueryDto, ProductSort, ProductWriteDto } from './product.dto';
import { Product, ProductRow, ProductType } from './product.types';

@Injectable()
export class CatalogService {
  constructor(private readonly database: DatabaseService) {}

  findAll(query: ProductQueryDto = {}, includeInactive = false): Product[] {
    const conditions = includeInactive ? ['1 = 1'] : ['active = 1'];
    const params: (string | number)[] = [];

    if (query.search) {
      conditions.push(
        '(name LIKE ? OR description LIKE ? OR cpu LIKE ? OR gpu LIKE ?)',
      );
      const search = `%${query.search.trim()}%`;
      params.push(search, search, search, search);
    }
    if (query.type) {
      conditions.push('type = ?');
      params.push(query.type);
    }
    if (query.types?.length) {
      conditions.push(`type IN (${query.types.map(() => '?').join(', ')})`);
      params.push(...query.types);
    }
    if (query.minPrice !== undefined) {
      conditions.push('price >= ?');
      params.push(query.minPrice);
    }
    if (query.maxPrice !== undefined) {
      conditions.push('price <= ?');
      params.push(query.maxPrice);
    }
    if (query.minRamGb !== undefined) {
      conditions.push('ramGb >= ?');
      params.push(query.minRamGb);
    }
    if (query.minStorageGb !== undefined) {
      conditions.push('storageGb >= ?');
      params.push(query.minStorageGb);
    }
    if (query.minVramGb !== undefined) {
      conditions.push('vramGb >= ?');
      params.push(query.minVramGb);
    }
    if (query.minCpuScore !== undefined) {
      conditions.push('cpuScore >= ?');
      params.push(query.minCpuScore);
    }
    if (query.minGpuScore !== undefined) {
      conditions.push('gpuScore >= ?');
      params.push(query.minGpuScore);
    }
    if (query.inStock !== undefined) {
      conditions.push(query.inStock ? 'stock > 0' : 'stock = 0');
    }

    const orderBy = {
      [ProductSort.PRICE_ASC]: 'price ASC',
      [ProductSort.PRICE_DESC]: 'price DESC',
      [ProductSort.NAME]: 'name COLLATE NOCASE ASC',
      [ProductSort.FEATURED]:
        "CASE WHEN type = 'PREBUILT_PC' THEN 0 ELSE 1 END, price ASC",
    }[query.sort ?? ProductSort.FEATURED];

    const rows = this.database.all<ProductRow>(
      `SELECT * FROM products WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy}`,
      ...params,
    );
    return rows.map((row) => this.mapProduct(row));
  }

  findPrebuiltCandidates(budgetMax?: number): Product[] {
    const query: ProductQueryDto = { type: ProductType.PREBUILT_PC };
    if (budgetMax !== undefined) query.maxPrice = budgetMax;
    return this.findAll(query).filter((product) => product.stock > 0);
  }

  findBySlug(slug: string): Product {
    const row = this.database.get<ProductRow>(
      'SELECT * FROM products WHERE slug = ? AND active = 1',
      slug,
    );
    if (!row) throw new NotFoundException('Producto no encontrado');
    return this.mapProduct(row);
  }

  findBySlugs(slugs: string[]): Product[] {
    return slugs.map((slug) => this.findBySlug(slug));
  }

  create(input: ProductWriteDto): Product {
    const normalizedInput = this.completePrebuiltProfile(input);
    if (
      !normalizedInput.name ||
      !normalizedInput.slug ||
      !normalizedInput.description ||
      normalizedInput.price === undefined ||
      !normalizedInput.type
    ) {
      throw new BadRequestException(
        'name, slug, description, price y type son obligatorios',
      );
    }
    this.ensurePrebuiltProfile(normalizedInput);
    try {
      const result = this.database.run(
        `INSERT INTO products (
          name, slug, description, price, stock, imageUrl, active, type, cpu, gpu,
          ramGb, storageGb, vramGb, cpuScore, gpuScore, productivityScore,
          upgradeabilityScore, features
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalizedInput.name,
        normalizedInput.slug,
        normalizedInput.description,
        normalizedInput.price,
        normalizedInput.stock ?? 0,
        normalizedInput.imageUrl ?? '/products/component.svg',
        normalizedInput.active === false ? 0 : 1,
        normalizedInput.type,
        normalizedInput.cpu ?? null,
        normalizedInput.gpu ?? null,
        normalizedInput.ramGb ?? null,
        normalizedInput.storageGb ?? null,
        normalizedInput.vramGb ?? null,
        normalizedInput.cpuScore ?? null,
        normalizedInput.gpuScore ?? null,
        normalizedInput.productivityScore ?? null,
        normalizedInput.upgradeabilityScore ?? null,
        JSON.stringify(normalizedInput.features ?? []),
      );
      return this.findById(Number(result.lastInsertRowid));
    } catch (error) {
      throw new BadRequestException(
        `No se pudo crear el producto: ${(error as Error).message}`,
      );
    }
  }

  update(id: number, input: ProductWriteDto): Product {
    const current = this.findById(id);
    const normalizedInput = this.completePrebuiltProfile(input, current);
    this.ensurePrebuiltProfile({ ...current, ...normalizedInput });
    const entries = Object.entries(normalizedInput).filter(
      ([, value]) => value !== undefined,
    );
    if (!entries.length) return this.findById(id);

    const allowed = new Set([
      'name',
      'slug',
      'description',
      'price',
      'stock',
      'imageUrl',
      'active',
      'type',
      'cpu',
      'gpu',
      'ramGb',
      'storageGb',
      'vramGb',
      'cpuScore',
      'gpuScore',
      'productivityScore',
      'upgradeabilityScore',
      'features',
    ]);
    const columns: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, rawValue] of entries) {
      if (!allowed.has(key)) continue;
      columns.push(`${key} = ?`);
      if (key === 'features') values.push(JSON.stringify(rawValue));
      else if (key === 'active') values.push(rawValue ? 1 : 0);
      else values.push(rawValue as string | number | null);
    }
    columns.push('updatedAt = CURRENT_TIMESTAMP');
    try {
      this.database.run(
        `UPDATE products SET ${columns.join(', ')} WHERE id = ?`,
        ...values,
        id,
      );
      return this.findById(id);
    } catch (error) {
      throw new BadRequestException(
        `No se pudo actualizar el producto: ${(error as Error).message}`,
      );
    }
  }

  private findById(id: number): Product {
    const row = this.database.get<ProductRow>(
      'SELECT * FROM products WHERE id = ?',
      id,
    );
    if (!row) throw new NotFoundException('Producto no encontrado');
    return this.mapProduct(row);
  }

  private mapProduct(row: ProductRow): Product {
    return {
      ...row,
      active: Boolean(row.active),
      features: JSON.parse(row.features || '[]') as string[],
    };
  }

  /**
   * A PC is evaluated from its hardware profile, never from a manual score per
   * application. If its CPU/GPU already exists as a catalog component, reuse
   * that normalized score; otherwise the admin must provide one explicitly.
   */
  private completePrebuiltProfile(
    input: ProductWriteDto,
    current?: Product,
  ): ProductWriteDto {
    const type = input.type ?? current?.type;
    if (type !== ProductType.PREBUILT_PC) return input;

    const completed = { ...input };
    const cpuChanged = input.cpu !== undefined && input.cpu !== current?.cpu;
    const gpuChanged = input.gpu !== undefined && input.gpu !== current?.gpu;
    if (completed.cpuScore === undefined && (cpuChanged || !current)) {
      completed.cpuScore = this.findComponentScore(
        ProductType.CPU,
        completed.cpu ?? current?.cpu,
        'cpuScore',
      );
    }
    if (completed.gpuScore === undefined && (gpuChanged || !current)) {
      completed.gpuScore = this.findComponentScore(
        ProductType.GPU,
        completed.gpu ?? current?.gpu,
        'gpuScore',
      );
    }
    return completed;
  }

  private findComponentScore(
    type: ProductType.CPU | ProductType.GPU,
    hardware: string | null | undefined,
    scoreField: 'cpuScore' | 'gpuScore',
  ) {
    if (!hardware) return undefined;
    const target = this.hardwareKey(hardware);
    const components = this.database
      .all<ProductRow>('SELECT * FROM products WHERE type = ?', type)
      .map((row) => this.mapProduct(row));
    return (
      components.find((component) => {
        const componentHardware =
          type === ProductType.CPU ? component.cpu : component.gpu;
        return (
          componentHardware && this.hardwareKey(componentHardware) === target
        );
      })?.[scoreField] ?? undefined
    );
  }

  private ensurePrebuiltProfile(product: Partial<ProductWriteDto | Product>) {
    if (product.type !== ProductType.PREBUILT_PC) return;
    const required: Array<[keyof Product, string]> = [
      ['cpu', 'procesador'],
      ['gpu', 'tarjeta gráfica'],
      ['ramGb', 'RAM'],
      ['storageGb', 'almacenamiento'],
      ['vramGb', 'VRAM'],
      ['cpuScore', 'puntuación de CPU'],
      ['gpuScore', 'puntuación de GPU'],
      ['upgradeabilityScore', 'puntuación de actualización'],
    ];
    const missing = required
      .filter(
        ([field]) =>
          product[field] === undefined ||
          product[field] === null ||
          product[field] === '',
      )
      .map(([, label]) => label);
    if (missing.length) {
      throw new BadRequestException(
        `Un PC prearmado necesita un perfil técnico evaluable. Faltan: ${missing.join(', ')}.`,
      );
    }
  }

  private hardwareKey(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\b\d+\s*(?:gb|mb)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  }
}
