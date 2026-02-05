import path from 'path';

export function getTitleFromPath(filePath: string): string {
  return path.basename(filePath);
}

export function isDuplicateTitle(existingTitles: string[], title: string): boolean {
  const needle = title.trim().toLowerCase();
  return existingTitles.some((t) => t.trim().toLowerCase() === needle);
}
