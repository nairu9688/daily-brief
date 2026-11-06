// Rend la maquette appli (HTML) + le PDF 3 éditions à partir de content.mjs
import fs from 'node:fs';
import QRCode from 'qrcode';
import { DATE, editions, threads } from './content.mjs';

const b64 = (p) => fs.readFileSync(p).toString('base64');
const FONT_SANS = b64('node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2');
const FONT_MONO = b64('node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2');
const MAP = Object.fromEntries(['map-floods', 'map-strike', 'map-kyiv', 'map-dc', 'map-us', 'map-spain'].map((k) => [k, fs.readFileSync(k + '.svg', 'utf8')]));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const RUB = {
  fr: { pol: 'Politique & société', int: 'International', eco: 'Économie', ent: 'Entreprises', dro: 'Droit', tec: 'Tech & IA', env: 'Environnement', cul: 'Culture', spo: 'Sport' },
  en: { pol: 'Politics & society', int: 'World', eco: 'Economy', ent: 'Business', dro: 'Law', tec: 'Tech & AI', env: 'Environment', cul: 'Culture', spo: 'Sport' },
  es: { pol: 'Política', int: 'Internacional', eco: 'Economía', ent: 'Empresas', dro: 'Derecho', tec: 'Tecnología', env: 'Medio ambiente', cul: 'Cultura', spo: 'Deporte' },
};
const T = {
  fr: { all: 'Tout', ai: 'Résumé IA · d’après les sources citées', read: 'Lire', src: 'sources', brief: 'En bref', empty: 'Rien de marquant dans cette rubrique ce matin.', listen: 'Écouter', tr: 'Traduction', infos: 'infos', subj: (n) => n > 1 ? n + ' sujets' : n + ' sujet', full: 'lu en entier', title: 'titre + lien', ed: 'Édition française' },
  en: { all: 'All', ai: 'AI summary · based on cited sources', read: 'Read', src: 'sources', brief: 'In brief', empty: 'Nothing major in this section this morning.', listen: 'Listen', tr: 'Translation', infos: 'stories', subj: (n) => n > 1 ? n + ' stories' : n + ' story', full: 'read in full', title: 'headline + link', ed: 'English edition' },
  es: { all: 'Todo', ai: 'Resumen IA · según las fuentes citadas', read: 'Leer', src: 'fuentes', brief: 'En breve', empty: 'Nada destacado en esta sección esta mañana.', listen: 'Escuchar', tr: 'Traducción', infos: 'temas', subj: (n) => n > 1 ? n + ' temas' : n + ' tema', full: 'leído entero', title: 'titular + enlace', ed: 'Edición en español' },
};
const PALETTE = ['#0F3B85', '#B8860B', '#7A1F2B', '#1F6F5C', '#5B3FA0', '#A23B12', '#2E5E9E', '#6B6B1F', '#8A2E62', '#305C2E'];
const favColor = (n) => PALETTE[[...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const initials = (n) => n.split(/[\s·]+/).filter((w) => /^[A-Za-zÀ-ÿ]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const uniqNames = (srcs) => [...new Set(srcs.map((s) => s.name))];

const ICON = {
  spark: '<svg viewBox="0 0 12 12"><path d="M6 0l1.4 4.6L12 6 7.4 7.4 6 12 4.6 7.4 0 6l4.6-1.4z" fill="currentColor"/></svg>',
  ext: '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8l5-5M4 3h4v4"/></svg>',
  thread: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4" cy="4" r="2.2"/><circle cx="14" cy="9" r="2.2"/><circle cx="4" cy="14" r="2.2"/><path d="M6 5l6 3M6 13l6-3"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 4l5 5-5 5"/></svg>',
  cap: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1 6l7-3.5L15 6 8 9.5z"/><path d="M4 7.6v3.2c1.2 1.1 2.6 1.6 4 1.6s2.8-.5 4-1.6V7.6"/></svg>',
  split: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2v4M8 6L3.5 11M8 6l4.5 5"/><circle cx="3.5" cy="12.5" r="1.6"/><circle cx="12.5" cy="12.5" r="1.6"/></svg>',
  play: '<svg viewBox="0 0 14 14"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>',
};

/* ===================== APPLI ===================== */
function card(s, L) {
  const t = T[L];
  const vis = s.visual.map
    ? `<div class="media">${MAP[s.visual.map]}<span class="cap mono">${esc(s.visual.cap)}</span></div>`
    : `<div class="photo"><div class="ph" style="background:${s.visual.grad}"></div><span class="pex mono">Pexels</span><span class="cap mono">Photo libre · « ${esc(s.visual.photo)} »</span></div>`;
  const names = uniqNames(s.sources);
  const primary = s.sources.find((x) => x.read) || s.sources[0];
  const id = 'm' + Math.random().toString(36).slice(2, 8);
  return `<article class="card">${vis}<div class="body">
  <div class="kicker mono"><span class="acc">${esc(s.kicker)}</span><i></i>${esc(s.time)}</div>
  <h3>${esc(s.title)}</h3>
  <div class="ai mono">${ICON.spark}${esc(t.ai)}</div>
  <p class="sum">${esc(s.summary)}</p>
  ${s.stats ? `<div class="stats">${s.stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
  ${s.quote ? `<blockquote class="quote"><p>« ${esc(s.quote.text)} »</p>${s.quote.tr ? `<p class="tr"><span class="mono">${t.tr}</span> ${esc(s.quote.tr)}</p>` : ''}<cite class="mono">${esc(s.quote.by)}</cite></blockquote>` : ''}
  ${s.diverge ? `<div class="diverge"><div class="dh mono">${ICON.split}${esc(s.diverge.label)}</div>${s.diverge.rows.map(([k, a, as, b, bs]) => `<div class="drow"><span class="dk">${esc(k)}</span><div class="dv"><b>${esc(a)}</b><small class="mono">${esc(as)}</small></div><div class="dv"><b>${esc(b)}</b><small class="mono">${esc(bs)}</small></div></div>`).join('')}</div>` : ''}
  ${s.thread ? `<a class="thread" href="#thread" data-open="${s.thread.open || ''}">${ICON.thread}<div><b class="mono">Thread</b><span>${esc(s.thread.title)} <em>· ${esc(s.thread.sub)}</em></span></div>${ICON.chev}</a>` : ''}
  ${s.prepa ? `<div class="prepa">${ICON.cap}<div><b class="mono">Lien prépa · ${esc(s.prepa.tag)}</b><p>${esc(s.prepa.text)}</p></div></div>` : ''}
  <div class="srcs"><div class="stack"><div class="favs">${names.slice(0, 4).map((n) => `<span class="fav" style="background:${favColor(n)}">${initials(n)}</span>`).join('')}</div><small>${esc(names.slice(0, 2).join(', '))}${names.length > 2 ? ` +${names.length - 2}` : ''}</small></div>
    <div class="btns">${s.sources.length > 1 ? `<button class="btn" data-toggle="${id}">${s.sources.length} ${t.src}</button>` : ''}<a class="btn pri" target="_blank" rel="noopener" href="${esc(primary.url)}">${t.read} ${ICON.ext}</a></div></div>
  ${s.sources.length > 1 ? `<div class="more" id="${id}" hidden>${s.sources.map((x) => `<a target="_blank" rel="noopener" href="${esc(x.url)}"><span class="fav sm" style="background:${favColor(x.name)}">${initials(x.name)}</span><span class="mt"><b class="mono">${esc(x.name)}</b>${esc(x.title)}</span><span class="rd mono ${x.read ? 'on' : ''}">${x.read ? t.full : t.title}</span></a>`).join('')}</div>` : ''}
</div></article>`;
}
function briefs(list, L) {
  return `<div class="briefs"><div class="bh mono">${T[L].brief}</div>${list.map((x) => `<a class="brief" target="_blank" rel="noopener" href="${esc(x.url)}"><span class="fav sm" style="background:${favColor(x.name)}">${initials(x.name)}</span><span class="bt">${esc(x.title)}<small class="mono">${esc(x.name)}</small></span>${ICON.ext}</a>`).join('')}</div>`;
}
function vocab(v) {
  return `<div class="rub" data-rub="vocab"><div class="rubhead"><h2>Vocab du jour</h2><span class="mono">${v.items.length} mots</span></div>
  <div class="vocab"><header><div><div class="kicker mono"><span class="acc">Tirés des articles du jour</span></div><h3>${esc(v.title)}</h3></div><button class="selall mono">Tout cocher</button></header>
  ${v.items.map(([w, pos, fr, ex]) => `<label class="vrow"><input type="checkbox" class="vchk"><span class="box"></span><span class="vt"><b>${esc(w)}<em>${esc(pos)}</em></b><span class="fr">${esc(fr)}</span><p>${esc(ex)}</p></span></label>`).join('')}
  <footer><button class="anki" disabled>Ajouter à Anki</button><span class="soon mono">Synchro Anki · phase 2</span></footer></div></div>`;
}
function edition(e) {
  const L = e.lang, t = T[L];
  const present = new Set(e.sections.map((s) => s.key));
  return `<section class="edition" data-for="${L}"${L === 'fr' ? '' : ' hidden'}>
  <div class="mb"><div class="kicker mono"><span class="acc">Morning Brief</span><i></i>${e.points.length} ${t.infos}<i></i>10 min</div>
    <h1>${esc(e.headline)}</h1>
    <div class="player" data-lang="${L}"><button class="play" aria-label="${t.listen}">${ICON.play}</button><div class="wave"></div><div class="ptime mono">${e.audio}<br><span>CHIRP HD</span></div></div>
    <ol class="points">${e.points.map(([a, b, r], i) => `<li><span class="n mono">0${i + 1}</span><p><b>${esc(a)}</b> ${esc(b)}<span class="tag mono">${esc(r)}</span></p></li>`).join('')}</ol></div>
  <div class="chips"><button class="chip" aria-pressed="true" data-rub="all">${t.all}</button>${Object.entries(RUB[L]).map(([k, n]) => `<button class="chip${present.has(k) ? '' : ' dim'}" aria-pressed="false" data-rub="${k}">${esc(n)}</button>`).join('')}</div>
  <p class="empty mono" hidden>${t.empty}</p>
  ${e.sections.map((s) => `<div class="rub" data-rub="${s.key}"><div class="rubhead"><h2>${esc(s.title)}</h2><span class="mono">${t.subj(s.stories.length + (s.briefs ? s.briefs.length : 0))}</span></div>${s.stories.map((x) => card(x, L)).join('')}${s.briefs ? briefs(s.briefs, L) : ''}</div>`).join('')}
  ${e.vocab ? vocab(e.vocab) : ''}
  <p class="colophon mono">Édition générée à 05:41 · ${new Set(e.sections.flatMap((s) => [...s.stories.flatMap((x) => x.sources), ...(s.briefs || [])]).map((x) => x.name)).size} médias dans cette maquette</p>
</section>`;
}
function thread(L) {
  const th = threads[L];
  return `<div class="th" data-for="${L}"${L === 'fr' ? '' : ' hidden'}><div class="th-head"><a class="back mono" href="#app">← BRIEF</a>
    <div class="kicker mono" style="margin-top:14px"><span class="acc">Thread</span><i></i>${esc(th.kicker)}<i></i>${th.nodes.length - 1} ${ {fr:'épisodes',en:'episodes',es:'episodios'}[L] }</div>
    <h2>${esc(th.title)}</h2><p>${esc(th.intro)}</p><button class="follow"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 1.5a3 3 0 013 3V7l1 1.5H2L3 7V4.5a3 3 0 013-3zM5 10.5h2"/></svg>${ {fr:'Suivre ce thread',en:'Follow this thread',es:'Seguir este hilo'}[L] }</button></div>
  <ol class="timeline">${th.nodes.map((n) => `<li class="${n.st}"><span class="d mono">${esc(n.d)}</span><h4>${esc(n.h)}</h4><p>${esc(n.p)}</p>${n.map ? `<div class="mini">${MAP[th.map]}</div>` : ''}${n.src ? `<span class="s mono">${esc(n.src)} ↗</span>` : ''}</li>`).join('')}</ol></div>`;
}

const APP_CSS = fs.readFileSync('app.css', 'utf8').replace('{{FONT_SANS}}', FONT_SANS).replace('{{FONT_MONO}}', FONT_MONO);
const appHtml = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Daily Brief — maquette v2</title><style>${APP_CSS}</style></head><body>
<div class="mockbar"><span class="t mono">Maquette v2 · contenu réel du 6 nov. 2026</span>
  <div class="ctrls"><div class="seg" data-seg="theme"><button data-v="auto" aria-pressed="true">Auto</button><button data-v="light" aria-pressed="false">Clair</button><button data-v="dark" aria-pressed="false">Sombre</button></div>
  <div class="seg" data-seg="en"><span class="lbl mono">Accent EN</span><button data-v="emerald" aria-pressed="true"><i style="background:#10B981"></i>Émeraude</button><button data-v="magenta" aria-pressed="false"><i style="background:#E64A8B"></i>Magenta</button><button data-v="violet" aria-pressed="false"><i style="background:#8B5CF6"></i>Violet</button></div></div></div>
<main class="stage">
<div class="col"><p class="caption mono">Écran 1 · Édition du jour</p><div class="device"><div class="notch"></div><div class="scroll"><div class="app" data-ed="fr" id="app">
  <header class="topbar"><div class="brandrow"><div class="brand"><span class="logo"></span>DAILY BRIEF</div><div class="date mono">${DATE.short} · 06:00</div></div>
  <div class="editions" role="tablist">${editions.map((e, i) => `<button role="tab" aria-selected="${i === 0}" data-ed="${e.lang}"><b>${e.label}</b><span class="mono">${e.region}</span></button>`).join('')}</div></header>
  ${editions.map(edition).join('')}
  <nav class="tabbar"><a class="on" href="#app"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="14" height="14" rx="3"/><path d="M6.5 7.5h7M6.5 10.5h7M6.5 13.5h4"/></svg>Brief</a><a href="#thread"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="5" cy="5" r="2.2"/><circle cx="15" cy="10" r="2.2"/><circle cx="5" cy="15" r="2.2"/><path d="M7 6l6 3M7 14l6-3"/></svg>Threads</a><a href="#app"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h9a3 3 0 013 3v9H7a3 3 0 01-3-3z"/><path d="M8 8h5M8 11h3"/></svg>Vocab</a><a href="#app"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2.5v3M13 2.5v3"/></svg>Archive</a></nav>
</div></div></div></div>
<div class="col" id="thread"><p class="caption mono">Écran 2 · Thread (suit l'édition choisie)</p><div class="device"><div class="notch"></div><div class="scroll"><div class="app" data-ed="fr" id="app2">
  ${['fr', 'en', 'es'].map(thread).join('')}
</div></div></div></div>
</main>
<script>${fs.readFileSync('app.js', 'utf8')}</script></body></html>`;
fs.writeFileSync('daily-brief-maquette.html', appHtml);

/* ===================== PDF ===================== */
const qr = async (u) => (await QRCode.toString(u, { type: 'svg', margin: 0, errorCorrectionLevel: 'L' })).replace('<svg', '<svg class="qr"');
const ACC = { fr: '#3E6BFF', en: '#0E9F6E', es: '#C08A00' };
async function pdfStory(s, L) {
  const t = T[L];
  const primary = s.sources.find((x) => x.read) || s.sources[0];
  const vis = s.visual.map ? `<div class="fig">${MAP[s.visual.map]}</div><div class="figcap mono">${esc(s.visual.cap)}</div>`
    : `<div class="fig ph" style="background:${s.visual.grad}"></div><div class="figcap mono">Photo libre de droits · Pexels</div>`;
  return `<article class="story"><div class="txt">
    <div class="kick mono"><b>${esc(s.kicker)}</b> · ${esc(s.time)}</div><h4>${esc(s.title)}</h4>
    <div class="ai mono"><i>✦</i> ${esc(t.ai)}</div><p class="sum">${esc(s.summary)}</p>
    ${s.stats ? `<div class="stats">${s.stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
    ${s.quote ? `<blockquote class="quote"><p>« ${esc(s.quote.text)} »</p>${s.quote.tr ? `<p class="tr">${esc(s.quote.tr)}</p>` : ''}<cite class="mono">${esc(s.quote.by)}</cite></blockquote>` : ''}
    ${s.diverge ? `<div class="diverge"><b class="mono">${esc(s.diverge.label)}</b>${s.diverge.rows.map(([k, a, as, b, bs]) => `<div class="drow"><span>${esc(k)}</span><span><strong>${esc(a)}</strong> ${esc(as)}</span><span><strong>${esc(b)}</strong> ${esc(bs)}</span></div>`).join('')}</div>` : ''}
    ${s.prepa ? `<p class="prepa"><b>Lien prépa · ${esc(s.prepa.tag)}</b>${esc(s.prepa.text)}</p>` : ''}
  </div><div class="side2">${vis}
    <div class="src">${await qr(primary.url)}<div><b>${s.sources.length} ${t.src}</b>${s.sources.map((x) => `<a href="${esc(x.url)}">${esc(x.name)}</a>`).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}</div></div>
  </div></article>`;
}
async function pdfEdition(e) {
  const L = e.lang, t = T[L];
  let secs = '';
  for (const s of e.sections) {
    let stories = ''; for (const x of s.stories) stories += await pdfStory(x, L);
    secs += `<div class="rubh"><h2>${esc(s.title)}</h2><span class="mono">${t.subj(s.stories.length + (s.briefs ? s.briefs.length : 0))}</span></div>${stories}${s.briefs ? `<div class="pbriefs">${s.briefs.map((x) => `<a href="${esc(x.url)}"><span>${esc(x.title)}</span><span class="mono">${esc(x.name)} ↗</span></a>`).join('')}</div>` : ''}`;
  }
  const voc = e.vocab ? `<div class="rubh"><h2>Vocab du jour · ${esc(e.vocab.title)}</h2><span class="mono">${e.vocab.items.length} mots</span></div><table class="voc">${e.vocab.items.map(([w, pos, fr, ex]) => `<tr><td><b>${esc(w)}</b> <em class="mono">${esc(pos)}</em></td><td class="fr">${esc(fr)}</td><td class="ex">${esc(ex)}</td></tr>`).join('')}</table>` : '';
  return `<section class="ed" id="ed-${L}" style="--accent:${ACC[L]}">
  <header class="mast"><div class="brand"><span class="logo"></span>DAILY BRIEF</div><div class="meta mono"><b>${t.ed}</b> · ${esc(e.region)}<br>${DATE.fr} · N° ${DATE.no}</div></header>
  <section class="lead"><div><div class="kick mono"><b>Morning Brief</b> · ${e.points.length} ${t.infos} · 10 min</div><h1>${esc(e.headline)}</h1>
    <ol class="mb">${e.points.map(([a, b], i) => `<li><span class="n mono">0${i + 1}</span><span><b>${esc(a)}</b> ${esc(b)}</span></li>`).join('')}</ol></div>
    <aside class="aside"><h3 class="mono">Dans cette édition</h3>${e.sections.map((s) => `<div class="row"><span>${esc(s.title)}</span><span class="mono">${s.stories.length + (s.briefs ? s.briefs.length : 0)}</span></div>`).join('')}${e.vocab ? `<div class="row"><span>Vocab du jour</span><span class="mono">${e.vocab.items.length}</span></div>` : ''}
      <h3 class="mono" style="margin-top:4mm">Les 3 éditions</h3><div class="eds">${editions.map((x) => `<a href="#ed-${x.lang}" style="--c:${ACC[x.lang]}" class="${x.lang === L ? 'on' : ''}">${x.lang.toUpperCase()}</a>`).join('')}</div>
      <div class="audio"><svg viewBox="0 0 24 24" fill="none" stroke="${ACC[L]}" stroke-width="1.5"><circle cx="12" cy="12" r="10.5"/><path d="M10 8.2v7.6l6-3.8z" fill="${ACC[L]}"/></svg><p><b>Version audio</b><br>${e.audio} · voix Chirp HD<br>MP3 dans le même dossier Drive</p></div></aside></section>
  ${(() => { const k = e.sections.flatMap((s) => s.stories).filter((x) => x.stats).slice(0, 4).map((x) => [x.stats[0][0], x.stats[0][1], x.kicker]); return k.length ? `<div class="kpis"><h3 class="mono">${ {fr:'Les chiffres du jour',en:'Numbers of the day',es:'Las cifras del día'}[L] }</h3><div class="kg">${k.map(([v, l, c]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}</span><small class="mono">${esc(c)}</small></div>`).join('')}</div></div>` : ''; })()}
  <div class="pb"></div>${secs}${voc}</section>`;
}
const PDF_CSS = fs.readFileSync('pdf.css', 'utf8').replace('{{FONT_SANS}}', FONT_SANS).replace('{{FONT_MONO}}', FONT_MONO);
let body = ''; for (const e of editions) body += await pdfEdition(e);
fs.writeFileSync('pdf.html', `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Daily Brief — ${DATE.iso}</title><style>${PDF_CSS}</style></head><body>${body}</body></html>`);
console.log('ok', (appHtml.length / 1024).toFixed(0) + 'KB');
