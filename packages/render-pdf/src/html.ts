import { qrSvg, renderMap } from '@daily-brief/maps';
import { LANGS, type Edition, type Lang, type SourceRef, type Story } from '@daily-brief/schema';
import { pdfCss } from './assets';
import { escapeHtml as esc, longDateFr } from './format';
import { ACCENT, QUOTE_MARKS, T } from './i18n';

export type PdfInput = {
  date: string;
  /** Numéro du jour, « 001 » le 06/11/2026. */
  issue: string;
  /** Une à trois éditions ; l'ordre de sortie est toujours FR, EN, ES. */
  editions: Edition[];
};

export type PdfOptions = {
  /** URL d'image Pexels → data URI ; une photo absente de la table n'est pas affichée. */
  images?: Record<string, string>;
  /** Durée de l'audio par édition (« 3:24 ») ; sans durée, pas d'encart audio. */
  audio?: Partial<Record<Lang, { duration: string }>>;
};

/** Seules les images raster en base64 sont acceptées : toute autre valeur est omise (injection HTML). */
const SAFE_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

type Ctx = { qr: Map<string, string>; images: Record<string, string> };

const uniqueOutlets = (sources: SourceRef[]) => {
  const seen = new Map<string, SourceRef>();
  for (const s of sources) if (!seen.has(s.outlet)) seen.set(s.outlet, s);
  return [...seen.values()];
};

/** Source principale : la première lue en entier (R4 garantit qu'il y en a une). */
export const primarySource = (story: Story) => story.sources.find((s) => s.readFull) ?? story.sources[0];

function visual(story: Story, ctx: Ctx): string {
  const v = story.visual;
  if (v.type === 'map') {
    return `<div class="fig">${renderMap(v.map, v.caption)}</div><div class="figcap mono">${esc(v.caption)}</div>`;
  }
  const data = v.pexels ? ctx.images[v.pexels.src] : undefined;
  if (!v.pexels || !data || !SAFE_IMAGE.test(data)) return '';
  const alt = v.pexels.alt ?? v.query;
  return `<div class="fig"><img src="${esc(data)}" alt="${esc(alt)}"></div><div class="figcap mono">Photo : <a href="${esc(v.pexels.photographerUrl)}">${esc(v.pexels.photographer)}</a> · <a href="${esc(v.pexels.pexelsUrl)}">Pexels</a></div>`;
}

function story(s: Story, lang: Lang, ctx: Ctx): string {
  const t = T[lang];
  const [open, close] = QUOTE_MARKS[lang];
  const primary = primarySource(s);
  const stats = s.stats.length
    ? `<div class="stats">${s.stats.map((x) => `<div class="stat"><b>${esc(x.value)}</b><span>${esc(x.label)}</span></div>`).join('')}</div>`
    : '';
  const quote = s.quote
    ? `<blockquote class="quote"><p>${open}${esc(s.quote.text)}${close}</p>${
        s.quote.translation ? `<p class="tr"><span class="mono">${t.translation}</span>${esc(s.quote.translation)}</p>` : ''
      }<cite class="mono">${esc(s.quote.speaker)}</cite></blockquote>`
    : '';
  const diverge = s.divergences.length
    ? `<div class="diverge"><b class="mono">${t.diverge}</b>${s.divergences
        .map((d) => `<div class="drow"><span>${esc(d.metric)}</span><span><strong>${esc(d.a.value)}</strong> ${esc(d.a.by)}</span><span><strong>${esc(d.b.value)}</strong> ${esc(d.b.by)}</span></div>`)
        .join('')}</div>`
    : '';
  const prepa = s.prepa ? `<p class="prepa"><b>Lien prépa · ${esc(s.prepa.subject)}</b>${esc(s.prepa.text)}</p>` : '';
  const links = uniqueOutlets(s.sources).map((x) => `<a href="${esc(x.url)}">${esc(x.outlet)}</a>`).join(' · ');
  return `<article class="story"><div class="txt">
    <div class="kick mono"><b>${esc(s.kicker)}</b> · ${esc(s.date)}</div><h4>${esc(s.title)}</h4>
    <div class="ai mono"><i>✦</i> ${t.ai}</div><p class="sum">${esc(s.summary)}</p>
    ${stats}${quote}${diverge}${prepa}
  </div><div class="side2">${visual(s, ctx)}
    <div class="src">${ctx.qr.get(primary.url) ?? ''}<div><b>${s.sources.length} ${t.sources}</b>${links}</div></div>
  </div></article>`;
}

function kpis(ed: Edition): string {
  const k = ed.sections
    .flatMap((s) => s.stories)
    .filter((st) => st.stats.length)
    .slice(0, 4)
    .map((st) => `<div class="kpi"><b>${esc(st.stats[0].value)}</b><span>${esc(st.stats[0].label)}</span><small class="mono">${esc(st.kicker)}</small></div>`);
  return k.length ? `<div class="kpis"><h3 class="mono">${T[ed.lang].kpis}</h3><div class="kg">${k.join('')}</div></div>` : '';
}

function edition(ed: Edition, input: PdfInput, opts: PdfOptions, ctx: Ctx): string {
  const L = ed.lang;
  const t = T[L];
  const present = new Set(input.editions.map((e) => e.lang));
  const count = (s: Edition['sections'][number]) => s.stories.length + s.briefs.length;
  const rows = ed.sections.map((s) => `<div class="row"><span>${esc(s.title)}</span><span class="mono">${count(s)}</span></div>`).join('');
  const vocabRow = ed.vocab ? `<div class="row"><span>${t.vocab}</span><span class="mono">${ed.vocab.items.length}</span></div>` : '';
  const eds = LANGS.map((l) =>
    present.has(l)
      ? `<a href="#ed-${l}" style="--c:${ACCENT[l]}" class="${l === L ? 'on' : ''}">${l.toUpperCase()}</a>`
      : `<span>${l.toUpperCase()}</span>`,
  ).join('');
  const audio = opts.audio?.[L]
    ? `<div class="audio"><svg viewBox="0 0 24 24" fill="none" stroke="${ACCENT[L]}" stroke-width="1.5"><circle cx="12" cy="12" r="10.5"/><path d="M10 8.2v7.6l6-3.8z" fill="${ACCENT[L]}"/></svg><p><b>Version audio</b><br>${esc(opts.audio[L]!.duration)} · voix Chirp HD<br>MP3 dans le même dossier Drive</p></div>`
    : '';
  const sections = ed.sections
    .map(
      (s) =>
        `<div class="rubh"><h2>${esc(s.title)}</h2><span class="mono">${t.subjects(count(s))}</span></div>${s.stories.map((x) => story(x, L, ctx)).join('')}${
          s.briefs.length
            ? `<div class="pbriefs">${s.briefs.map((b) => `<a href="${esc(b.url)}"><span>${esc(b.title)}</span><span class="mono">${esc(b.outlet)} ↗</span></a>`).join('')}</div>`
            : ''
        }`,
    )
    .join('');
  const vocab = ed.vocab
    ? `<div class="rubh"><h2>${t.vocab} · ${esc(ed.vocab.title)}</h2><span class="mono">${ed.vocab.items.length} ${t.words}</span></div><table class="voc">${ed.vocab.items
        .map((w) => `<tr><td><b>${esc(w.term)}</b> <em class="mono">${esc(w.pos)}</em></td><td class="fr">${esc(w.translation)}</td><td class="ex">${esc(w.example)}</td></tr>`)
        .join('')}</table>`
    : '';
  return `<section class="ed" id="ed-${L}" style="--accent:${ACCENT[L]}">
  <header class="mast"><div class="brand"><span class="logo"></span>DAILY BRIEF</div><div class="meta mono"><b>${t.edition}</b> · ${esc(ed.region)}<br>${longDateFr(input.date)} · N° ${esc(input.issue)}</div></header>
  <section class="lead"><div><div class="kick mono"><b>Morning Brief</b> · ${ed.morningBrief.length} ${t.infos} · 10 min</div><h1>${esc(ed.headline)}</h1>
    <ol class="mb">${ed.morningBrief.map((p, i) => `<li><span class="n mono">0${i + 1}</span><span><b>${esc(p.lead)}</b> ${esc(p.text)}</span></li>`).join('')}</ol></div>
    <aside class="aside"><h3 class="mono">${t.inThisEdition}</h3>${rows}${vocabRow}
      <h3 class="mono" style="margin-top:4mm">Les 3 éditions</h3><div class="eds">${eds}</div>${audio}</aside></section>
  ${kpis(ed)}
  <div class="pb"></div>${sections}${vocab}</section>`;
}

/** Document HTML complet du PDF du jour : éditions FR, EN puis ES, chacune ouverte par sa couverture. */
export async function renderPdfHtml(input: PdfInput, opts: PdfOptions = {}): Promise<string> {
  const editions = LANGS.map((l) => input.editions.find((e) => e.lang === l)).filter((e): e is Edition => e !== undefined);
  if (editions.length === 0) throw new Error('renderPdfHtml : aucune édition à rendre');
  const urls = new Set(editions.flatMap((e) => e.sections.flatMap((s) => s.stories.map((st) => primarySource(st).url))));
  const qr = new Map<string, string>();
  for (const u of urls) qr.set(u, await qrSvg(u));
  const ctx: Ctx = { qr, images: opts.images ?? {} };
  const body = editions.map((e) => edition(e, { ...input, editions }, opts, ctx)).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Daily Brief — ${esc(input.date)}</title><style>${pdfCss()}</style></head><body>${body}</body></html>`;
}
