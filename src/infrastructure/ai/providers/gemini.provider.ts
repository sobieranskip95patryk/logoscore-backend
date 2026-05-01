import { appConfig } from '../../../core/config/app.config';
import {
  LLMProvider, AnalyzeInput, AnalyzeOutput, AnalyzeChunk,
  SynthesizeInput, SynthesizeOutput, EmbedInput, EmbedOutput,
  EmbedBatchInput, EmbedBatchOutput
} from '../provider.types';
import { buildPrompt } from './simulated.provider';

/**
 * Adapter Google Gemini (REST).
 * Wspiera: analyze (multimodal), analyzeStream (streamGenerateContent),
 * synthesize (TTS preview), embed (text-embedding-004).
 */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';

  private get apiKey() { return appConfig.ai.apiKey; }

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${appConfig.ai.modelAnalyze}:generateContent?key=${this.apiKey}`;
    const body = this.buildBody(input);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`[gemini] analyze ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n')
              || '(LOGOS milczy)';
    return { text, provider: this.name, model: appConfig.ai.modelAnalyze };
  }

  async *analyzeStream(input: AnalyzeInput): AsyncIterable<AnalyzeChunk> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${appConfig.ai.modelAnalyze}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    const body = this.buildBody(input);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok || !res.body) throw new Error(`[gemini] stream ${res.status}: ${await res.text().catch(() => '')}`);

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
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        try {
          const parsed = JSON.parse(json);
          const delta: string = parsed?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') ?? '';
          if (delta) yield { delta, done: false, provider: this.name, model: appConfig.ai.modelAnalyze };
        } catch { /* skip malformed chunk */ }
      }
    }
    yield { delta: '', done: true, provider: this.name, model: appConfig.ai.modelAnalyze };
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${appConfig.ai.modelTts}:generateContent?key=${this.apiKey}`;
    const voiceName = input.voiceName || 'Fenrir';
    const body = {
      contents: [{ role: 'user', parts: [{ text: input.text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
      }
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`[gemini] tts ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    const audioBase64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioBase64) throw new Error('[gemini] no audio payload returned');
    return { audioBase64, mimeType: 'audio/L16;rate=24000', provider: this.name };
  }

  async embed(input: EmbedInput): Promise<EmbedOutput> {
    const model = appConfig.ai.modelEmbed;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${this.apiKey}`;
    const body = { content: { parts: [{ text: input.text }] } };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`[gemini] embed ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    const vector: number[] = data?.embedding?.values || [];
    return { vector, dimensions: vector.length, provider: this.name, model };
  }

  /**
   * Sprint X: batchEmbedContents — 1 HTTP call dla N textów.
   * Gemini przyjmuje requests jako tablicę embedContent payloadów; odpowiada
   * tablicą `embeddings` o tej samej długości.
   */
  async embedBatch(input: EmbedBatchInput): Promise<EmbedBatchOutput> {
    const model = input.model || appConfig.ai.modelEmbed;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${this.apiKey}`;
    const body = {
      requests: input.texts.map(text => ({
        model: `models/${model}`,
        content: { parts: [{ text }] }
      }))
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`[gemini] batchEmbed ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    const vectors: number[][] = (data?.embeddings || []).map((e: any) => e?.values || []);
    if (vectors.length !== input.texts.length) {
      throw new Error(`[gemini] batchEmbed length mismatch: got ${vectors.length}, expected ${input.texts.length}`);
    }
    return {
      vectors,
      dimensions: vectors[0]?.length ?? 0,
      provider: this.name,
      model
    };
  }

  private buildBody(input: AnalyzeInput): any {
    const parts: any[] = [{ text: buildPrompt(input) }];
    if (input.imageData && input.imageMimeType) {
      parts.push({ inline_data: { mime_type: input.imageMimeType, data: input.imageData } });
    }
    return { contents: [{ role: 'user', parts }] };
  }
}
