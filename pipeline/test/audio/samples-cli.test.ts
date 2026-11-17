import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../run-cli';

const KEY = 'AIzaSy-cle-de-test-0123456789';
const PRELOAD = 'pipeline/test/audio/fake-tts-preload.ts';

describe('CLI audio:samples', () => {
  it('sans clé : code 2 et message d’aide, aucun appel', () => {
    const r = runCli('pipeline/audio/samples-cli.ts', [], {}, { preload: PRELOAD });
    expect(r.status).toBe(2);
    expect(r.stderr).toBe('audio:samples : GOOGLE_TTS_API_KEY absente (voir docs/setup-audio.md).\n');
  }, 30_000);

  it('avec une clé (faux service) : 2 échantillons par langue dans <out>/voice-samples, code 0', () => {
    const out = mkdtempSync(join(tmpdir(), 'samples-cli-'));
    const r = runCli('pipeline/audio/samples-cli.ts', ['--out', out, '--count', '2'], { GOOGLE_TTS_API_KEY: KEY }, { preload: PRELOAD });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('FR : 4 voix Chirp 3 HD (fr-FR-Chirp3-HD-Aoede, fr-FR-Chirp3-HD-Charon, fr-FR-Chirp3-HD-Kore, fr-FR-Chirp3-HD-Puck)');
    expect(r.stdout).toContain('6 échantillon(s)');
    expect(readdirSync(join(out, 'voice-samples')).filter((f) => f.endsWith('.mp3'))).toHaveLength(6);
    expect(r.stdout + readFileSync(join(out, 'voice-samples', 'index.json'), 'utf8')).not.toContain(KEY);
  }, 30_000);

  it('--count invalide : code 2, sans la clé dans le message', () => {
    const r = runCli('pipeline/audio/samples-cli.ts', ['--count', 'trois'], { GOOGLE_TTS_API_KEY: KEY }, { preload: PRELOAD });
    expect(r.status).toBe(2);
    expect(r.stderr).toBe('audio:samples : --count invalide : « trois »\n');
  }, 30_000);

  it('--count refuse les notations non entières (1e1, 2.5, 0x3)', () => {
    for (const bad of ['1e1', '2.5', '0x3', '0']) {
      const r = runCli('pipeline/audio/samples-cli.ts', ['--count', bad], { GOOGLE_TTS_API_KEY: KEY }, { preload: PRELOAD });
      expect([bad, r.status]).toEqual([bad, 2]);
      expect(r.stderr).toBe(`audio:samples : --count invalide : « ${bad} »\n`);
    }
  }, 60_000);

  it('--count 50 : ramené à 10 avec un avertissement affiché', () => {
    const out = mkdtempSync(join(tmpdir(), 'samples-cli-'));
    const r = runCli('pipeline/audio/samples-cli.ts', ['--out', out, '--count', '50'], { GOOGLE_TTS_API_KEY: KEY }, { preload: PRELOAD });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[warning] --count 50 ramené à 10 (maximum)');
  }, 30_000);

  it('le script npm audio:samples pointe sur ce CLI', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['audio:samples']).toBe('tsx pipeline/audio/samples-cli.ts');
  });
});
