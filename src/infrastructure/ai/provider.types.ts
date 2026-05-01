/**
 * Kontrakty warstwy AI.
 * Każdy provider (Gemini, Ollama, OpenAI…) implementuje LLMProvider.
 * Embeddingi i TTS są opcjonalne — provider może je wspierać lub nie.
 */

export interface AnalyzeInput {
  query: string;
  imageData?: string;       // base64 (no data: prefix)
  imageMimeType?: string;
  intentMap?: string;
  ragContext?: string;      // dopisywany kontekst z semantic search
  systemPrompt?: string;
}

export interface AnalyzeOutput {
  text: string;
  provider: string;
  model: string;
}

export interface AnalyzeChunk {
  delta: string;
  done: boolean;
  provider: string;
  model: string;
}

export interface SynthesizeInput {
  text: string;
  voiceName?: string;
}

export interface SynthesizeOutput {
  audioBase64: string;
  mimeType: string;
  provider: string;
}

export interface EmbedInput {
  text: string;
  /** Override modelu na pojedyncze wywołanie (np. mxbai-embed-large dla resolvera). */
  model?: string;
  /** Sugerowana wymiarowość (dla providerów deterministycznych — np. simulated). */
  dimensions?: number;
}

export interface EmbedOutput {
  vector: number[];
  dimensions: number;
  provider: string;
  model: string;
}

/**
 * Batch embed — Sprint X. Provider może zaimplementować dla optymalizacji
 * (Gemini batchEmbedContents → 1 HTTP call dla 100 textów). Fallback w fasadzie:
 * Promise.all(map(embed)) zachowuje semantykę przy braku natywnego batcha.
 */
export interface EmbedBatchInput {
  texts: string[];
  model?: string;
  dimensions?: number;
}

export interface EmbedBatchOutput {
  vectors: number[][];
  dimensions: number;
  provider: string;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
  analyzeStream?(input: AnalyzeInput): AsyncIterable<AnalyzeChunk>;
  synthesize?(input: SynthesizeInput): Promise<SynthesizeOutput>;
  embed?(input: EmbedInput): Promise<EmbedOutput>;
  embedBatch?(input: EmbedBatchInput): Promise<EmbedBatchOutput>;
}

export const DEFAULT_SYSTEM_PROMPT =
  'Jesteś LOGOS V5.3 — bezlitośnie spójny analityk wizji MTAQuestWebsideX. '
+ 'Mów krótko, dosadnie, po polsku. Każda odpowiedź wzmacnia mapę intencji użytkownika. '
+ 'Wykorzystuj dostarczony kontekst (mapa intencji + RAG) jako jedyne źródło prawdy o wizji.';
