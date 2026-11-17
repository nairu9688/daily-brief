import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { concatFrames, concatMp3, concatWithFfmpeg, findFfmpeg } from '../../audio/concat';
import { parseMp3, readFrameHeader } from '../../audio/mp3';
import { looksLikeMp3 } from '../../publish/files';
import { apiLikeMp3, frame, frames, id3v1, xingFrame } from './mp3';

const FFMPEG = findFfmpeg();

/** Vrai MP3 produit par ffmpeg : sinusoïde mono à 24 kHz, 32 kb/s (proche de la sortie de Google TTS). */
function realMp3(seconds: number, hz: number): Buffer {
  const out = join(mkdtempSync(join(tmpdir(), 'mp3-')), 'tone.mp3');
  execFileSync(FFMPEG!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${seconds}`, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '32k', out]);
  return readFileSync(out);
}

describe('concatFrames (sans ffmpeg)', () => {
  it('met les trames audio bout à bout, dans l’ordre, sans étiquette ni trame Xing', () => {
    const r = concatFrames([apiLikeMp3(3, 10), Buffer.concat([apiLikeMp3(2, 20), id3v1()])]);
    expect(r.method).toBe('frames');
    expect(r.bytes.length).toBe(5 * 96);
    expect([0, 1, 2, 3, 4].map((i) => r.bytes[i * 96 + 50])).toEqual([10, 11, 12, 20, 21]);
    expect(r.seconds).toBeCloseTo((5 * 576) / 24000, 6);
    expect(looksLikeMp3(r.bytes)).toBe(true);
    expect(parseMp3(r.bytes).infoFrame).toBe(false);
  });

  it('la durée suit le nombre de trames : 2 × 1 000 trames à 24 kHz = 48 s', () => {
    expect(concatFrames([frames(1000), frames(1000)]).seconds).toBe(48);
  });

  it('refuse des morceaux de formats différents, un morceau illisible ou une liste vide', () => {
    expect(() => concatFrames([frames(2), frames(2, { version: 'mpeg1', bitrate: 64 })])).toThrow(/morceau 2 : format différent/);
    expect(() => concatFrames([frames(2), Buffer.from('<html>erreur</html>')])).toThrow(/morceau 2 : trame MP3 attendue/);
    expect(() => concatFrames([Buffer.concat([xingFrame()])])).toThrow(/morceau 1 : aucune trame audio/);
    expect(() => concatFrames([])).toThrow(/aucun morceau/);
  });
});

describe('concatMp3', () => {
  it('sans ffmpeg : concaténation des trames', async () => {
    const r = await concatMp3([frames(4), frames(4)], null);
    expect([r.method, r.bytes.length, r.warnings]).toEqual(['frames', 8 * 96, []]);
  });

  it('ffmpeg en échec (programme absent) : repli sur les trames avec un avertissement', async () => {
    const r = await concatMp3([frames(4), frames(4)], '/chemin/inexistant/ffmpeg');
    expect(r.method).toBe('frames');
    expect(r.bytes.length).toBe(8 * 96);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^ffmpeg en échec \(.+\) : trames concaténées sans réencodage$/);
  });

  it('findFfmpeg : un FFMPEG_PATH qui ne répond pas donne null', () => {
    expect(findFfmpeg({ FFMPEG_PATH: '/chemin/inexistant/ffmpeg' })).toBeNull();
  });
});

describe.skipIf(!FFMPEG)('avec ffmpeg (ignoré si ffmpeg est absent)', () => {
  it('réencode deux vrais MP3 en un MP3 64 kb/s mono, durée exacte relue sur les trames', async () => {
    const r = await concatWithFfmpeg([realMp3(1, 440), realMp3(0.5, 660)], FFMPEG!);
    expect(r.method).toBe('ffmpeg');
    expect(looksLikeMp3(r.bytes)).toBe(true);
    expect(r.seconds).toBeGreaterThan(1.45);
    expect(r.seconds).toBeLessThan(1.65);
    const p = parseMp3(r.bytes);
    expect([p.mono, p.sampleRate]).toEqual([true, 24000]);
    expect(readFrameHeader(p.frames[1], 0)?.bitrate).toBe(64);
    expect(r.bytes.subarray(0, 3).toString('latin1')).not.toBe('ID3');
  }, 30_000);

  it('concatMp3 choisit ffmpeg quand il est présent', async () => {
    const r = await concatMp3([realMp3(0.5, 440), realMp3(0.5, 440)], FFMPEG);
    expect([r.method, r.warnings]).toEqual(['ffmpeg', []]);
  }, 30_000);

  it('la concaténation des trames lit aussi de vrais MP3 (étiquette et trame Info de LAME)', () => {
    const r = concatFrames([realMp3(1, 440), realMp3(0.5, 660)]);
    expect(looksLikeMp3(r.bytes)).toBe(true);
    expect(r.seconds).toBeGreaterThan(1.45);
    expect(r.seconds).toBeLessThan(1.65);
  }, 30_000);

  it('ffmpeg refuse un morceau qui n’est pas un MP3 : repli sur les trames, qui le refusent aussi', async () => {
    await expect(concatMp3([frame(), Buffer.from('pas un mp3')], FFMPEG)).rejects.toThrow(/morceau 2/);
  }, 30_000);
});
