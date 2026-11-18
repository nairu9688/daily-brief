import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RawCollectionSchema } from '@daily-brief/schema';
import { hostOf, tryNormalizeUrl } from '../lib/url';
import { loadWhitelist, lookupDomain, type Whitelist } from '../lib/whitelist';
import { loadNewsletters } from '../newsletters/config';

/** Textes lus du jour, indexés par URL : articles en texte intégral (R1) et newsletters. */
export interface SourceTexts {
  textFor(url: string): string | undefined;
  /** Vrai si l'URL est citée dans une newsletter du jour : son texte compte alors comme lu (R1). */
  inNewsletter(url: string): boolean;
}

/** Liens markdown `[texte](url)` : seuls ceux-là comptent (brief:newsletters n'en écrit que depuis des <a> visibles). */
const LINK = /\[[^\]\n]*\]\((https?:\/\/[^\s()<>]+)\)/g;
/** En-tête écrit par brief:newsletters : `---\nnewsletter: <id>\ndomain: <domaine de l'éditeur>\n---`. */
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n*/;

/** Ce qu'une newsletter peut faire compter comme lu (défense en profondeur, revue du lot 7). */
export type NewsletterScope = {
  /** Domaines de la liste blanche : un lien vers eux compte. */
  whitelist?: Whitelist;
  /** Domaines des éditeurs de newsletters.json : le `domain` de l'en-tête ne compte que s'il en fait partie (sans cette liste, il compte). */
  publisherDomains?: ReadonlySet<string>;
};

function splitFrontMatter(newsletter: string): { domain: string | null; body: string } {
  const m = FRONT_MATTER.exec(newsletter);
  if (!m) return { domain: null, body: newsletter };
  const d = /^domain:\s*([a-z0-9.-]+)\s*$/m.exec(m[1]);
  return { domain: d ? d[1].toLowerCase() : null, body: newsletter.slice(m[0].length) };
}

/** Découpe une newsletter en blocs : lignes vides et titres markdown. */
function blocksOf(newsletter: string): string[] {
  return newsletter.split(/\n\s*\n|\n(?=#)/).filter((b) => b.trim() !== '');
}

/** URL des liens `[texte](url)` d'un bloc, normalisées ; une URL nue ou à parenthèses non encodées est ignorée. */
function urlsIn(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(LINK)) {
    const u = tryNormalizeUrl(m[1].replace(/&amp;/g, '&'));
    if (u) out.push(u);
  }
  return out;
}

export function buildSourceTexts(articles: { url: string; text: string | null }[], newsletters: string[], scope: NewsletterScope = {}): SourceTexts {
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
    // Seuls comptent les liens vers le domaine de l'éditeur (en-tête) ou un domaine de la liste blanche.
    const { domain, body } = splitFrontMatter(nl);
    const publisher = domain && (!scope.publisherDomains || scope.publisherDomains.has(domain)) ? domain : null;
    const inScope = (u: string) => {
      const h = hostOf(u);
      return (publisher !== null && (h === publisher || h.endsWith(`.${publisher}`))) || (scope.whitelist !== undefined && lookupDomain(scope.whitelist, u) !== undefined);
    };
    const seen = new Set<string>();
    const blocks = blocksOf(body);
    blocks.forEach((block, i) => {
      for (const u of urlsIn(block)) {
        if (!inScope(u)) continue;
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

const WHITELIST_PATH = fileURLToPath(new URL('../config/whitelist.json', import.meta.url));

/**
 * Charge `raw.json` et `newsletters/*.md` d'un dossier du jour ; les fichiers absents comptent pour vide.
 * La portée des newsletters vient de la liste blanche et des éditeurs de newsletters.json (par défaut, ceux du dépôt).
 */
export function loadSourceTexts(dayDir: string, scope?: NewsletterScope): SourceTexts {
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
  return buildSourceTexts(articles, newsletters, scope ?? defaultScope());
}

/** Liste blanche et éditeurs de newsletters.json du dépôt ; newsletters.json illisible : aucun éditeur. */
export function defaultScope(whitelist: Whitelist = loadWhitelist(WHITELIST_PATH)): NewsletterScope {
  let publisherDomains = new Set<string>();
  try {
    publisherDomains = new Set(loadNewsletters().newsletters.map((n) => n.domain));
  } catch {
    // newsletters.json illisible : seuls les liens vers la liste blanche comptent.
  }
  return { whitelist, publisherDomains };
}
