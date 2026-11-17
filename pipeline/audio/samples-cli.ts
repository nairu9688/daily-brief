import { parseArgs } from 'node:util';
import type { HttpFetch } from '../collect/http';
import { loadEnv } from '../lib/env';
import { redactText } from '../lib/redact';
import { DEFAULT_SAMPLES, runVoiceSamples } from './samples';
import { loadVoices } from './voices';

try {
  loadEnv(['GOOGLE_TTS_API_KEY']);
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'out' }, count: { type: 'string', default: String(DEFAULT_SAMPLES) } } });
  const apiKey = process.env.GOOGLE_TTS_API_KEY?.trim();
  if (!apiKey) {
    console.error('audio:samples : GOOGLE_TTS_API_KEY absente (voir docs/setup-audio.md).');
    process.exit(2);
  }
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1) throw new Error(`--count invalide : « ${values.count} »`);
  const { exitCode, index, dir } = await runVoiceSamples({ apiKey, fetch: fetch as HttpFetch, outDir: values.out!, voices: loadVoices(), count });
  console.log('audio:samples');
  for (const i of index.issues) console.log(`[warning] ${i}`);
  for (const lang of ['fr', 'en', 'es'] as const) console.log(`${lang.toUpperCase()} : ${index.voices[lang].length} voix Chirp 3 HD${index.voices[lang].length ? ` (${index.voices[lang].join(', ')})` : ''}`);
  for (const s of index.samples) console.log(`  ${s.file ? `${dir}/${s.file}` : `${s.voice} : ${s.error}`}`);
  console.log(`${index.samples.filter((s) => s.file).length} échantillon(s), ${index.characters} caractères. Écouter, puis recopier les voix choisies dans pipeline/config/voices.json (confirmed: true).`);
  process.exit(exitCode);
} catch (e) {
  console.error(`audio:samples : ${redactText(e instanceof Error ? e.message : String(e), [process.env.GOOGLE_TTS_API_KEY?.trim()])}`);
  process.exit(2);
}
