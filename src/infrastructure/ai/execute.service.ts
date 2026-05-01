import { appConfig } from '../../core/config/app.config';
import {
  LLMProvider, AnalyzeInput, AnalyzeOutput, AnalyzeChunk,
  SynthesizeInput, SynthesizeOutput, EmbedInput, EmbedOutput,
  EmbedBatchInput, EmbedBatchOutput
} from './provider.types';
import { GeminiProvider } from './providers/gemini.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { SimulatedProvider } from './providers/simulated.provider';
import { wrapEmbed, wrapEmbedBatch, wrapSynthesize } from './economizer';
import { economizerMetrics } from './economizer/metrics';
import { getTracer } from '../observability/telemetry';

export type {
  AnalyzeInput, AnalyzeOutput, AnalyzeChunk,
  SynthesizeInput, SynthesizeOutput, EmbedInput, EmbedOutput,
  EmbedBatchInput, EmbedBatchOutput
};

/**
 * ExecuteService — fasada warstwy AI.
 * - gemini    : online, multimodalny, TTS, embeddingi (+ batchEmbedContents w Sprint X)
 * - ollama    : local-first, hermetyczny (brak TTS — fallback do simulated, brak natywnego batch)
 * - simulated : deterministyczny (testy + dev bez kluczy)
 *
 * Sprint IX: embed() i synthesize() są owinięte Token Economizerem (LRU + Mongo cache).
 * Sprint X: embedBatch() z dedup-aware batch (LRU/Redis/Mongo lookup → 1 provider call dla miss-ów),
 *           Redis L1 jako warstwa cross-instance między LRU a Mongo.
 * analyze() zostaje pure pass-through (kontekst dynamiczny).
 */
export class ExecuteService {
  private analyzer: LLMProvider;
  private synthesizer: LLMProvider;
  private embedder: LLMProvider;
  private cachedEmbed: (input: EmbedInput) => Promise<EmbedOutput>;
  private cachedEmbedBatch: (input: EmbedBatchInput) => Promise<EmbedBatchOutput>;
  private cachedSynth: (input: SynthesizeInput) => Promise<SynthesizeOutput>;

  constructor() {
    const sim = new SimulatedProvider();
    const provider = this.pickPrimary();

    this.analyzer    = provider;
    this.synthesizer = provider.synthesize ? provider : sim;
    this.embedder    = provider.embed      ? provider : sim;

    this.cachedEmbed = wrapEmbed((input) => this.embedder.embed!(input));
    this.cachedEmbedBatch = wrapEmbedBatch((input) => this.callBatchEmbed(input));
    this.cachedSynth = wrapSynthesize((input) => this.synthesizer.synthesize!(input));
  }

  primaryProviderName(): string { return this.analyzer.name; }

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const t0 = Date.now();
    try {
      return await getTracer().withSpan('ai.analyze', () => this.analyzer.analyze(input), {
        'ai.provider': this.analyzer.name
      });
    } finally {
      economizerMetrics.observeAnalyze(Date.now() - t0);
    }
  }

  async *analyzeStream(input: AnalyzeInput): AsyncIterable<AnalyzeChunk> {
    if (this.analyzer.analyzeStream) {
      yield* this.analyzer.analyzeStream(input);
      return;
    }
    const out = await this.analyzer.analyze(input);
    yield { delta: out.text, done: false, provider: out.provider, model: out.model };
    yield { delta: '', done: true, provider: out.provider, model: out.model };
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {
    return getTracer().withSpan('ai.synthesize', () => this.cachedSynth(input), {
      'ai.provider': this.synthesizer.name,
      'ai.text_length': input.text.length
    });
  }

  async embed(input: EmbedInput): Promise<EmbedOutput> {
    return getTracer().withSpan('ai.embed', () => this.cachedEmbed(input), {
      'ai.provider': this.embedder.name,
      'ai.text_length': input.text.length
    });
  }

  async embedBatch(input: EmbedBatchInput): Promise<EmbedBatchOutput> {
    return getTracer().withSpan('ai.embedBatch', async () => {
      if (!appConfig.economizer.batchEnabled) {
        return this.fallbackBatch(input);
      }
      const max = appConfig.economizer.batchMaxSize;
      if (input.texts.length <= max) return this.cachedEmbedBatch(input);

      const chunks: EmbedBatchOutput[] = [];
      for (let i = 0; i < input.texts.length; i += max) {
        const slice = input.texts.slice(i, i + max);
        chunks.push(await this.cachedEmbedBatch({ ...input, texts: slice }));
      }
      return {
        vectors: chunks.flatMap(c => c.vectors),
        dimensions: chunks[0]?.dimensions ?? 0,
        provider: chunks[0]?.provider ?? 'cache',
        model: chunks[0]?.model ?? (input.model || appConfig.ai.modelEmbed)
      };
    }, {
      'ai.provider': this.embedder.name,
      'ai.batch_size': input.texts.length
    });
  }

  /**
   * Wywołuje natywny embedBatch providera, jeśli istnieje. W przeciwnym razie
   * leci Promise.all(map(embed)) — gwarantuje semantykę dla Ollamy/Simulated bez batch.
   */
  private async callBatchEmbed(input: EmbedBatchInput): Promise<EmbedBatchOutput> {
    if (this.embedder.embedBatch) {
      return this.embedder.embedBatch(input);
    }
    return this.fallbackBatch(input);
  }

  private async fallbackBatch(input: EmbedBatchInput): Promise<EmbedBatchOutput> {
    const out = await Promise.all(
      input.texts.map(text => this.embedder.embed!({ text, model: input.model, dimensions: input.dimensions }))
    );
    return {
      vectors: out.map(o => o.vector),
      dimensions: out[0]?.dimensions ?? 0,
      provider: out[0]?.provider ?? this.embedder.name,
      model: out[0]?.model ?? (input.model || appConfig.ai.modelEmbed)
    };
  }

  private pickPrimary(): LLMProvider {
    const explicit = appConfig.ai.provider;
    if (explicit === 'ollama')                return new OllamaProvider();
    if (explicit === 'gemini' && appConfig.ai.apiKey) return new GeminiProvider();
    return new SimulatedProvider();
  }
}

export const executeService = new ExecuteService();
