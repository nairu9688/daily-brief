import { describe, expect, it } from 'vitest';
import { formatDuration, id3v2Size, mp3Seconds, Mp3FormatError, parseMp3, readFrameHeader } from '../../audio/mp3';
import { looksLikeMp3 } from '../../publish/files';
import { apiLikeMp3, frame, frames, id3v1, id3v2, xingFrame } from './mp3';

describe('readFrameHeader', () => {
  it('lit une trame MPEG-2 couche III à 24 kHz, 32 kb/s, mono (96 octets, 576 échantillons)', () => {
    expect(readFrameHeader(frame(), 0)).toEqual({ version: 'mpeg2', bitrate: 32, sampleRate: 24000, samples: 576, mono: true, length: 96 });
  });

  it('lit une trame MPEG-1 à 44,1 kHz, 128 kb/s, stéréo (417 octets, 1152 échantillons)', () => {
    expect(readFrameHeader(frame({ version: 'mpeg1', bitrate: 128, mono: false }), 0)).toEqual({ version: 'mpeg1', bitrate: 128, sampleRate: 44100, samples: 1152, mono: false, length: 417 });
  });

  it('compte l’octet de remplissage', () => {
    const f = frame({ version: 'mpeg1', bitrate: 128 });
    f[2] |= 0x02;
    expect(readFrameHeader(f, 0)?.length).toBe(418);
  });

  it('refuse ce qui n’est pas une trame couche III valide', () => {
    const bad = (patch: (b: Buffer) => void) => {
      const f = frame();
      patch(f);
      return readFrameHeader(f, 0);
    };
    expect(bad((b) => (b[0] = 0xfe))).toBeNull(); // pas de synchronisation
    expect(bad((b) => (b[1] = 0xeb))).toBeNull(); // version réservée
    expect(bad((b) => (b[1] = 0xf5))).toBeNull(); // couche II
    expect(bad((b) => (b[2] = 0x04))).toBeNull(); // débit libre
    expect(bad((b) => (b[2] = 0xf4))).toBeNull(); // débit interdit
    expect(bad((b) => (b[2] = 0x4c))).toBeNull(); // fréquence réservée
    expect(readFrameHeader(Buffer.from([0xff, 0xf3]), 0)).toBeNull(); // en-tête incomplet
  });
});

describe('parseMp3', () => {
  it('compte les trames et la durée : 125 trames de 576 échantillons à 24 kHz = 3 s', () => {
    const p = parseMp3(frames(125));
    expect([p.frames.length, p.seconds, p.sampleRate, p.mono, p.infoFrame]).toEqual([125, 3, 24000, true, false]);
  });

  it('retire l’étiquette ID3v2, la trame Xing et l’étiquette ID3v1', () => {
    const p = parseMp3(Buffer.concat([apiLikeMp3(10), id3v1()]));
    expect(p.frames.length).toBe(10);
    expect(p.infoFrame).toBe(true);
    expect(p.frames.every((f) => f[0] === 0xff && f[4] !== 0)).toBe(true);
  });

  it('reconnaît aussi une trame « Info » (MP3 à débit constant)', () => {
    expect(parseMp3(Buffer.concat([xingFrame({}, 'Info'), frames(3)])).frames.length).toBe(3);
  });

  it('ignore une dernière trame tronquée', () => {
    const b = Buffer.concat([frames(4), frame().subarray(0, 50)]);
    expect(parseMp3(b).frames.length).toBe(4);
  });

  it('ignore moins de 4 octets après la dernière trame, comme une trame tronquée', () => {
    expect(parseMp3(Buffer.concat([frames(3), Buffer.from([0, 0])])).frames.length).toBe(3);
  });

  it('trame Xing d’un MP3 protégé par CRC (bit de protection à 0) : l’étiquette est 2 octets plus loin', () => {
    const info = xingFrame();
    info.fill(0, 4 + 9, 4 + 9 + 4); // l'étiquette n'est plus à la place sans CRC
    info[1] &= 0xfe;
    info.write('Xing', 4 + 2 + 9, 'latin1');
    const p = parseMp3(Buffer.concat([info, frames(3)]));
    expect([p.frames.length, p.infoFrame]).toEqual([3, true]);
  });

  it('n’enlève l’ID3v1 que si une frontière de trame tombe à 128 octets de la fin', () => {
    const f = frames(4);
    const tagLike = Buffer.concat([f, Buffer.alloc(128, 0x20)]);
    tagLike.write('TAG', f.length, 'latin1');
    // frontière exacte : retirée
    expect(parseMp3(tagLike).frames.length).toBe(4);
    // « TAG » au milieu d'une trame audio, à end-128 : toutes les trames sont gardées
    const inside = frames(4);
    inside.write('TAG', inside.length - 128, 'latin1');
    expect(parseMp3(inside).frames.length).toBe(4);
  });

  it('refuse des octets qui ne sont pas des trames, un mélange de formats ou un fichier sans audio', () => {
    expect(() => parseMp3(Buffer.concat([frames(2), Buffer.from('nimporte quoi, assez long pour un en-tête')]))).toThrow(/trame MP3 attendue à l'octet 192/);
    expect(() => parseMp3(Buffer.concat([frames(2), frame({ version: 'mpeg1', bitrate: 64 })]))).toThrow(/format de trame changeant/);
    expect(() => parseMp3(Buffer.concat([frames(2), frame({ mono: false })]))).toThrow(/format de trame changeant/);
    expect(() => parseMp3(id3v2())).toThrow(Mp3FormatError);
    expect(() => parseMp3(Buffer.concat([id3v2(), xingFrame()]))).toThrow(/aucune trame audio/);
    expect(() => parseMp3(Buffer.alloc(0))).toThrow(/aucune trame audio/);
  });

  it('id3v2Size lit la taille « synchsafe » et refuse un octet de taille invalide', () => {
    expect(id3v2Size(id3v2(300))).toBe(310);
    expect(id3v2Size(frame())).toBe(0);
    const bad = id3v2(10);
    bad[7] = 0x80;
    expect(() => id3v2Size(bad)).toThrow(/ID3 invalide/);
  });

  it('les MP3 synthétiques passent le contrôle de la publication (lot 4)', () => {
    expect(looksLikeMp3(frames(2))).toBe(true);
    expect(looksLikeMp3(apiLikeMp3(2))).toBe(true);
    expect(looksLikeMp3(frame({ version: 'mpeg1', bitrate: 64 }))).toBe(true);
  });
});

describe('durée', () => {
  it('mp3Seconds additionne les trames audio seulement', () => {
    expect(mp3Seconds(apiLikeMp3(250))).toBe(6);
  });

  it('formatDuration écrit m:ss, arrondi à la seconde', () => {
    expect(formatDuration(204)).toBe('3:24');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(5.4)).toBe('0:05');
    expect(formatDuration(3725)).toBe('62:05');
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(Infinity)).toBe('0:00');
  });
});
