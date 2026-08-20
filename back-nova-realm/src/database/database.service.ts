import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { PRODUCT_SEEDS, WORKLOAD_SEEDS } from './seed-data';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private database!: DatabaseSync;

  onModuleInit() {
    const databasePath = resolve(
      process.cwd(),
      process.env.DATABASE_PATH ?? './data/novarealm.db',
    );
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.createSchema();
    this.seed();
  }

  onModuleDestroy() {
    this.database?.close();
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.database.prepare(sql).all(...params) as T[];
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.database.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.database.prepare(sql).run(...params);
  }

  private createSchema() {
    this.database.exec(`
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
    `);
  }

  private seed() {
    const productCount = this.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM products',
    )?.count;
    if (!productCount) {
      const insert = this.database.prepare(`
        INSERT INTO products (
          name, slug, description, price, stock, imageUrl, active, type,
          cpu, gpu, ramGb, storageGb, vramGb, cpuScore, gpuScore,
          productivityScore, upgradeabilityScore, features
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const product of PRODUCT_SEEDS) {
        insert.run(
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
        );
      }
    }

    // Inserta nuevos perfiles en instalaciones existentes sin sobrescribir
    // ajustes hechos desde el panel de administración.
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO workloads (
        slug, name, type, description, cpuWeight, gpuWeight, ramWeight,
        storageWeight, vramWeight, minimumCpuScore, recommendedCpuScore,
        minimumGpuScore, recommendedGpuScore, minimumRamGb,
        recommendedRamGb, minimumVramGb, recommendedVramGb
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const workload of WORKLOAD_SEEDS) {
      insert.run(
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
  }
}
