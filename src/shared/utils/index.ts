export const nowIso = (): string => new Date().toISOString();

export const safeJsonParse = <T>(raw: string, fallback: T): T => {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

export const truncate = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max);
