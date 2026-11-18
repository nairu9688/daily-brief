import { parseHTML } from 'linkedom';

/** Liens à ne jamais garder : désinscription et préférences (jamais suivis, jamais cités). */
const OPT_OUT_URL = /unsubscribe|desabonn|d%C3%A9sabonn|desinscri|desuscri|optout|opt-out|preferences|email-settings|manage-subscription/i;
const OPT_OUT_TEXT = /^\s*(se\s+)?(d[ée]sabonner|d[ée]sinscri|unsubscribe|darse de baja|cancelar (la )?suscripci|manage (your )?(preferences|subscriptions?|email)|g[ée]rer (mes |vos )?(pr[ée]f[ée]rences|abonnements|newsletters))/i;

const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CENTER', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL']);
const SKIP = new Set(['HEAD', 'IMG', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE', 'TITLE']);
const HEADING = /^H([1-6])$/;

/**
 * URL d'un lien, nettoyée : http(s) seulement ; un lien de suivi qui porte sa destination dans un
 * paramètre (`?u=https%3A…`, `?url=…`, `?q=…`) est remplacé par cette destination. Aucun lien n'est
 * suivi sur le réseau : un lien de suivi opaque reste tel quel (il ne désignera aucun article).
 * null pour un lien de désinscription ou un lien illisible.
 */
export function cleanLink(href: string, depth = 0): string | null {
  let u: URL;
  try {
    u = new URL(href.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (OPT_OUT_URL.test(u.pathname + u.search)) return null;
  if (depth < 2) {
    for (const [, value] of u.searchParams) {
      if (/^https?:\/\//i.test(value)) {
        const inner = cleanLink(value, depth + 1);
        if (inner) return inner;
      }
    }
  }
  return u.toString();
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
export function htmlToMarkdown(html: string): string {
  const { document } = parseHTML(/<html[\s>]/i.test(html) ? html : `<!doctype html><html><body>${html}</body></html>`);
  const out: string[] = [];
  const hidden = (el: DomNode) => /display\s*:\s*none/i.test(el.getAttribute('style') ?? '') || el.hasAttribute('hidden');

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
        out.push(flat(child.textContent ?? ''));
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
        const text = flat(inline(el)).trim();
        const url = el.getAttribute('href') ? cleanLink(el.getAttribute('href')!) : null;
        if (!text) continue;
        out.push(url && !OPT_OUT_TEXT.test(text) ? `[${text.replace(/[[\]]/g, '')}](${url})` : OPT_OUT_TEXT.test(text) ? '' : text);
        continue;
      }
      const h = HEADING.exec(tag);
      if (h) {
        const text = flat(inline(el)).trim();
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
