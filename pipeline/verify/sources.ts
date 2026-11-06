import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RawCollectionSchema } from '@daily-brief/schema';
import { normalizeUrl } from '../lib/url';

/** Textes lus du jour, indexés par URL : articles en texte intégral (R1) et newsletters. */
export interface SourceTexts {
  textFor(url: string): string | undefined;
  /** Vrai si l'URL est citée dans une newsletter du jour : son texte compte alors comme lu (R1). */
  inNewsletter(url: string): boolean;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>()\[\]"']+/g;

function safeNormalize(url: string): string | null {
  try {
    return normalizeUrl(url.replace(/[.,;:]+$/, ''));
  } catch {
    return null;
  }
}

export function buildSourceTexts(articles: { url: string; text: string | null }[], newsletters: string[]): SourceTexts {
  const byUrl = new Map<string, string[]>();
  const add = (url: string | null, text: string) => {
    if (!url) return;
    byUrl.set(url, [...(byUrl.get(url) ?? []), text]);
  };
  for (const a of articles) if (a.text) add(safeNormalize(a.url), a.text);
  const newsletterUrls = new Set<string>();
  for (const nl of newsletters) {
    for (const m of nl.matchAll(URL_IN_TEXT)) {
      const u = safeNormalize(m[0]);
      if (u && !newsletterUrls.has(u)) {
        newsletterUrls.add(u);
        add(u, nl);
      }
    }
  }
  return {
    textFor: (url) => {
      const texts = byUrl.get(safeNormalize(url) ?? '');
      return texts ? texts.join('\n\n') : undefined;
    },
    inNewsletter: (url) => newsletterUrls.has(safeNormalize(url) ?? ''),
  };
}

/** Charge `raw.json` et `newsletters/*.md` d'un dossier du jour ; les fichiers absents comptent pour vide. */
export function loadSourceTexts(dayDir: string): SourceTexts {
  const rawPath = join(dayDir, 'raw.json');
  const articles = existsSync(rawPath)
    ? RawCollectionSchema.parse(JSON.parse(readFileSync(rawPath, 'utf8'))).articles
    : [];
  const nlDir = join(dayDir, 'newsletters');
  const newsletters = existsSync(nlDir)
    ? readdirSync(nlDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => readFileSync(join(nlDir, f), 'utf8'))
    : [];
  return buildSourceTexts(articles, newsletters);
}
