export interface AnalyzeRequestDTO {
  query: string;
  sessionId: string;
  imageData?: string;
  imageMimeType?: string;
}

export interface AnalyzeResponseDTO {
  text: string;
  provider: string;
  model: string;
}

export interface SynthesizeRequestDTO {
  text: string;
  sessionId: string;
  voiceName?: string;
}

export interface SynthesizeResponseDTO {
  audioBase64: string;
  mimeType: string;
  provider: string;
}

export interface IntentMapResponseDTO {
  sessionId: string;
  map: string;
  updatedAt: string | null;
}

export interface IntentMapUpdateRequestDTO {
  newIntent: string;
  sessionId: string;
}
