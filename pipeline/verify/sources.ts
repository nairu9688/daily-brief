import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RawCollectionSchema } from '@daily-brief/schema';
import { tryNormalizeUrl } from '../lib/url';

/** Textes lus du jour, indexés par URL : articles en texte intégral (R1) et newsletters. */
export interface SourceTexts {
  textFor(url: string): string | undefined;
  /** Vrai si l'URL est citée dans une newsletter du jour : son texte compte alors comme lu (R1). */
  inNewsletter(url: string): boolean;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>()\[\]"']+/g;

/** Découpe une newsletter en blocs : lignes vides et titres markdown. */
function blocksOf(newsletter: string): string[] {
  return newsletter.split(/\n\s*\n|\n(?=#)/).filter((b) => b.trim() !== '');
}

/** URL citées dans un bloc, normalisées ; une URL suivie de « ( » est ignorée plutôt que tronquée. */
function urlsIn(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(URL_IN_TEXT)) {
    if (block[(m.index ?? 0) + m[0].length] === '(') continue;
    const u = tryNormalizeUrl(m[0].replace(/&amp;/g, '&').replace(/[.,;:!?*_)\]]+$/, ''));
    if (u) out.push(u);
  }
  return out;
}

export function buildSourceTexts(articles: { url: string; text: string | null }[], newsletters: string[]): SourceTexts {
  const byUrl = new Map<string, string[]>();
  const add = (url: string | null, text: string) => {
    if (!url) return;
    byUrl.set(url, [...(byUrl.get(url) ?? []), text]);
  };
  for (const a of articles) if (a.text) add(tryNormalizeUrl(a.url), a.text);
  const newsletterUrls = new Set<string>();
  for (const nl of newsletters) {
    // Le texte d'une URL est son bloc et le bloc précédent (le lien suit souvent le paragraphe).
    // Les fragments sont ignorés : une newsletter qui cite a.com/live#p1 fait lire a.com/live.
    const seen = new Set<string>();
    const blocks = blocksOf(nl);
    blocks.forEach((block, i) => {
      for (const u of urlsIn(block)) {
        newsletterUrls.add(u);
        if (seen.has(u)) continue;
        seen.add(u);
        add(u, i > 0 ? `${blocks[i - 1]}\n\n${block}` : block);
      }
    });
  }
  return {
    textFor: (url) => {
      const texts = byUrl.get(tryNormalizeUrl(url) ?? '');
      return texts ? texts.join('\n\n') : undefined;
    },
    inNewsletter: (url) => newsletterUrls.has(tryNormalizeUrl(url) ?? ''),
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
        .sort()
        .map((f) => readFileSync(join(nlDir, f), 'utf8'))
    : [];
  return buildSourceTexts(articles, newsletters);
}
