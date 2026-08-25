import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { CloudflareAiProvider } from './cloudflare-ai.provider';
import { OllamaAiProvider } from './ollama-ai.provider';

@Module({
  providers: [AiService, OllamaAiProvider, CloudflareAiProvider],
  exports: [AiService],
})
export class AiModule {}
