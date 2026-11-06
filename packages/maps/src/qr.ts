import QRCode from 'qrcode';

/** QR code SVG (sans marge, correction L) avec la classe `qr`, pour le PDF. */
export async function qrSvg(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'L' });
  return svg.replace('<svg', '<svg class="qr"');
}
