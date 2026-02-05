export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

export function chunkText(input: string, options: ChunkOptions = {}): string[] {
  const chunkSize = options.chunkSize ?? 1000;
  const overlap = options.overlap ?? 150;
  const text = input.replace(/\s+/g, ' ').trim();

  if (!text) return [];
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start + Math.floor(chunkSize * 0.6)) {
        end = lastSpace;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= text.length) break;

    start = Math.max(0, end - overlap);
  }

  return chunks;
}

export function estimateTokenCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return Math.max(1, Math.ceil(words.length * 1.3));
}
