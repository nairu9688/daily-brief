import { appendFileSync, readFileSync } from 'node:fs';
import { fakeHttp } from './collect/fake-http';
import { repoPath } from './helpers';

/**
 * Module de préchargement des tests de CLI : remplace `fetch` par un faux réseau (aucun appel réel).
 * Le flux RSS Euronews est daté d'il y a une heure, pour rester dans la fenêtre de collecte ; les autres URL
 * répondent 404 ou, pour TheNewsAPI, une liste vide. Chaque URL appelée est ajoutée au fichier `FAKE_FETCH_LOG`.
 */
const stamp = new Date(Date.now() - 3_600_000).toUTCString();
const rss = readFileSync(repoPath('fixtures/api/rss-euronews-fr.xml'), 'utf8').replace(/<pubDate>[^<]*<\/pubDate>/g, `<pubDate>${stamp}</pubDate>`);
const page = readFileSync(repoPath('fixtures/api/article-euronews.html'), 'utf8');
const net = fakeHttp({
  'https://api.thenewsapi.com/': { json: { meta: { found: 0, returned: 0, limit: 3, page: 1 }, data: [] } },
  'https://fr.euronews.com/rss': { body: rss, type: 'application/rss+xml' },
  'https://fr.euronews.com/20': { body: page },
});
globalThis.fetch = (async (url: string, init?: Parameters<typeof net.fetch>[1]) => {
  if (process.env.FAKE_FETCH_LOG) appendFileSync(process.env.FAKE_FETCH_LOG, `${url}\n`);
  return net.fetch(url, init);
}) as unknown as typeof fetch;
