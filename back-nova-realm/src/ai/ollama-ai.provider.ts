import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiMessage, AiProvider } from './ai.provider';

interface OllamaResponse {
  message?: { content?: string };
}

@Injectable()
export class OllamaAiProvider implements AiProvider {
  private get baseUrl() {
    return (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(
      /\/$/,
      '',
    );
  }

  private get model() {
    return process.env.OLLAMA_MODEL ?? 'qwen3.5:4b';
  }

  async complete(messages: AiMessage[], json = false) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.OLLAMA_TIMEOUT_MS ?? 45000),
    );
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          think: false,
          ...(json ? { format: 'json' } : {}),
          options: { temperature: json ? 0.1 : 0.35 },
        }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`Ollama respondió HTTP ${response.status}`);
      const data = (await response.json()) as OllamaResponse;
      const content = data.message?.content?.trim();
      if (!content) throw new Error('Ollama devolvió una respuesta vacía');
      return content;
    } catch {
      throw new ServiceUnavailableException('Nova no está disponible en este momento.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
