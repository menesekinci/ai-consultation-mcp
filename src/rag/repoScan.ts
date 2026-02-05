import fs from 'fs';
import path from 'path';
import { chunkText, estimateTokenCount } from './chunking.js';
import { createDocument, insertChunks, insertEmbedding, insertMemory, clearMemoriesBySource } from './storage.js';
import { embedTexts } from './embeddings.js';

interface MemoryNote {
  category: 'architecture' | 'backend' | 'db' | 'auth' | 'config' | 'flow' | 'other';
  title: string;
  content: string;
}

function safeRead(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function findFiles(root: string, patterns: RegExp[], maxFiles = 200): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'build'].includes(entry.name)) continue;
        walk(full);
      } else {
        if (patterns.some((p) => p.test(entry.name))) {
          results.push(full);
        }
      }
    }
  }

  walk(root);
  return results;
}

function extractRoutes(content: string): string[] {
  const routes: string[] = [];
  const regex = /\.(get|post|put|delete|patch)\(['"`]([^'"`]+)['"`]/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(content))) {
    routes.push(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return routes;
}

function extractTables(content: string): string[] {
  const tables: string[] = [];
  const regex = /CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(content))) {
    tables.push(match[1]);
  }
  return tables;
}

function extractAuthHints(content: string): string[] {
  const hints: string[] = [];
  if (/jwt/i.test(content)) hints.push('JWT token handling detected');
  if (/authorization/i.test(content)) hints.push('Authorization header usage detected');
  if (/login/i.test(content)) hints.push('Login flow references detected');
  return hints;
}

export async function runRepoScan(rootDir: string): Promise<{ notes: MemoryNote[]; documentId: string | null }>{
  const notes: MemoryNote[] = [];

  const routeFiles = findFiles(rootDir, [/routes?\.ts$/, /server\.ts$/, /index\.ts$/]);
  const dbFiles = findFiles(rootDir, [/database\.ts$/, /\.sql$/, /schema\.ts$/, /\.prisma$/]);
  const configFiles = findFiles(rootDir, [/config\.ts$/, /defaults\.ts$/, /schema\.ts$/, /README\.md$/]);

  const routeSet = new Set<string>();
  routeFiles.forEach((file) => {
    const content = safeRead(file);
    extractRoutes(content).forEach((route) => routeSet.add(route));
  });
  if (routeSet.size) {
    notes.push({
      category: 'backend',
      title: 'API Routes',
      content: Array.from(routeSet).slice(0, 100).join('\n'),
    });
  }

  const tableSet = new Set<string>();
  dbFiles.forEach((file) => {
    const content = safeRead(file);
    extractTables(content).forEach((table) => tableSet.add(table));
  });
  if (tableSet.size) {
    notes.push({
      category: 'db',
      title: 'Database Tables',
      content: Array.from(tableSet).join(', '),
    });
  }

  let authHints: string[] = [];
  [...routeFiles, ...configFiles].forEach((file) => {
    const content = safeRead(file);
    authHints = authHints.concat(extractAuthHints(content));
  });
  authHints = Array.from(new Set(authHints));
  if (authHints.length) {
    notes.push({
      category: 'auth',
      title: 'Authentication Signals',
      content: authHints.join('\n'),
    });
  }

  const readmePath = path.join(rootDir, 'README.md');
  const readme = safeRead(readmePath).slice(0, 3000);
  if (readme) {
    notes.push({
      category: 'architecture',
      title: 'README Summary',
      content: readme,
    });
  }

  if (!notes.length) {
    return { notes: [], documentId: null };
  }

  clearMemoriesBySource('repo_scan');
  const memoryEntries = notes.map((note) =>
    insertMemory({
      category: note.category,
      title: note.title,
      content: note.content,
      source: 'repo_scan',
    })
  );

  const combinedText = memoryEntries
    .map((m) => `# ${m.title}\n${m.content}`)
    .join('\n\n');

  const doc = createDocument({
    title: 'Repo Scan Summary',
    sourceType: 'repo_scan',
    sourceUri: rootDir,
    mimeType: 'text/plain',
  });

  const chunks = chunkText(combinedText);
  const chunkRecords = insertChunks(
    doc.id,
    chunks.map((content) => ({ content, tokenCount: estimateTokenCount(content) }))
  );

  if (chunkRecords.length) {
    const embeddingResult = await embedTexts(chunkRecords.map((c) => c.content));
    chunkRecords.forEach((chunk, idx) => {
      const vector = embeddingResult.vectors[idx];
      if (vector) {
        insertEmbedding({
          chunkId: chunk.id,
          vector,
          dim: embeddingResult.dim,
          model: embeddingResult.model,
        });
      }
    });
  }

  return { notes, documentId: doc.id };
}
