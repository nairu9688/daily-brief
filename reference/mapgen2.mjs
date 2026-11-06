// Cartes SVG thémables (classes CSS) + QR codes — maquette v2
import fs from 'node:fs';
import { geoConicConformal, geoAlbersUsa, geoPath, geoInterpolate } from 'd3-geo';
import { feature } from 'topojson-client';
import QRCode from 'qrcode';

const topo = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-50m.json'));
const countries = feature(topo, topo.objects.countries).features;
const r1 = (n) => Math.round(n * 10) / 10;
const W = 640, H = 400;
const pathStr = (path, f) => (path(f) || '').replace(/-?\d+\.\d+/g, (m) => String(Math.round(parseFloat(m))));
const grid = (step = 24) => { let g = ''; for (let x = step; x < W; x += step) for (let y = step; y < H; y += step) g += `<circle cx="${x}" cy="${y}" r="0.7" class="dot"/>`; return `<g>${g}</g>`; };
const wrap = (body, label) => `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

function conic({ parallels, rotate, bbox, pad = [[12, 12], [W - 12, H - 12]] }) {
  const proj = geoConicConformal().parallels(parallels).rotate(rotate);
  proj.fitExtent(pad, { type: 'Feature', geometry: { type: 'MultiPoint', coordinates: bbox } });
  proj.clipExtent([[0, 0], [W, H]]);
  return proj;
}
function lands(proj, cls = () => 'land') {
  const path = geoPath(proj); let s = '';
  for (const f of countries) { const d = pathStr(path, f); if (d) s += `<path d="${d}" class="${cls(f.id)}"/>`; }
  return s;
}
function marker(proj, c, label, { dx = 10, dy = 4, anchor = 'start', big = false, r = null } = {}) {
  const [x, y] = proj(c); let s = '';
  if (r) s += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" class="bubble"/>`;
  else s += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${big ? 14 : 10}" class="pulse"/>`;
  s += `<circle cx="${r1(x)}" cy="${r1(y)}" r="3.6" class="marker"/>`;
  if (label) s += `<text x="${r1(x + dx)}" y="${r1(y + dy)}" class="maplabel" text-anchor="${anchor}">${label}</text>`;
  return s;
}
const out = {};

// France — inondations
{ const p = conic({ parallels: [44, 49], rotate: [-3, 0], bbox: [[-5.2, 41.3], [9.9, 51.1]], pad: [[150, 18], [W - 150, H - 18]] });
  let b = grid() + lands(p, (id) => id === '250' ? 'land focus-soft' : 'land');
  b += marker(p, [9.35, 41.73], 'Conca · 285 mm', { dx: 10, dy: -8, big: true });
  b += marker(p, [9.28, 41.59], 'Porto-Vecchio', { dx: 10, dy: 16 });
  b += marker(p, [4.09, 43.78], 'Sommières', { dx: -10, dy: -10, anchor: 'end' });
  b += marker(p, [3.88, 43.61], 'Montpellier', { dx: -10, dy: 16, anchor: 'end' });
  out['map-floods'] = wrap(b, 'Carte : Corse-du-Sud, Gard, Hérault'); }

// France — mobilisation (cercles proportionnels, chiffres des autorités)
{ const p = conic({ parallels: [44, 49], rotate: [-3, 0], bbox: [[-5.2, 41.3], [9.9, 51.1]], pad: [[150, 18], [W - 150, H - 18]] });
  let b = grid() + lands(p, (id) => id === '250' ? 'land focus-soft' : 'land');
  const k = 0.072;
  b += marker(p, [2.35, 48.86], 'Paris · 65 000', { r: r1(Math.sqrt(65000) * k), dx: 22, dy: -14 });
  b += marker(p, [4.84, 45.76], 'Lyon · 30 500', { r: r1(Math.sqrt(30500) * k), dx: 18, dy: 4 });
  out['map-strike'] = wrap(b, 'Carte : manifestants à Paris et Lyon'); }

// Europe — Madrid → Kyiv
{ const p = conic({ parallels: [40, 55], rotate: [-12, 0], bbox: [[-10, 35.5], [41, 58]] });
  let b = grid() + lands(p, (id) => (id === '724' || id === '804') ? 'land focus' : 'land');
  const mad = [-3.70, 40.42], kyiv = [30.52, 50.45], it = geoInterpolate(mad, kyiv); let arc = '';
  for (let i = 0; i <= 40; i++) { const t = i / 40; const [lo, la] = it(t); const [x, y] = p([lo, la + Math.sin(Math.PI * t) * 4.5]); arc += (i ? 'L' : 'M') + r1(x) + ',' + r1(y); }
  b += `<path d="${arc}" class="arc"/>` + marker(p, mad, 'Madrid', { dx: 12, dy: -10 }) + marker(p, kyiv, 'Kyiv', { dx: 12 });
  out['map-kyiv'] = wrap(b, 'Carte : Madrid et Kyiv'); }

// Europe — data centers : pays cités
{ const p = conic({ parallels: [40, 60], rotate: [-8, 0], bbox: [[-11, 36], [32, 66]] });
  const ids = new Set(['372', '616', '208', '246', '724', '528', '250', '826']);
  let b = grid() + lands(p, (id) => ids.has(id) ? 'land focus' : 'land');
  out['map-dc'] = wrap(b, 'Carte : pays où des actions sont prévues'); }

// États-Unis — midterms
{ const usa = countries.find((f) => f.id === '840');
  const p = geoAlbersUsa().fitExtent([[24, 24], [W - 24, H - 24]], usa); const path = geoPath(p);
  let b = grid() + `<path d="${pathStr(path, usa)}" class="land focus-soft"/>`;
  b += marker(p, [-77.01, 38.89], 'Washington', { dx: -12, anchor: 'end', big: true });
  b += marker(p, [-90.18, 32.30], 'Mississippi', { dx: 12, dy: 4 });
  b += marker(p, [-149.9, 61.2], 'Alaska', { dx: 12, dy: 4 });
  out['map-us'] = wrap(b, 'Map: United States'); }

// Espagne — crise ferroviaire
{ const p = conic({ parallels: [37, 43], rotate: [3.5, 0], bbox: [[-9.4, 35.9], [3.4, 43.8]], pad: [[60, 16], [W - 60, H - 16]] });
  let b = grid() + lands(p, (id) => id === '724' ? 'land focus-soft' : 'land');
  const mad = [-3.70, 40.42], urda = [-3.72, 39.41], adamuz = [-4.52, 38.03], vall = [-4.72, 41.65];
  b += `<path d="M${p(mad).map(r1)}L${p(urda).map(r1)}" class="arc"/>`;
  b += marker(p, urda, 'Urda · 28 oct.', { dx: 12, dy: 5, big: true });
  b += marker(p, adamuz, 'Adamuz · 18 ene.', { dx: 12, dy: 5 });
  b += marker(p, mad, 'Madrid', { dx: 12, dy: -6 });
  b += marker(p, vall, 'Valladolid', { dx: 12, dy: -4 });
  out['map-spain'] = wrap(b, 'Mapa: Urda, Adamuz, Madrid'); }

for (const [k, v] of Object.entries(out)) fs.writeFileSync(k + '.svg', v);

const qrs = {
  'qr-strike': 'https://www.sudradio.fr/societe/la-grogne-sociale-monte-dun-cran-greve-et-manifestations-partout-en-france',
  'qr-floods': 'https://fr.euronews.com/2026/11/06/intemperies-deux-morts-en-corse-dans-des-inondations-le-gard-et-lherault-egalement-touches',
  'qr-kyiv': 'https://fr.euronews.com/2026/11/06/a-madrid-zelensky-lance-un-appel-urgent-a-laide-pour-sauver-le-reseau-electrique-ukrainien',
  'qr-us': 'https://www.cbsnews.com/news/house-districts-flipped-2026-midterm-elections/',
  'qr-tgv': 'https://www.sudradio.fr/societe/le-nouveau-tgv-dalstom-entre-enfin-en-service-commercial-vendredi-a-la-sncf',
  'qr-dc': 'https://www.euronews.com/2026/11/05/protesters-across-europe-to-call-for-freeze-on-energy-hungry-data-centres',
  'qr-puente': 'https://www.elsaltodiario.com/psoe/dimite-oscar-puente-no-ira-listas-proximas-elecciones',
  'qr-rail': 'https://www.eldiario.es/economia/crisis-ferroviaria-aleja-meta-eliminar-vuelos-corto-radio-refuerza-puente-aereo_1_13642115.html',
};
for (const [k, u] of Object.entries(qrs)) {
  const s = await QRCode.toString(u, { type: 'svg', margin: 0, errorCorrectionLevel: 'L' });
  fs.writeFileSync(k + '.svg', s.replace('<svg', '<svg class="qr"'));
}
console.log(Object.keys(out).map((k) => k + ' ' + (out[k].length / 1024).toFixed(0) + 'KB').join('\n'));
