import { chromium } from 'playwright';

/** Largeur maximale d'une photo du PDF : la colonne fait moins de 9 cm, 1000 px y donnent près de 300 ppp. */
export const PHOTO_MAX_WIDTH = 1000;
/** Qualité JPEG du réencodage (0 à 1). */
export const PHOTO_QUALITY = 0.75;

export type ShrinkStats = { images: number; before: number; after: number };
export type ShrinkResult = { images: Record<string, string>; stats: ShrinkStats; error?: string };

/** Types DOM minimaux du code exécuté dans la page (le projet ne charge pas la bibliothèque DOM). */
type PageImage = { src: string; naturalWidth: number; naturalHeight: number; decode(): Promise<void> };
type PageCanvas = {
  width: number;
  height: number;
  getContext(kind: '2d'): { fillStyle: string; imageSmoothingQuality: string; fillRect(x: number, y: number, w: number, h: number): void; drawImage(img: PageImage, x: number, y: number, w: number, h: number): void } | null;
  toDataURL(type: string, quality: number): string;
};
type PageGlobals = { Image: new () => PageImage; document: { createElement(tag: 'canvas'): PageCanvas } };

const bytesOf = (dataUri: string): number => Buffer.byteLength(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');

/**
 * Réduit chaque photo avant de l'insérer dans le PDF : au plus `PHOTO_MAX_WIDTH` px de large, réencodée en
 * JPEG (qualité `PHOTO_QUALITY`) sur fond blanc, par le canvas de Chromium (déjà requis pour l'impression :
 * aucune dépendance native de plus). Une image n'est remplacée que si le résultat est plus léger ; une image
 * illisible reste telle quelle. Toute requête réseau de la page est refusée. Ne lève jamais : en cas d'échec
 * (navigateur, délai), les images d'origine sont rendues avec `error`.
 */
export async function shrinkImages(
  images: Record<string, string>,
  opts: { maxWidth?: number; quality?: number; timeoutMs?: number } = {},
): Promise<ShrinkResult> {
  const entries = Object.entries(images);
  const before = entries.reduce((n, [, d]) => n + bytesOf(d), 0);
  const unchanged = (error?: string): ShrinkResult => ({ images: { ...images }, stats: { images: entries.length, before, after: before }, ...(error ? { error } : {}) });
  if (entries.length === 0) return unchanged();
  const maxWidth = opts.maxWidth ?? PHOTO_MAX_WIDTH;
  const quality = opts.quality ?? PHOTO_QUALITY;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = (async () => {
      browser = await chromium.launch({ timeout: Math.max(timeoutMs, 30_000) });
      const page = await browser.newPage();
      await page.route('**/*', (route) => route.abort());
      const out: Record<string, string> = {};
      for (const [key, src] of entries) {
        let shrunk: string | null = null;
        try {
          shrunk = await page.evaluate(
            async ({ src, maxWidth, quality }) => {
              const { Image, document } = globalThis as unknown as PageGlobals;
              const img = new Image();
              img.src = src;
              await img.decode();
              const scale = Math.min(1, maxWidth / img.naturalWidth);
              const w = Math.round(img.naturalWidth * scale);
              const h = Math.round(img.naturalHeight * scale);
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const g = canvas.getContext('2d')!;
              g.fillStyle = '#fff';
              g.fillRect(0, 0, w, h);
              g.imageSmoothingQuality = 'high';
              g.drawImage(img, 0, 0, w, h);
              return canvas.toDataURL('image/jpeg', quality);
            },
            { src, maxWidth, quality },
          );
        } catch {
          shrunk = null; // image illisible : gardée telle quelle
        }
        out[key] = shrunk && /^data:image\/jpeg;base64,/.test(shrunk) && bytesOf(shrunk) < bytesOf(src) ? shrunk : src;
      }
      return out;
    })();
    work.catch(() => {});
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('réduction des photos : délai dépassé')), timeoutMs);
    });
    const out = await Promise.race([work, deadline]);
    return { images: out, stats: { images: entries.length, before, after: Object.values(out).reduce((n, d) => n + bytesOf(d), 0) } };
  } catch (e) {
    return unchanged((e as Error).message);
  } finally {
    clearTimeout(timer);
    let closeTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      (browser as { close(): Promise<void> } | undefined)?.close().catch(() => {}),
      new Promise<void>((resolve) => {
        closeTimer = setTimeout(resolve, 5_000);
      }),
    ]);
    clearTimeout(closeTimer);
  }
}
