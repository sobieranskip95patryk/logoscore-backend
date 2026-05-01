/**
 * Correlation — wynik korelacji akcji z celami.
 * Akcja (zapytanie / fragment intencji / quest action) jest osadzana w przestrzeni
 * wektorowej i porównywana z embeddingami celów (cosine). Wynik jest deterministyczny
 * względem (action, goal, modelEmbed).
 */

export interface CorrelationMatch {
  goalId: string;
  title: string;
  score: number;          // cosine similarity 0..1
  weight: number;         // priorytet celu
  reason: string;         // opis interpretacyjny
}

export interface CorrelationResult {
  uid: string;
  sessionId?: string | null;
  actionRef: string;
  actionText: string;
  computedAt: string;
  embeddingModel: string;
  embeddingDim: number;
  topK: number;
  minScore: number;
  /** 'positive' = standard align, 'negative' = anti-cel (fail loop) — score zapisywany ze znakiem ujemnym. */
  polarity: 'positive' | 'negative';
  matches: CorrelationMatch[];
  /** Dominujący cel (najwyższy |score| * weight). Może być null jeśli brak progowych dopasowań. */
  dominant: CorrelationMatch | null;
}

/** Cosine similarity dla wektorów o tej samej długości. Zwraca 0 jeśli różne wymiary. */
export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
