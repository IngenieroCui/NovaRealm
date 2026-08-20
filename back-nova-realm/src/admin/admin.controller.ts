import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { ProductWriteDto } from '../catalog/product.dto';
import { WorkloadWriteDto } from '../workloads/workload.dto';
import { WorkloadsService } from '../workloads/workloads.service';
import { AdminGuard } from './admin.guard';
import { CloudinaryService } from './cloudinary.service';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly workloads: WorkloadsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Post('media/cloudinary-signature')
  cloudinaryUploadSignature() {
    return this.cloudinary.createUploadSignature();
  }

  @Get('products')
  products() {
    return this.catalog.findAll({}, true);
  }

  @Post('products')
  createProduct(@Body() input: ProductWriteDto) {
    return this.catalog.create(input);
  }

  @Patch('products/:id')
  updateProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body() input: ProductWriteDto,
  ) {
    return this.catalog.update(id, input);
  }

  @Get('workloads')
  workloadList() {
    return this.workloads.findAll();
  }

  @Post('workloads')
  createWorkload(@Body() input: WorkloadWriteDto) {
    return this.workloads.create(input);
  }

  @Patch('workloads/:id')
  updateWorkload(
    @Param('id', ParseIntPipe) id: number,
    @Body() input: WorkloadWriteDto,
  ) {
    return this.workloads.update(id, input);
  }
}
