import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAudio } from '../../audio/run-audio';
import { runRender } from '../../render/run-render';
import { fixtureEdition } from '../helpers';
import { fakeFetch } from '../render/fake-fetch';
import { fakeTts } from './fake-tts';

const DAY = '2026-11-06';
const KEY = 'AIza+Sy/abc=def+ghi/jkl==';
const KEY_FORMS = [KEY, encodeURIComponent(KEY)];

function day() {
  const outDir = mkdtempSync(join(tmpdir(), 'routine-'));
  const dayDir = join(outDir, DAY);
  mkdirSync(dayDir, { recursive: true });
  for (const lang of ['fr', 'en', 'es'] as const) writeFileSync(join(dayDir, `${lang}.verified.json`), JSON.stringify(fixtureEdition(lang)));
  return { outDir, dayDir };
}

/** Rendu sans Chromium : on garde le HTML et on écrit un faux PDF. */
async function render(outDir: string) {
  const printed: string[] = [];
  const r = await runRender({
    outDir,
    date: DAY,
    fetch: fakeFetch({}).fetch,
    print: async (html, outPath) => {
      printed.push(html);
      writeFileSync(outPath, '%PDF-1.7\n%%EOF\n');
    },
  });
  return { r, html: printed[0] ?? '' };
}

describe('ordre de la routine : brief:audio puis brief:render', () => {
  it('l’encart audio du PDF porte la durée de chaque édition écrite par brief:audio', async () => {
    const { outDir } = day();
    expect((await runAudio({ outDir, date: DAY, apiKey: KEY, fetch: fakeTts().fetch, ffmpeg: null })).exitCode).toBe(0);
    const { r, html } = await render(outDir);
    expect(r.exitCode).toBe(0);
    for (const form of KEY_FORMS) expect(html).not.toContain(form);
    expect(html.match(/0:03 · voix Chirp HD/g)).toHaveLength(3);
  });

  it('audio en échec : le PDF est rendu quand même, sans encart audio', async () => {
    const { outDir, dayDir } = day();
    const audio = await runAudio({ outDir, date: DAY, apiKey: KEY, fetch: fakeTts(() => ({ status: 403, json: {} })).fetch, ffmpeg: null });
    expect(audio.exitCode).toBe(1);
    const { r, html } = await render(outDir);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(dayDir, `Daily Brief ${DAY}.pdf`))).toBe(true);
    expect(html).not.toContain('Version audio');
  });

  it('brief:audio ne lit que les éditions vérifiées et n’écrit rien que brief:render remplace', async () => {
    const { outDir, dayDir } = day();
    await runAudio({ outDir, date: DAY, apiKey: KEY, fetch: fakeTts().fetch, ffmpeg: null });
    const before = readFileSync(join(dayDir, `Daily Brief ${DAY} FR.mp3`));
    await render(outDir);
    expect(readFileSync(join(dayDir, `Daily Brief ${DAY} FR.mp3`))).toEqual(before);
    expect(existsSync(join(dayDir, 'audio.json'))).toBe(true);
  });
});
