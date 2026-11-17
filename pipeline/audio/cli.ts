import { parseArgs } from 'node:util';
import { IsoDateSchema } from '@daily-brief/schema';
import type { HttpFetch } from '../collect/http';
import { parisToday } from '../lib/date';
import { loadEnv } from '../lib/env';
import { redactText } from '../lib/redact';
import { runAudio } from './run-audio';

try {
  loadEnv(['GOOGLE_TTS_API_KEY']);
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' }, 'no-ffmpeg': { type: 'boolean', default: false } } });
  const date = values.date ?? parisToday();
  const { exitCode, report, reportWritten } = await runAudio({
    outDir: values.out!,
    date,
    apiKey: process.env.GOOGLE_TTS_API_KEY,
    fetch: fetch as HttpFetch,
    ...(values['no-ffmpeg'] ? { ffmpeg: null } : {}),
  });
  console.log(`brief:audio ${date}`);
  for (const i of report.issues) console.log(`[${i.level}]${i.lang ? ' ' + i.lang.toUpperCase() : ''} ${i.message}`);
  for (const e of report.editions) console.log(`${e.lang.toUpperCase()} : ${e.file ? `${e.file} (${e.duration}, ${e.chunks} morceau(x), ${e.characters} caractères, ${e.method})` : 'sans lecteur'}`);
  if (!reportWritten && IsoDateSchema.safeParse(date).success) console.error('brief:audio : audio-report.json n’a pas pu être écrit.');
  const made = report.editions.filter((e) => e.file).length;
  const summary = {
    ok: `Audio complet : ${made} MP3, ${report.characters.sent} caractères envoyés.`,
    degraded: `Audio partiel : ${made} MP3 sur ${report.editions.length}, ${report.characters.sent} caractères envoyés.`,
    disabled: 'Audio désactivé : éditions publiées sans lecteur.',
    failed: 'Audio en échec : éditions publiées sans lecteur.',
    invalid: 'Erreur : entrée invalide, pas d’audio.',
  }[report.status];
  console.log(summary);
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:audio : ${redactText(e instanceof Error ? e.message : String(e), [process.env.GOOGLE_TTS_API_KEY?.trim()])}`);
  process.exit(2);
}
