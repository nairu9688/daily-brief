import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** Dossier des polices du paquet npm `geist` (auto-hébergées, aucune police servie par CDN). */
function geistFontsDir(): string {
  return join(dirname(require.resolve('geist/font/sans')), 'fonts');
}

let fonts: { sans: string; mono: string } | undefined;

export function fontBase64(): { sans: string; mono: string } {
  if (fonts) return fonts;
  const dir = geistFontsDir();
  return (fonts = {
    sans: readFileSync(join(dir, 'geist-sans/Geist-Variable.woff2')).toString('base64'),
    mono: readFileSync(join(dir, 'geist-mono/GeistMono-Variable.woff2')).toString('base64'),
  });
}

/** Feuille de style du PDF (portage de design/pdf.css) avec les polices intégrées. */
export function pdfCss(): string {
  const { sans, mono } = fontBase64();
  return readFileSync(new URL('./pdf.css', import.meta.url), 'utf8').replace('{{FONT_SANS}}', sans).replace('{{FONT_MONO}}', mono);
}
