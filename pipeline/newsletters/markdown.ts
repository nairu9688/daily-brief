import { parseHTML } from 'linkedom';

/** Liens à ne jamais garder : désinscription et préférences (jamais suivis, jamais cités). */
const OPT_OUT_URL = /unsubscribe|desabonn|d%C3%A9sabonn|desinscri|d%C3%A9sinscri|desuscri|optout|opt-out|preferences|email-settings|manage-subscription/i;
const OPT_OUT_WORDS = /(d[ée]sabonn|d[ée]sinscri|unsubscribe|opt[\s-]?out|darse de baja|date de baja|cancelar (la |tu )?suscripci|preferenc|pr[ée]f[ée]rences|manage (your )?(subscriptions?|email)|g[ée]rer (mes |vos )?(abonnements|newsletters))/i;
/** Texte de lien court (moins de 80 caractères) : le mot de désinscription peut être n'importe où. */
const SHORT_LINK_TEXT = 80;
const isOptOutText = (text: string) => (text.length <= SHORT_LINK_TEXT ? OPT_OUT_WORDS.test(text) : new RegExp(`^\\s*(se\\s+)?${OPT_OUT_WORDS.source}`, 'i').test(text));

/** Seules ces clés portent la destination d'un lien de suivi ; aucune autre n'est déballée. */
const REDIRECT_KEYS = new Set(['u', 'url', 'q', 'redirect', 'target', 'dest']);
/** URL dans du texte : http(s) jusqu'au premier blanc ou chevron. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;

const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CENTER', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL']);
const SKIP = new Set(['HEAD', 'IMG', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE', 'TITLE']);
const HEADING = /^H([1-6])$/;
/** Styles en ligne qui masquent un élément et tout son sous-arbre (texte d'aperçu, texte piégé). */
const HIDDEN_STYLE = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|font-size\s*:\s*0(\.0+)?([a-z%]+)?\s*(!important)?\s*(;|$)|max-height\s*:\s*0(\.0+)?([a-z%]+)?\s*(!important)?\s*(;|$)|opacity\s*:\s*0(\.0+)?\s*(!important)?\s*(;|$))/i;

export type CleanLinkOptions = {
  /** Hôte d'articles (domaine de la newsletter ou de la liste blanche) : un lien vers lui n'est jamais déballé vers un autre domaine. */
  articleHost?: (host: string) => boolean;
};

const bareHost = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');
/** Même domaine ou sous-domaine l'un de l'autre (click.lemonde.fr et lemonde.fr). */
const sameSite = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

/**
 * URL d'un lien, nettoyée : http(s) seulement ; un lien de suivi qui porte sa destination dans un
 * paramètre de redirection connu (`u`, `url`, `q`, `redirect`, `target`, `dest`) est remplacé par
 * cette destination, sauf si l'hôte extérieur est un hôte d'articles et que la destination est sur
 * un autre domaine (`lemonde.fr/a?url=https://autre…` reste l'article du Monde). Aucun lien n'est
 * suivi sur le réseau : un lien de suivi opaque reste tel quel. Les parenthèses sont encodées
 * (`%28`, `%29`) pour que `[texte](url)` reste lisible. null pour un lien de désinscription ou illisible.
 */
export function cleanLink(href: string, opts: CleanLinkOptions = {}, depth = 0): string | null {
  let u: URL;
  try {
    u = new URL(href.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (OPT_OUT_URL.test(u.pathname + u.search)) return null;
  if (depth < 2) {
    const outer = bareHost(u);
    for (const [key, value] of u.searchParams) {
      if (!REDIRECT_KEYS.has(key.toLowerCase()) || !/^https?:\/\//i.test(value)) continue;
      const inner = cleanLink(value, opts, depth + 1);
      if (!inner) {
        if (OPT_OUT_URL.test(value)) return null;
        continue;
      }
      if (opts.articleHost?.(outer) && !sameSite(outer, bareHost(new URL(inner)))) continue;
      return inner;
    }
  }
  return u.toString().replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** Une ligne de texte sans URL ni saut de ligne (objet d'un message). */
export function plainLine(text: string): string {
  return flat(text.replace(URL_IN_TEXT, ' ')).trim();
}

/** Ce que la conversion lit d'un nœud linkedom (le pipeline n'a pas les types du DOM). */
type DomNode = {
  nodeType: number;
  textContent: string | null;
  childNodes: Iterable<DomNode>;
  tagName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
};

const flat = (s: string) => s.replace(/[\s ]+/g, ' ');

/**
 * Convertit le HTML d'une newsletter en texte markdown, mot pour mot : les textes ne sont pas
 * réécrits, seuls les blancs sont réduits. Les blocs sont séparés par une ligne vide (verify lit
 * le texte d'une URL dans son bloc et le précédent), les liens deviennent `[texte](url)`, les
 * titres `#`. Scripts, styles, images et éléments masqués sont retirés.
 */
export function htmlToMarkdown(html: string, opts: CleanLinkOptions = {}): string {
  const { document } = parseHTML(/<html[\s>]/i.test(html) ? html : `<!doctype html><html><body>${html}</body></html>`);
  const out: string[] = [];
  const hidden = (el: DomNode) => HIDDEN_STYLE.test(el.getAttribute('style') ?? '') || el.hasAttribute('hidden');

  const inline = (node: DomNode): string => {
    let s = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) s += child.textContent ?? '';
      else if (child.nodeType === 1) {
        const el = child;
        if (SKIP.has(el.tagName) || hidden(el)) continue;
        s += el.tagName === 'BR' ? ' ' : inline(el);
      }
    }
    return s;
  };

  const walk = (node: DomNode) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        // Une URL nue n'est jamais un lien : elle est retirée du texte (seuls les <a> visibles comptent).
        // Les crochets aussi : un faux `[x](url)` découpé en plusieurs nœuds ne doit pas se recomposer.
        out.push(flat((child.textContent ?? '').replace(URL_IN_TEXT, ' ').replace(/[[\]]/g, '')));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child;
      const tag = el.tagName;
      if (SKIP.has(tag) || hidden(el)) continue;
      if (tag === 'BR') {
        out.push('\n');
        continue;
      }
      if (tag === 'A') {
        const raw = flat(inline(el)).trim();
        if (!raw || isOptOutText(raw)) continue;
        const href = el.getAttribute('href');
        const url = href ? cleanLink(href, opts) : null;
        // Le texte d'un lien perd ses URL (le nom d'hôte de la destination les remplace) et ses crochets et parenthèses.
        let text = flat(raw.replace(URL_IN_TEXT, ' ')).replace(/[[\]()]/g, '').trim();
        if (!text && url && /https?:\/\//i.test(raw)) text = new URL(url).hostname;
        if (!text) continue;
        out.push(url ? `[${text}](${url})` : text);
        continue;
      }
      const h = HEADING.exec(tag);
      if (h) {
        const text = flat(inline(el).replace(URL_IN_TEXT, ' ').replace(/[[\]]/g, '')).trim();
        if (text) out.push(`\n\n${'#'.repeat(Math.min(Number(h[1]), 3))} ${text}\n\n`);
        continue;
      }
      const block = BLOCK.has(tag);
      if (block) out.push('\n\n');
      walk(el);
      if (block) out.push('\n\n');
    }
  };
  walk((document.body ?? document.documentElement) as unknown as DomNode);
  return tidy(out.join(''));
}

/** Texte brut d'une newsletter : fins de ligne unifiées, blancs de fin de ligne retirés. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Corps en texte brut d'une newsletter, nettoyé comme le HTML : chaque URL passe par `cleanLink`
 * (suivi déballé, désinscription retirée) et devient `[url](url)` ; une URL refusée est retirée.
 * Le reste du texte est gardé mot pour mot (seuls les blancs sont réduits).
 */
export function textToMarkdown(text: string, opts: CleanLinkOptions = {}): string {
  const linked = text.replace(/\r\n?/g, '\n').replace(URL_IN_TEXT, (match) => {
    let url = match;
    let tail = '';
    for (;;) {
      const last = url.at(-1)!;
      const unbalanced = last === ')' && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length;
      if (!/[.,;:!?*_\]]/.test(last) && !unbalanced) break;
      tail = last + tail;
      url = url.slice(0, -1);
    }
    const clean = cleanLink(url, opts);
    return clean ? `[${clean}](${clean})${tail}` : tail;
  });
  return tidy(linked);
}
