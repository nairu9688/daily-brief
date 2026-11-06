import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Brief, Edition, Lang } from '@daily-brief/schema';

export const repoPath = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

export const WHITELIST_PATH = repoPath('pipeline/config/whitelist.json');
export const PROGRAMME_PATH = repoPath('pipeline/editorial/programme-ect.md');

export function fixtureBrief(): Brief {
  return JSON.parse(readFileSync(repoPath('fixtures/brief-2026-11-06.json'), 'utf8'));
}

export function fixtureEdition(lang: Lang): Edition {
  return structuredClone(fixtureBrief().editions.find((e) => e.lang === lang)!);
}

export function sourceText(file: string): string {
  return readFileSync(repoPath(`fixtures/sources/${file}`), 'utf8');
}

/** Articles `{ url, text }` construits à partir de fixtures/sources/index.json. */
export function fixtureArticles(): { url: string; text: string }[] {
  const index: { url: string; file: string }[] = JSON.parse(readFileSync(repoPath('fixtures/sources/index.json'), 'utf8'));
  return index.map((e) => ({ url: e.url, text: sourceText(e.file) }));
}
