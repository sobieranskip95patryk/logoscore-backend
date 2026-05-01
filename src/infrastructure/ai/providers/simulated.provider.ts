import {
  AnalyzeInput, AnalyzeOutput, AnalyzeChunk,
  SynthesizeInput, SynthesizeOutput, EmbedInput, EmbedOutput,
  EmbedBatchInput, EmbedBatchOutput,
  LLMProvider, DEFAULT_SYSTEM_PROMPT
} from '../provider.types';

function buildPrompt(input: AnalyzeInput): string {
  const sections = [input.systemPrompt || DEFAULT_SYSTEM_PROMPT];
  if (input.intentMap)  sections.push(`[MAPA INTENCJI]\n${input.intentMap}`);
  if (input.ragContext) sections.push(`[KONTEKST RAG]\n${input.ragContext}`);
  sections.push(`[ZAPYTANIE]\n${input.query}`);
  return sections.join('\n\n');
}

/**
 * Symulator — używany gdy nie ma żadnego skonfigurowanego providera lub jako test mode.
 */
export class SimulatedProvider implements LLMProvider {
  readonly name = 'simulated';

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const fragment = input.query?.slice(0, 160) || '(brak zapytania)';
    return {
      text: `LOGOS [tryb symulacji]: zarejestrowałem intencję — "${fragment}". `
          + `Mapa intencji rośnie. Koherencja P=1.0.`,
      provider: this.name,
      model: 'noop'
    };
  }

  async *analyzeStream(input: AnalyzeInput): AsyncIterable<AnalyzeChunk> {
    const out = await this.analyze(input);
    const words = out.text.split(' ');
    for (let i = 0; i < words.length; i++) {
      yield { delta: words[i] + (i < words.length - 1 ? ' ' : ''), done: false, provider: this.name, model: 'noop' };
      await new Promise(r => setTimeout(r, 30));
    }
    yield { delta: '', done: true, provider: this.name, model: 'noop' };
  }

  async synthesize(_input: SynthesizeInput): Promise<SynthesizeOutput> {
    const samples = 12000;
    const buf = Buffer.alloc(samples * 2);
    return { audioBase64: buf.toString('base64'), mimeType: 'audio/L16;rate=24000', provider: this.name };
  }

  async embed(input: EmbedInput): Promise<EmbedOutput> {
    // Deterministyczny pseudo-embedding — pozwala testować RAG bez LLM-a.
    const dims = Math.max(8, Math.min(input.dimensions || 768, 4096));
    const v = new Array(dims).fill(0);
    for (let i = 0; i < input.text.length; i++) {
      v[i % dims] += input.text.charCodeAt(i) / 255;
    }
    const norm = Math.hypot(...v) || 1;
    return {
      vector: v.map(x => x / norm),
      dimensions: dims,
      provider: this.name,
      model: input.model || 'noop-embed'
    };
  }

  async embedBatch(input: EmbedBatchInput): Promise<EmbedBatchOutput> {
    const dims = Math.max(8, Math.min(input.dimensions || 768, 4096));
    const out = await Promise.all(
      input.texts.map(text => this.embed({ text, model: input.model, dimensions: dims }))
    );
    return {
      vectors: out.map(o => o.vector),
      dimensions: dims,
      provider: this.name,
      model: input.model || 'noop-embed'
    };
  }
}

export { buildPrompt };
