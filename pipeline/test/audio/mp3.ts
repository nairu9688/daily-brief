/**
 * MP3 synthétiques pour les tests : trames couche III valides (en-tête correct, contenu nul,
 * c'est-à-dire du silence), étiquettes ID3 et trame d'information Xing. Aucun encodeur requis.
 */

export type FrameSpec = {
  /** 'mpeg2' : 24 kHz (sortie habituelle de Google TTS) ; 'mpeg1' : 44,1 kHz. */
  version?: 'mpeg1' | 'mpeg2';
  /** Débit en kb/s, présent dans la table de la version. */
  bitrate?: number;
  mono?: boolean;
};

const MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/**
 * Une trame : MPEG-2 à 24 kHz ou MPEG-1 à 44,1 kHz, sans CRC ni octet de remplissage. Contenu nul :
 * du silence, que ffmpeg décode. `fill` remplit le contenu après l'en-tête d'un octet reconnaissable
 * (tests de concaténation) ; la trame reste lisible par `parseMp3`, mais plus par un décodeur.
 */
export function frame(spec: FrameSpec = {}, fill = 0): Buffer {
  const version = spec.version ?? 'mpeg2';
  const bitrate = spec.bitrate ?? 32;
  const table = version === 'mpeg1' ? MPEG1 : MPEG2;
  const index = table.indexOf(bitrate);
  if (index <= 0) throw new Error(`débit ${bitrate} absent de la table ${version}`);
  const samples = version === 'mpeg1' ? 1152 : 576;
  const rate = version === 'mpeg1' ? 44100 : 24000;
  const length = Math.floor(((samples / 8) * bitrate * 1000) / rate);
  const b = Buffer.alloc(length, fill);
  b[0] = 0xff;
  b[1] = version === 'mpeg1' ? 0xfb : 0xf3;
  b[2] = (index << 4) | ((version === 'mpeg1' ? 0 : 1) << 2);
  b[3] = (spec.mono ?? true) ? 0xc4 : 0x04;
  return b;
}

/** `count` trames ; avec `fill`, le contenu de la trame i vaut `fill + i` (pour suivre l'ordre). */
export function frames(count: number, spec: FrameSpec = {}, fill = 0): Buffer {
  return Buffer.concat(Array.from({ length: count }, (_, i) => frame(spec, fill ? fill + i : 0)));
}

/** Trame d'information « Xing » (ou « Info ») placée après les informations annexes. */
export function xingFrame(spec: FrameSpec = {}, tag: 'Xing' | 'Info' = 'Xing'): Buffer {
  const f = frame(spec);
  const mono = spec.mono ?? true;
  const side = (spec.version ?? 'mpeg2') === 'mpeg1' ? (mono ? 17 : 32) : mono ? 9 : 17;
  f.write(tag, 4 + side, 'latin1');
  return f;
}

/** Étiquette ID3v2.4 de `size` octets de contenu (taille en entier « synchsafe »). */
export function id3v2(size = 20): Buffer {
  const head = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  return Buffer.concat([head, Buffer.alloc(size, 0x41)]);
}

/** Étiquette ID3v1 (128 octets commençant par « TAG »). */
export function id3v1(): Buffer {
  const b = Buffer.alloc(128, 0x20);
  b.write('TAG', 0, 'latin1');
  return b;
}

/** MP3 tel que pourrait le renvoyer une API : ID3v2, trame Xing, `count` trames audio. */
export function apiLikeMp3(count: number, fill = 1, spec: FrameSpec = {}): Buffer {
  return Buffer.concat([id3v2(), xingFrame(spec), frames(count, spec, fill)]);
}
