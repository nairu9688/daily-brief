import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureEdition } from '../helpers';
import { runCli } from '../run-cli';

const DAY = '2026-11-06';
const KEY = 'AIzaSy-cle-de-test-0123456789';
const PRELOAD = 'pipeline/test/audio/fake-tts-preload.ts';

/** Dossier du jour avec les trois éditions vérifiées de la fixture ; `--out` absolu. */
function audioCli(env: Record<string, string> = {}, files?: Record<string, string>, args: string[] = []) {
  const outDir = mkdtempSync(join(tmpdir(), 'audio-cli-'));
  const dayDir = join(outDir, DAY);
  mkdirSync(dayDir);
  for (const lang of ['fr', 'en', 'es'] as const) writeFileSync(join(dayDir, `${lang}.verified.json`), JSON.stringify(fixtureEdition(lang)));
  const log = join(outDir, 'fetch.log');
  const r = runCli('pipeline/audio/cli.ts', ['--date', DAY, '--out', outDir, '--no-ffmpeg', ...args], { FAKE_FETCH_LOG: log, ...env }, { files, preload: PRELOAD });
  return { ...r, dayDir, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

describe('CLI brief:audio', () => {
  it('sans clé : code 0, audio désactivé, aucun appel', () => {
    const r = audioCli();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      'brief:audio 2026-11-06\n' + '[warning] GOOGLE_TTS_API_KEY absente : audio désactivé, éditions publiées sans lecteur\n' + 'Audio désactivé : éditions publiées sans lecteur.\n',
    );
    expect(r.log).toBe('');
    expect(JSON.parse(readFileSync(join(r.dayDir, 'audio-report.json'), 'utf8')).status).toBe('disabled');
  }, 30_000);

  it('avec une clé (faux service) : trois MP3, audio.json, code 0 ; la clé passe en en-tête', () => {
    const r = audioCli({ GOOGLE_TTS_API_KEY: `  ${KEY}  ` });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`FR : Daily Brief ${DAY} FR.mp3 (0:03, 1 morceau(x), `);
    expect(r.stdout).toContain('[warning] ffmpeg absent : trames concaténées sans réencodage (débit de la source)\n');
    expect(r.stdout).toMatch(/Audio complet : 3 MP3, \d+ caractères envoyés\.\n$/);
    expect(JSON.parse(readFileSync(join(r.dayDir, 'audio.json'), 'utf8'))).toEqual({ fr: { duration: '0:03' }, en: { duration: '0:03' }, es: { duration: '0:03' } });
    expect(r.log.trim().split('\n')).toEqual(Array(3).fill(`https://texttospeech.googleapis.com/v1/text:synthesize ${KEY}`));
  }, 30_000);

  it('clé refusée : code 1 (audio en échec, la routine continue), aucun secret affiché ni écrit', () => {
    const r = audioCli({ GOOGLE_TTS_API_KEY: KEY, FAKE_TTS: '403' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('[error] FR morceau 1/1 : HTTP 403 (https://texttospeech.googleapis.com/v1/text:synthesize) — Text-to-Speech coupé (HTTP 403) : édition publiée sans lecteur');
    expect(r.stdout).toContain('ES : sans lecteur');
    expect(r.stdout).toContain('Audio en échec : éditions publiées sans lecteur.');
    expect(r.stdout + r.stderr + readFileSync(join(r.dayDir, 'audio-report.json'), 'utf8')).not.toContain(KEY);
  }, 30_000);

  it('lit la clé dans .env', () => {
    const r = audioCli({}, { '.env': `GOOGLE_TTS_API_KEY=${KEY}\n` });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Audio complet : 3 MP3');
  }, 30_000);

  it('date invalide : code 2, rien n’est écrit', () => {
    const r = runCli('pipeline/audio/cli.ts', ['--date', '2026-02-30'], {}, { preload: PRELOAD });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] date incorrecte : « 2026-02-30 »');
    expect(r.stdout).toContain('Erreur : entrée invalide, pas d’audio.');
    expect(existsSync(join(r.cwd, 'out'))).toBe(false);
  }, 30_000);

  it('une erreur de haut niveau ne cite pas la clé', () => {
    const r = runCli('pipeline/audio/cli.ts', [`--${KEY}`], { GOOGLE_TTS_API_KEY: KEY }, { preload: PRELOAD });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('brief:audio :');
    expect(r.stderr).not.toContain(KEY);
  }, 30_000);

  it('le script npm brief:audio pointe sur ce CLI', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['brief:audio']).toBe('tsx pipeline/audio/cli.ts');
  });
});
