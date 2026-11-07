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
    if (!this.model.trim()) throw new ServiceUnavailableException({ code: 'AI_NOT_CONFIGURED', message: 'Nova no está configurada: define OLLAMA_MODEL en el backend.' });
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
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({ code: 'AI_PROVIDER_UNAVAILABLE', message: 'Nova no pudo conectarse con Ollama. Comprueba que Ollama esté activo y vuelve a intentar.' });
    } finally {
      clearTimeout(timeout);
    }
  }
}
