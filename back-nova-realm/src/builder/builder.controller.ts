import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AssemblySettingsDto, AutoBuildRequestDto, BuilderActionDto, BuilderRequestDto, ComponentRecommendationRequestDto, UpgradePcDto } from './builder.dto';
import { BuilderService } from './builder.service';

@Controller('builder')
export class BuilderController {
  constructor(private readonly builder: BuilderService) {}
  @Get('settings') settings() { return this.builder.settings(); }
  @Post('recommend') recommend(@Body() input: ComponentRecommendationRequestDto) { return this.builder.recommendComponents(input); }
  @Post('summary') summary(@Body() input: BuilderRequestDto) { return this.builder.summarize(input); }
  @Post('autobuild') autoBuild(@Body() input: AutoBuildRequestDto) { return this.builder.autoBuild(input); }
  @Post('action') action(@Body() input: BuilderActionDto) { return this.builder.applyAction(input); }
  @Post('upgrade') upgrade(@Body() input: UpgradePcDto) { return this.builder.analyzeUpgrade(input); }
  @Patch('settings') @UseGuards(AdminGuard) updateSettings(@Body() input: AssemblySettingsDto) { return this.builder.updateSettings(input); }
}
