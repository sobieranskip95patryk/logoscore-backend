import { appConfig } from '../../../core/config/app.config';
import {
  LLMProvider, AnalyzeInput, AnalyzeOutput, AnalyzeChunk,
  EmbedInput, EmbedOutput
} from '../provider.types';
import { buildPrompt } from './simulated.provider';

/**
 * Adapter Ollama (local-first, hermetyczny).
 * Wspiera: analyze, analyzeStream, embed.
 * TTS pomijamy — Ollama nie ma natywnego TTS.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  private get baseUrl() { return appConfig.ai.ollamaUrl.replace(/\/$/, ''); }
  private get model()   { return appConfig.ai.ollamaModel; }

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: buildPrompt(input),
        images: input.imageData ? [input.imageData] : undefined,
        stream: false
      })
    });
    if (!res.ok) throw new Error(`[ollama] analyze ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    return { text: data?.response || '(LOGOS milczy)', provider: this.name, model: this.model };
  }

  async *analyzeStream(input: AnalyzeInput): AsyncIterable<AnalyzeChunk> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: buildPrompt(input),
        images: input.imageData ? [input.imageData] : undefined,
        stream: true
      })
    });
    if (!res.ok || !res.body) throw new Error(`[ollama] stream ${res.status}`);

    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            yield { delta: parsed.response, done: false, provider: this.name, model: this.model };
          }
          if (parsed.done) {
            yield { delta: '', done: true, provider: this.name, model: this.model };
            return;
          }
        } catch { /* skip */ }
      }
    }
    yield { delta: '', done: true, provider: this.name, model: this.model };
  }

  async embed(input: EmbedInput): Promise<EmbedOutput> {
    const model = input.model || appConfig.ai.ollamaEmbedModel;
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: input.text })
    });
    if (!res.ok) throw new Error(`[ollama] embed ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    const vector: number[] = data?.embedding || [];
    return { vector, dimensions: vector.length, provider: this.name, model };
  }
}
