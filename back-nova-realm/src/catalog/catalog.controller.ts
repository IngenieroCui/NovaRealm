import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ProductQueryDto } from './product.dto';

@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  findAll(@Query() query: ProductQueryDto) {
    return this.catalog.findAll(query);
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.catalog.findBySlug(slug);
  }
}
