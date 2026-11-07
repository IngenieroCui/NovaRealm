import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiMessage, AiProvider } from './ai.provider';

interface CloudflareResponse {
  success?: boolean;
  result?: { response?: string | Record<string, unknown> };
  errors?: Array<{ message?: string }>;
}

@Injectable()
export class CloudflareAiProvider implements AiProvider {
  private get accountId() {
    return process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  }

  private get token() {
    return process.env.CLOUDFLARE_AI_TOKEN?.trim();
  }

  private get model() {
    return process.env.CLOUDFLARE_AI_MODEL?.trim();
  }

  async complete(messages: AiMessage[], json = false) {
    if (!this.accountId || !this.token || !this.model) {
      throw new ServiceUnavailableException({ code: 'AI_NOT_CONFIGURED', message: 'Nova no está configurada: define CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN y CLOUDFLARE_AI_MODEL en el backend.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.CLOUDFLARE_AI_TIMEOUT_MS ?? 45000),
    );
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/ai/run/${this.model.split('/').map(encodeURIComponent).join('/')}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages,
            ...(json
              ? { response_format: { type: 'json_object' } }
              : {}),
            temperature: json ? 0.1 : 0.35,
          }),
          signal: controller.signal,
        },
      );
      const data = (await response.json().catch(() => null)) as
        | CloudflareResponse
        | null;
      if (!response.ok || !data?.success) {
        const detail = data?.errors
          ?.map((error) => error.message)
          .filter(Boolean)
          .join(', ');
        throw new Error(
          detail || `Cloudflare AI respondió HTTP ${response.status}`,
        );
      }
      const content = data.result?.response;
      if (typeof content === 'string' && content.trim()) return content.trim();
      if (content && typeof content === 'object') return JSON.stringify(content);
      throw new Error('Cloudflare AI devolvió una respuesta vacía');
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({ code: 'AI_PROVIDER_UNAVAILABLE', message: 'Nova no pudo conectarse con Cloudflare AI. Revisa la configuración y vuelve a intentar.' });
    } finally {
      clearTimeout(timeout);
    }
  }
}
