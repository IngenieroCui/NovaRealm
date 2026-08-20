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

  findAll(): Workload[] {
    return this.database.all<Workload>(
      'SELECT * FROM workloads ORDER BY type, name COLLATE NOCASE',
    );
  }

  findBySlug(slug: string): Workload {
    const workload = this.database.get<Workload>(
      'SELECT * FROM workloads WHERE slug = ?',
      slug,
    );
    if (!workload)
      throw new NotFoundException(`No existe el workload "${slug}"`);
    return workload;
  }

  findBySlugs(slugs: string[]): Workload[] {
    return slugs.map((slug) => this.findBySlug(slug));
  }

  create(input: WorkloadWriteDto): Workload {
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
    this.ensureWeights(input);
    this.ensureRequirements(input);
    try {
      const values = required.map((field) => input[field] as string | number);
      const result = this.database.run(
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

  update(id: number, input: WorkloadWriteDto): Workload {
    this.findById(id);
    this.ensureWeights(input, id);
    this.ensureRequirements(input, id);
    const allowed = Object.keys(input);
    if (!allowed.length) return this.findById(id);
    try {
      this.database.run(
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

  private findById(id: number): Workload {
    const workload = this.database.get<Workload>(
      'SELECT * FROM workloads WHERE id = ?',
      id,
    );
    if (!workload) throw new NotFoundException('Workload no encontrado');
    return workload;
  }

  private ensureWeights(input: WorkloadWriteDto, id?: number) {
    const current = id ? this.findById(id) : undefined;
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

  private ensureRequirements(input: WorkloadWriteDto, id?: number) {
    const current = id ? this.findById(id) : undefined;
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
