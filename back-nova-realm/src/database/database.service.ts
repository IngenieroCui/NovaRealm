import { createClient, type Client, type InValue } from '@libsql/client';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { resolve } from 'node:path';
import {
  imageForProductType,
  PRODUCT_SEEDS,
  WORKLOAD_SEEDS,
} from './seed-data';

const CURRENT_SEED_PROFILE_VERSION = 3;

export interface RunResult {
  lastInsertRowid?: bigint;
  rowsAffected: number;
}

@Injectable()
export class DatabaseService implements OnModuleInit {
  private database!: Client;

  async onModuleInit() {
    this.database = createClient({
      url: this.databaseUrl,
      ...(process.env.DATABASE_AUTH_TOKEN?.trim()
        ? { authToken: process.env.DATABASE_AUTH_TOKEN.trim() }
        : {}),
    });
    await this.createSchema();
    await this.seed();
  }

  async all<T>(sql: string, ...params: InValue[]): Promise<T[]> {
    const result = await this.database.execute({ sql, args: params });
    return result.rows as unknown as T[];
  }

  async get<T>(sql: string, ...params: InValue[]): Promise<T | undefined> {
    const result = await this.all<T>(sql, ...params);
    return result[0];
  }

  async run(sql: string, ...params: InValue[]): Promise<RunResult> {
    const result = await this.database.execute({ sql, args: params });
    return {
      lastInsertRowid: result.lastInsertRowid,
      rowsAffected: result.rowsAffected,
    };
  }

  private get databaseUrl() {
    const configuredUrl = process.env.DATABASE_URL?.trim();
    if (configuredUrl) return configuredUrl;
    if (process.env.VERCEL) {
      throw new Error('DATABASE_URL es obligatoria al desplegar en Vercel.');
    }
    const databasePath = resolve(
      process.cwd(),
      process.env.DATABASE_PATH ?? './data/novarealm.db',
    );
    return `file:${databasePath.replace(/\\/g, '/')}`;
  }

  private async createSchema() {
    await this.database.executeMultiple(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        price INTEGER NOT NULL CHECK(price >= 0),
        stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
        imageUrl TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        type TEXT NOT NULL,
        cpu TEXT,
        gpu TEXT,
        ramGb INTEGER,
        storageGb INTEGER,
        vramGb INTEGER,
        cpuScore REAL,
        gpuScore REAL,
        productivityScore REAL,
        upgradeabilityScore REAL,
        features TEXT NOT NULL DEFAULT '[]',
        technicalSpecs TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        cpuWeight REAL NOT NULL,
        gpuWeight REAL NOT NULL,
        ramWeight REAL NOT NULL,
        storageWeight REAL NOT NULL,
        vramWeight REAL NOT NULL,
        minimumCpuScore REAL NOT NULL,
        recommendedCpuScore REAL NOT NULL,
        minimumGpuScore REAL NOT NULL,
        recommendedGpuScore REAL NOT NULL,
        minimumRamGb INTEGER NOT NULL,
        recommendedRamGb INTEGER NOT NULL,
        minimumVramGb INTEGER NOT NULL,
        recommendedVramGb INTEGER NOT NULL,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS store_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const columns = await this.database.execute({
      sql: 'PRAGMA table_info(products)',
      args: [],
    });
    if (!columns.rows.some((row) => String(row.name) === 'technicalSpecs')) {
      await this.database.execute(
        "ALTER TABLE products ADD COLUMN technicalSpecs TEXT NOT NULL DEFAULT '{}'",
      );
    }
  }

  private async seed() {
    const productCount = await this.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM products',
    );
    const seedProfileVersion = await this.get<{ value: string }>(
      'SELECT value FROM store_settings WHERE key = ?',
      'seed_profile_version',
    );
    const needsProfileSync = Number(seedProfileVersion?.value ?? 0) < CURRENT_SEED_PROFILE_VERSION;
    if (!productCount?.count) {
      for (const product of PRODUCT_SEEDS) {
        await this.run(
          `INSERT INTO products (
            name, slug, description, price, stock, imageUrl, active, type,
            cpu, gpu, ramGb, storageGb, vramGb, cpuScore, gpuScore,
            productivityScore, upgradeabilityScore, features, technicalSpecs
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          product.name,
          product.slug,
          product.description,
          product.price,
          product.stock,
          product.imageUrl,
          product.active ? 1 : 0,
          product.type,
          product.cpu ?? null,
          product.gpu ?? null,
          product.ramGb ?? null,
          product.storageGb ?? null,
          product.vramGb ?? null,
          product.cpuScore ?? null,
          product.gpuScore ?? null,
          product.productivityScore ?? null,
          product.upgradeabilityScore ?? null,
          JSON.stringify(product.features ?? []),
          JSON.stringify(product.technicalSpecs ?? {}),
        );
        if (needsProfileSync) await this.syncSeedProfile(product);
      }
    }

    // Add new demo inventory to existing databases without duplicating products.
    if (productCount?.count) {
      for (const product of PRODUCT_SEEDS) {
        await this.run(
          `INSERT OR IGNORE INTO products (
            name, slug, description, price, stock, imageUrl, active, type,
            cpu, gpu, ramGb, storageGb, vramGb, cpuScore, gpuScore,
            productivityScore, upgradeabilityScore, features, technicalSpecs
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          product.name,
          product.slug,
          product.description,
          product.price,
          product.stock,
          product.imageUrl,
          product.active ? 1 : 0,
          product.type,
          product.cpu ?? null,
          product.gpu ?? null,
          product.ramGb ?? null,
          product.storageGb ?? null,
          product.vramGb ?? null,
          product.cpuScore ?? null,
          product.gpuScore ?? null,
          product.productivityScore ?? null,
          product.upgradeabilityScore ?? null,
          JSON.stringify(product.features ?? []),
          JSON.stringify(product.technicalSpecs ?? {}),
        );
        if (needsProfileSync) await this.syncSeedProfile(product);
      }
    }

    await this.run(
      `INSERT OR IGNORE INTO store_settings (key, value) VALUES ('assemblyEnabled', 'true'), ('assemblyPrice', '150000')`,
    );

    for (const workload of WORKLOAD_SEEDS) {
      await this.run(
        `INSERT OR IGNORE INTO workloads (
          slug, name, type, description, cpuWeight, gpuWeight, ramWeight,
          storageWeight, vramWeight, minimumCpuScore, recommendedCpuScore,
          minimumGpuScore, recommendedGpuScore, minimumRamGb,
          recommendedRamGb, minimumVramGb, recommendedVramGb
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        workload.slug,
        workload.name,
        workload.type,
        workload.description,
        workload.cpuWeight,
        workload.gpuWeight,
        workload.ramWeight,
        workload.storageWeight,
        workload.vramWeight,
        workload.minimumCpuScore,
        workload.recommendedCpuScore,
        workload.minimumGpuScore,
        workload.recommendedGpuScore,
        workload.minimumRamGb,
        workload.recommendedRamGb,
        workload.minimumVramGb,
        workload.recommendedVramGb,
      );
    }
    if (needsProfileSync) {
      await this.run(
        `INSERT OR REPLACE INTO store_settings (key, value) VALUES (?, ?)`,
        'seed_profile_version',
        String(CURRENT_SEED_PROFILE_VERSION),
      );
    }
  }

  private async syncSeedProfile(product: (typeof PRODUCT_SEEDS)[number]) {
    if (product.type === 'PREBUILT_PC') return;
    const existing = await this.get<{
      description: string;
      imageUrl: string;
      technicalSpecs: string | Record<string, unknown> | null;
    }>(
      'SELECT description, imageUrl, technicalSpecs FROM products WHERE slug = ?',
      product.slug,
    );
    if (!existing) return;

    let existingTechnicalSpecs: Record<string, unknown> = {};
    try {
      const parsed =
        typeof existing.technicalSpecs === 'string'
          ? (JSON.parse(existing.technicalSpecs || '{}') as unknown)
          : existing.technicalSpecs;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existingTechnicalSpecs = parsed as Record<string, unknown>;
      }
    } catch {
      // A malformed legacy value must not prevent the rest of the seed profile from syncing.
    }

    const mergedTechnicalSpecs = {
      ...(product.technicalSpecs ?? {}),
      ...existingTechnicalSpecs,
    };
    const updates = [
      'cpu = COALESCE(cpu, ?)',
      'gpu = COALESCE(gpu, ?)',
      'ramGb = COALESCE(ramGb, ?)',
      'storageGb = COALESCE(storageGb, ?)',
      'vramGb = COALESCE(vramGb, ?)',
      'technicalSpecs = ?',
    ];
    const params: InValue[] = [
      product.cpu ?? null,
      product.gpu ?? null,
      product.ramGb ?? null,
      product.storageGb ?? null,
      product.vramGb ?? null,
      JSON.stringify(mergedTechnicalSpecs),
    ];

    const oldDescriptionMarkers = [
      'Producto para el catálogo administrable de NovaRealm',
      'Periférico demo para complementar',
    ];
    if (
      oldDescriptionMarkers.some((marker) =>
        existing.description.includes(marker),
      )
    ) {
      updates.push('description = ?');
      params.push(product.description);
    }

    const oldImageMarkers = new Set([
      '/products/component.svg',
      '/products/component-placeholder.svg',
      '/products/product-placeholder.svg',
    ]);
    if (oldImageMarkers.has(existing.imageUrl)) {
      updates.push('imageUrl = ?');
      params.push(imageForProductType(product.type));
    }

    params.push(product.slug);
    await this.run(
      `UPDATE products SET ${updates.join(', ')} WHERE slug = ?`,
      ...params,
    );
  }
}
