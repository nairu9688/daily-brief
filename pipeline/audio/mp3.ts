/**
 * Lecture des trames MPEG audio couche III (MP3), sans dépendance : en-têtes, étiquettes ID3,
 * trame d'information Xing/Info/VBRI et durée. Sert à la concaténation sans ffmpeg et à mesurer
 * la durée de tout MP3 produit.
 */

export type MpegVersion = 'mpeg1' | 'mpeg2' | 'mpeg2.5';

export type FrameHeader = {
  version: MpegVersion;
  /** Débit en kb/s. */
  bitrate: number;
  sampleRate: number;
  /** Échantillons par trame : 1152 (MPEG-1) ou 576 (MPEG-2 et 2.5). */
  samples: number;
  mono: boolean;
  /** Longueur de la trame en octets, en-tête compris. */
  length: number;
};

export type ParsedMp3 = {
  /** Trames audio, sans étiquette ni trame d'information. */
  frames: Uint8Array[];
  sampleRate: number;
  version: MpegVersion;
  mono: boolean;
  /** Durée en secondes (nombre d'échantillons / fréquence). */
  seconds: number;
  /** Trame d'information (Xing, Info ou VBRI) retirée. */
  infoFrame: boolean;
};

/** Débits de la couche III (kb/s), index 1 à 14 ; 0 (format libre) et 15 sont refusés. */
const BITRATES: Record<'mpeg1' | 'mpeg2', number[]> = {
  mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<MpegVersion, number[]> = {
  mpeg1: [44100, 48000, 32000],
  mpeg2: [22050, 24000, 16000],
  'mpeg2.5': [11025, 12000, 8000],
};

/** Erreur de format MP3 ; le message donne la position fautive, jamais le contenu. */
export class Mp3FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mp3FormatError';
  }
}

/** En-tête de trame couche III à la position `at`, ou null s'il n'y en a pas de valide. */
export function readFrameHeader(b: Uint8Array, at: number): FrameHeader | null {
  if (at + 4 > b.length) return null;
  const b1 = b[at + 1];
  const b2 = b[at + 2];
  const b3 = b[at + 3];
  if (b[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const v = (b1 >> 3) & 3;
  if (v === 1) return null; // version réservée
  if (((b1 >> 1) & 3) !== 1) return null; // couche III seulement
  const version: MpegVersion = v === 3 ? 'mpeg1' : v === 2 ? 'mpeg2' : 'mpeg2.5';
  const bitrateIndex = b2 >> 4;
  const srIndex = (b2 >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || srIndex === 3) return null;
  const bitrate = BITRATES[version === 'mpeg1' ? 'mpeg1' : 'mpeg2'][bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][srIndex];
  const padding = (b2 >> 1) & 1;
  const samples = version === 'mpeg1' ? 1152 : 576;
  const length = Math.floor(((samples / 8) * bitrate * 1000) / sampleRate) + padding;
  return { version, bitrate, sampleRate, samples, mono: b3 >> 6 === 3, length };
}

/** Taille de l'étiquette ID3v2 en tête (10 octets d'en-tête, pied éventuel compris), ou 0. */
export function id3v2Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  if ((b[6] | b[7] | b[8] | b[9]) & 0x80) throw new Mp3FormatError('étiquette ID3 invalide');
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

/** Vrai si la trame porte une étiquette Xing, Info (après les informations annexes) ou VBRI (à 36 octets). */
function isInfoFrame(frame: Uint8Array, h: FrameHeader): boolean {
  const side = h.version === 'mpeg1' ? (h.mono ? 17 : 32) : h.mono ? 9 : 17;
  const tag = (at: number) => String.fromCharCode(...frame.subarray(at, at + 4));
  const xing = tag(4 + side);
  return xing === 'Xing' || xing === 'Info' || tag(36) === 'VBRI';
}

/**
 * Découpe un MP3 en trames audio. Les étiquettes ID3v2 (en tête) et ID3v1 (128 derniers octets)
 * et la trame d'information sont retirées ; une dernière trame tronquée est ignorée. Lève
 * Mp3FormatError si les octets ne sont pas une suite de trames couche III de même format.
 */
export function parseMp3(bytes: Uint8Array): ParsedMp3 {
  let end = bytes.length;
  if (end >= 128 && bytes[end - 128] === 0x54 && bytes[end - 127] === 0x41 && bytes[end - 126] === 0x47) end -= 128;
  let at = id3v2Size(bytes);
  const frames: Uint8Array[] = [];
  let first: FrameHeader | null = null;
  let infoFrame = false;
  let samples = 0;
  while (at < end) {
    const h = readFrameHeader(bytes, at);
    if (!h) throw new Mp3FormatError(`trame MP3 attendue à l'octet ${at}`);
    if (at + h.length > end) break; // dernière trame tronquée
    const frame = bytes.subarray(at, at + h.length);
    if (first && (h.version !== first.version || h.sampleRate !== first.sampleRate || h.mono !== first.mono)) {
      throw new Mp3FormatError(`format de trame changeant à l'octet ${at}`);
    }
    if (!first && isInfoFrame(frame, h)) infoFrame = true;
    else {
      frames.push(frame);
      samples += h.samples;
    }
    first ??= h;
    at += h.length;
  }
  if (!first || frames.length === 0) throw new Mp3FormatError('aucune trame audio');
  return { frames, sampleRate: first.sampleRate, version: first.version, mono: first.mono, seconds: samples / first.sampleRate, infoFrame };
}

/** Durée en secondes d'un MP3 (somme des trames audio). */
export const mp3Seconds = (bytes: Uint8Array): number => parseMp3(bytes).seconds;

/** Durée au format m:ss (« 3:24 »), arrondie à la seconde. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
