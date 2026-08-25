import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { WorkloadWriteDto } from './workload.dto';
import { Workload } from './workload.types';

@Injectable()
export class WorkloadsService {
  constructor(private readonly database: DatabaseService) {}

  async findAll(): Promise<Workload[]> {
    return this.database.all<Workload>(
      'SELECT * FROM workloads ORDER BY type, name COLLATE NOCASE',
    );
  }

  async findBySlug(slug: string): Promise<Workload> {
    const workload = await this.database.get<Workload>(
      'SELECT * FROM workloads WHERE slug = ?',
      slug,
    );
    if (!workload)
      throw new NotFoundException(`No existe el workload "${slug}"`);
    return workload;
  }

  async findBySlugs(slugs: string[]): Promise<Workload[]> {
    return Promise.all(slugs.map((slug) => this.findBySlug(slug)));
  }

  async create(input: WorkloadWriteDto): Promise<Workload> {
    const required = [
      'slug',
      'name',
      'type',
      'description',
      'cpuWeight',
      'gpuWeight',
      'ramWeight',
      'storageWeight',
      'vramWeight',
      'minimumCpuScore',
      'recommendedCpuScore',
      'minimumGpuScore',
      'recommendedGpuScore',
      'minimumRamGb',
      'recommendedRamGb',
      'minimumVramGb',
      'recommendedVramGb',
    ] as const;
    if (required.some((field) => input[field] === undefined)) {
      throw new BadRequestException('Faltan campos obligatorios del workload');
    }
    await this.ensureWeights(input);
    await this.ensureRequirements(input);
    try {
      const values = required.map((field) => input[field] as string | number);
      const result = await this.database.run(
        `INSERT INTO workloads (${required.join(', ')}) VALUES (${required.map(() => '?').join(', ')})`,
        ...values,
      );
      return this.findById(Number(result.lastInsertRowid));
    } catch (error) {
      throw new BadRequestException(
        `No se pudo crear el workload: ${(error as Error).message}`,
      );
    }
  }

  async update(id: number, input: WorkloadWriteDto): Promise<Workload> {
    await this.findById(id);
    await this.ensureWeights(input, id);
    await this.ensureRequirements(input, id);
    const allowed = Object.keys(input);
    if (!allowed.length) return this.findById(id);
    try {
      await this.database.run(
        `UPDATE workloads SET ${allowed.map((key) => `${key} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        ...allowed.map(
          (key) => input[key as keyof WorkloadWriteDto] as string | number,
        ),
        id,
      );
      return this.findById(id);
    } catch (error) {
      throw new BadRequestException(
        `No se pudo actualizar el workload: ${(error as Error).message}`,
      );
    }
  }

  private async findById(id: number): Promise<Workload> {
    const workload = await this.database.get<Workload>(
      'SELECT * FROM workloads WHERE id = ?',
      id,
    );
    if (!workload) throw new NotFoundException('Workload no encontrado');
    return workload;
  }

  private async ensureWeights(input: WorkloadWriteDto, id?: number) {
    const current = id ? await this.findById(id) : undefined;
    const sum =
      (input.cpuWeight ?? current?.cpuWeight ?? 0) +
      (input.gpuWeight ?? current?.gpuWeight ?? 0) +
      (input.ramWeight ?? current?.ramWeight ?? 0) +
      (input.storageWeight ?? current?.storageWeight ?? 0) +
      (input.vramWeight ?? current?.vramWeight ?? 0);
    if (Math.abs(sum - 1) > 0.011) {
      throw new BadRequestException(
        'Los pesos CPU, GPU, RAM, storage y VRAM deben sumar 1',
      );
    }
  }

  private async ensureRequirements(input: WorkloadWriteDto, id?: number) {
    const current = id ? await this.findById(id) : undefined;
    const pairs: Array<[number, number, string]> = [
      [
        input.minimumCpuScore ?? current?.minimumCpuScore ?? 0,
        input.recommendedCpuScore ?? current?.recommendedCpuScore ?? 0,
        'CPU',
      ],
      [
        input.minimumGpuScore ?? current?.minimumGpuScore ?? 0,
        input.recommendedGpuScore ?? current?.recommendedGpuScore ?? 0,
        'GPU',
      ],
      [
        input.minimumRamGb ?? current?.minimumRamGb ?? 0,
        input.recommendedRamGb ?? current?.recommendedRamGb ?? 0,
        'RAM',
      ],
      [
        input.minimumVramGb ?? current?.minimumVramGb ?? 0,
        input.recommendedVramGb ?? current?.recommendedVramGb ?? 0,
        'VRAM',
      ],
    ];
    const invalid = pairs.find(
      ([minimum, recommended]) => recommended < minimum,
    );
    if (invalid) {
      throw new BadRequestException(
        `El valor recomendado de ${invalid[2]} no puede ser menor que el mínimo.`,
      );
    }
  }
}
