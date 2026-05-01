import { marked } from 'marked';

/**
 * Parsery zasilające inhalację dokumentów do LOGOSa.
 * Każdy parser zwraca czysty tekst gotowy do wektoryzacji / promptu.
 */

export interface ParsedDocument {
  text: string;
  format: 'pdf' | 'markdown' | 'plain';
  bytes: number;
  meta?: Record<string, unknown>;
}

/**
 * Markdown → plain text. Strip składni (kod, linki, nagłówki).
 */
export function parseMarkdown(raw: string): ParsedDocument {
  const tokens = marked.lexer(raw);
  const out: string[] = [];
  const walk = (toks: any[]) => {
    for (const t of toks) {
      if (t.type === 'code')      { out.push(t.text); continue; }
      if (t.type === 'heading')   { out.push(t.text); continue; }
      if (t.type === 'paragraph') { out.push(t.text); continue; }
      if (t.type === 'list')      { for (const it of t.items) walk(it.tokens || []); continue; }
      if (t.type === 'text')      { out.push(t.text); continue; }
      if (t.type === 'blockquote'){ walk(t.tokens || []); continue; }
      if (t.tokens)               { walk(t.tokens); }
    }
  };
  walk(tokens as any[]);
  const text = out.join('\n').trim();
  return { text, format: 'markdown', bytes: Buffer.byteLength(raw, 'utf8') };
}

/**
 * PDF → tekst. Lazy require, żeby pdf-parse nie ładowało się przy starcie.
 */
export async function parsePdf(buf: Buffer): Promise<ParsedDocument> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buf);
  return {
    text: (data.text || '').trim(),
    format: 'pdf',
    bytes: buf.length,
    meta: { pages: data.numpages, info: data.info }
  };
}

/**
 * Auto-detekcja po MIME / nazwie pliku.
 */
export async function parseDocument(
  raw: string | Buffer,
  hint?: { mimeType?: string; filename?: string }
): Promise<ParsedDocument> {
  const mime = hint?.mimeType || '';
  const name = (hint?.filename || '').toLowerCase();

  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    const buf = typeof raw === 'string' ? Buffer.from(raw, 'base64') : raw;
    return parsePdf(buf);
  }
  if (mime.includes('markdown') || name.endsWith('.md') || name.endsWith('.markdown')) {
    return parseMarkdown(typeof raw === 'string' ? raw : raw.toString('utf8'));
  }
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  return { text, format: 'plain', bytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * Naiwny chunker — dzieli tekst na fragmenty po N znakach z overlapem.
 * Wystarczające dla pierwszej iteracji RAG.
 */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return chunks;
}
