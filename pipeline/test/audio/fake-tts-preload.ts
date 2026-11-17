import { appendFileSync } from 'node:fs';
import { fakeTts, okSynth } from './fake-tts';

/**
 * Module de préchargement des tests de CLI audio : remplace `fetch` par un faux Text-to-Speech
 * (aucun appel réel). `FAKE_TTS=403` : clé refusée ; sinon un MP3 de 3 s par morceau. Chaque URL
 * et la valeur de `x-goog-api-key` sont ajoutées au fichier `FAKE_FETCH_LOG`.
 */
const net = fakeTts(() => (process.env.FAKE_TTS === '403' ? { status: 403, json: { error: { code: 403, status: 'PERMISSION_DENIED' } } } : okSynth()));
globalThis.fetch = (async (url: string, init?: Parameters<typeof net.fetch>[1]) => {
  if (process.env.FAKE_FETCH_LOG) appendFileSync(process.env.FAKE_FETCH_LOG, `${url} ${init?.headers?.['x-goog-api-key'] ?? '-'}\n`);
  return net.fetch(url, init);
}) as unknown as typeof fetch;
