# Lot 3 — Collecte : plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :** produire chaque matin `out/<date>/raw.json` (format `RawCollection` du lot 1) et `out/<date>/context.json` (format `Context`), avec `npm run brief:collect` et `npm run brief:context`. La collecte interroge TheNewsAPI, Exa, les flux RSS et, en secours, Webz.io. Elle dédoublonne les articles et ne lit le texte intégral que sur les domaines `full` de la liste blanche (R1). Le plan ajoute aussi la vérification §16 du temps réel de TheNewsAPI (`npm run check:thenewsapi`). Spec : §4.1, §4.2, §5, §6.1, §12, §16 et R12.

**Architecture :** trois couches dans `pipeline/collect`.
- **Transport.** `http.ts`, `redact.ts`, `breaker.ts`, `budget.ts` et `limit.ts` posent le `fetch` injectable, les délais, la taille maximale, le masquage des jetons, le disjoncteur et le budget de requêtes.
- **Sources.** `thenewsapi.ts`, `exa.ts`, `webz.ts` et `rss.ts` renvoient chacune un bilan `SourceRun`. Tous leurs articles passent par `makeArticle` (`article.ts`), qui applique R1 à l'entrée.
- **Assemblage.** `dedupe.ts` regroupe, `fulltext.ts` complète les textes des seuls domaines `full`, puis `run-collect.ts` orchestre le tout et écrit `raw.json` et `collect-report.json`.

`pipeline/context` définit l'interface `ContextStore` (le store Supabase arrive au lot 4), la règle R12 et `brief:context`. Aucun test n'appelle le réseau.

**Pile :** fast-xml-parser ^5.12.0 (flux RSS et Atom), @mozilla/readability ^0.6.0 et linkedom ^0.18.15 (texte intégral), zod 4 (validation de toute réponse externe), `fetch` de Node 22.

**Feuille de route :** `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md` (lot 3 et §5 « Consignes issues du lot 1 »). **Spec :** `docs/specs/2026-11-06-daily-brief-design.md`.

---

## Contexte pour l'exécutant

- **Point de départ.** Les lots 1 et 2 sont en place. Sur `HEAD`, `npm test` donne `Test Files  30 passed (30)` et `Tests  252 passed (252)`. Les contrats de sortie sont dans `packages/schema/src/raw.ts` : `RawArticleSchema`, `RawCollectionSchema`, `OpenThreadSchema` et `ContextSchema`. Ce lot ne modifie **pas** le schéma.
- **Fichiers à ne pas modifier :** `packages/schema/`, `pipeline/config/whitelist.json` (R1), `pipeline/lib/url.ts`, `pipeline/lib/whitelist.ts` et `pipeline/verify/`. Ce lot réutilise `tryNormalizeUrl`, `outletKey`, `hostOf`, `lookupDomain`, `canReadFull`, `loadWhitelist` et `parisToday`. `pipeline/lib/date.ts` reçoit seulement deux fonctions (tâche 1).
- **R1, garde en profondeur.** Le texte d'un domaine qui n'est pas `full` ne doit jamais entrer dans `raw.json`. Quatre barrières l'en empêchent :
  1. `makeArticle` écarte le texte à l'entrée et le compte dans `discardedTexts`.
  2. Exa ne reçoit `contents` que si `includeDomains` ne contient **que** des domaines `full`.
  3. `fetchFullText` refuse une URL, ou une redirection, hors `full` **avant** toute requête.
  4. `dedupe` puis `runCollect` revérifient chaque texte.

  Les flux RSS ne fournissent que des métadonnées.
- **Leçons des revues des lots 1 et 2, appliquées dès le départ :**
  - **Violations.** Mieux vaut retirer un élément qu'accepter une violation.
  - **Délais et disjoncteur.** Chaque appel réseau a un délai. Un 401, 402, 403, 429 ou un délai dépassé coupe la source pour le reste du passage.
  - **Secrets.** Aucun secret dans un message, un rapport ou `raw.json`. Les jetons de TheNewsAPI (`api_token`) et de Webz (`token`) sont dans l'URL : toute URL est masquée avant d'être citée, et des tests le vérifient.
  - **Entrées.** Toute réponse externe est validée par zod (sans `strict` pour les API tierces). Une entrée mal formée produit une erreur dans le bilan, pas un plantage.
  - **Routine.** Une routine sans surveillance ne reste jamais bloquée : les flux sont bornés en taille et en temps, et la lecture des textes a une échéance globale.
  - **Fichiers et sorties.** Un fichier, une responsabilité. Les sorties sont déterministes. Les anciennes sorties sont supprimées d'abord, et le rapport est toujours écrit.
- **Réseau et clés.** Aucun test n'appelle le réseau : les sources reçoivent un `HttpFetch` injecté, simulé par `pipeline/test/collect/fake-http.ts`. Les tests de CLI lancent les scripts depuis un dossier temporaire vide, sans les variables secrètes (`pipeline/test/run-cli.ts`), donc un `.env` local n'est jamais lu. Aucune clé d'API n'est disponible ni à demander ; la vérification §16 est testée avec un faux `fetch`.
- **Fixtures.** Les réponses de `fixtures/api/` sont **construites** d'après la documentation publique des API et marquées comme telles dans `fixtures/api/README.md`. Ce ne sont pas des enregistrements.
- **Commandes.** Elles se lancent depuis la racine du dépôt. Un échec « Cannot find module … » ou « Failed to load url … » signifie que le module n'existe pas encore : c'est l'échec attendu de l'étape « vérifier l'échec ».

### Décisions de conception

1. **Budget TheNewsAPI (§4.1).** 90 requêtes par jour : FR 25, EN 20, ES 20 et `similar` 25. Le code l'impose de trois façons :
   - `RequestBudget` réserve chaque requête avant l'appel ;
   - le schéma de `collect.json` refuse un total au-delà de 90 ;
   - `out/thenewsapi-usage.json` reporte le compte entre deux passages du même jour UTC. Un fichier illisible rend le quota épuisé : mieux vaut se passer de TheNewsAPI que dépasser.
2. **Requêtes `/top`.** Une requête par rubrique, en tourniquet : la page 1 des 9 rubriques, puis la page 2, et ainsi de suite. `limit` vaut 3, le maximum du plan gratuit. Une rubrique est abandonnée dès qu'une page rend moins de 3 articles. Locales : `fr`, `us,gb` et `es`. La correspondance rubrique → catégories et mots-clés est dans `pipeline/editorial/rubriques.json` ; le lot 7 l'affinera.
3. **`/similar`.** Les graines sont les articles découverts, domaines `full` d'abord, langues en alternance. Les résultats sont rattachés à leur graine (`seed`) et reçoivent le même `groupId`.
4. **Exa.** Pour chaque langue et chaque rubrique, une recherche restreinte aux domaines `full` de la langue, avec le texte. Une recherche ouverte (métadonnées seulement) s'y ajoute quand Exa est la découverte principale. Cela fait 27 requêtes par jour, ou 54 si Exa est principal, sous un plafond de 60. Le mois reste sous 1 700 recherches, pour environ 2 500 permises.
5. **Webz.** Il est appelé, langue par langue, quand la découverte principale y rapporte moins de 10 candidats : absente, en échec ou trop maigre. Au plus 3 requêtes par passage, soit environ 90 par mois pour 1 000 permis. Un post dans une autre langue que FR, EN ou ES est écarté.
6. **RSS.** Métadonnées seulement : ni `content:encoded` ni texte. Au plus 30 articles par flux, dans la fenêtre de 24 h, et seulement les liens vers un domaine `full` ou `feed`.
7. **Texte intégral.** Readability avec linkedom. jsdom n'est pas retenu : il est plus lourd et n'apporte rien ici. linkedom a été vérifié le 11/11/2026 sur de vraies pages Euronews FR, PBS et elDiario : 5 830, 1 782 et 2 322 caractères extraits, en 35 à 90 ms. Les règles :
   - redirections suivies à la main et revérifiées (R1) ;
   - HTML seulement, 3 Mo, 15 s par page ;
   - 4 pages à la fois, 180 au plus, langues en alternance ;
   - échéance globale de 4 minutes ;
   - 400 caractères minimum.
8. **Dédoublonnage.** Les articles d'une même URL normalisée sont fusionnés :
   - métadonnées dans l'ordre RSS, puis TheNewsAPI, Exa et Webz ;
   - premier chapô non vide et date la plus ancienne ;
   - texte gardé seulement pour un domaine `full`.

   Les articles sont ensuite regroupés par `/similar` et par la similarité de Jaccard des titres (trigrammes de caractères, ≥ 0,6, titres d'au moins 20 caractères), avec une union-find déterministe. Le `groupId` vaut `g-` suivi d'une empreinte. Tri : langue, taille du groupe, groupe, id.
9. **Édition allégée (§12).** Elle est signalée dans `collect-report.json` (`perLang.<lang>.light`, vrai sous 15 textes lus), sans changer le schéma.
10. **Codes de sortie.**
    - `brief:collect` : 0 si au moins un article, 2 sinon.
    - `brief:context` : 0 si `context.json` est écrit, 2 sinon. Un store en erreur ou muet ne donne pas de `context.json`, car un contexte faux ferait dupliquer des Threads. Le store vide écrit un contexte vide avec un avertissement.
    - `check:thenewsapi` : 0 si TheNewsAPI est en temps réel, 1 s'il faut passer à Exa, 2 si la vérification est impossible.
11. **§16.** Le verdict est `exa` dès qu'une langue a un article le plus récent de plus de 2 h, ou aucun article. Le choix reste humain : il se règle dans `pipeline/config/collect.json` (`primary`), sans bascule automatique.
12. **En-têtes HTTP vers les médias.** `user-agent: Mozilla/5.0 (compatible; DailyBrief/1.0)` (identifiant, sans donnée personnelle) et des `accept` qui finissent par `*/*`. Vérifié le 11/11/2026 : NPR répond 403 sans agent, El Salto répond 406 à un `accept` strict.
13. **R12.** La date retenue est celle du dernier événement, sinon `updatedAt` en date de Paris. Un Thread est fermé à 21 jours pleins. `staleCutoff` est prêt pour la requête SQL du lot 4. Les variables `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont réservées au lot 4.

### Points non vérifiables ici

- **Temps réel de TheNewsAPI.** Sans clé, impossible à vérifier : lancer `npm run check:thenewsapi` à la mise en place (lot 7, §14).
- **Webz News API Lite.** Le 11/11/2026, sa documentation était introuvable en ligne ; le site présente désormais des crédits gratuits sur `/api/news`. L'endpoint `newsApiLite` et la forme `posts[]` suivent la spec ; à confirmer avec le jeton.
- **Texte Exa.** La documentation dit que le texte n'est renvoyé que sur demande. S'il arrivait quand même pour un domaine qui n'est pas `full`, il serait écarté et compté dans `discardedTexts`.
- **Quota TheNewsAPI.** L'heure de remise à zéro est supposée à minuit UTC.
- **democrata.es.** Il répond 403 à son flux (et sans doute à ses pages). Il reste dans `feeds.json` et son échec ne donne qu'un avertissement ; à revoir lors de la revérification mensuelle de la liste blanche.

## Structure des fichiers

```
pipeline/lib/date.ts                  + addDays, daysBetween
pipeline/collect/
  redact.ts                           masquage des jetons (URL et secrets connus)
  http.ts                             HttpFetch injectable, HttpError, délai, lecture bornée, en-têtes
  limit.ts                            mapLimit (concurrence bornée)
  config.ts                           schéma de collect.json, plafond 90
  rubriques.ts                        schéma de rubriques.json, paramètre search
  budget.ts                           RequestBudget (postes + total)
  usage-ledger.ts                     compte quotidien TheNewsAPI entre relances
  types.ts                            SourceRun, SourceContext, Candidate
  breaker.ts                          disjoncteur 401/402/403/429/délai
  article.ts                          makeArticle : normalisation + garde R1 d'entrée
  thenewsapi.ts                       /v1/news/top, /v1/news/similar, collecte budgétée
  exa.ts                              POST /search, contents seulement pour les domaines full
  webz.ts                             secours News API Lite
  rss.ts                              flux RSS 2.0 et Atom (métadonnées)
  fulltext.ts                         Readability + linkedom, domaines full seulement
  dedupe.ts                           fusion par URL, groupes /similar + Jaccard
  run-collect.ts                      orchestration, raw.json, collect-report.json
  cli.ts                              npm run brief:collect
  realtime.ts                         vérification §16 (logique et affichage)
  check-thenewsapi.ts                 npm run check:thenewsapi
pipeline/context/
  store.ts                            interface ContextStore, store vide
  stale.ts                            R12 : 21 jours, isStale, staleCutoff
  memory-store.ts                     store en mémoire (référence du lot 4, tests)
  select-store.ts                     choix du store selon l'environnement
  run-context.ts                      context.json, context-report.json
  cli.ts                              npm run brief:context
pipeline/config/collect.json          réglages (primary, fenêtre, budget, plafonds)
pipeline/config/feeds.json            flux des domaines full et feed
pipeline/editorial/rubriques.json     rubrique → catégories, mots-clés, requêtes Exa
pipeline/test/run-cli.ts              lance un CLI sans .env ni secret
pipeline/test/lib/date.test.ts
pipeline/test/collect/                fake-http.ts, source-context.ts + 15 fichiers de test
pipeline/test/context/                memory-store, run-context, cli
fixtures/api/                         réponses construites TheNewsAPI, Exa, Webz, RSS, Atom, HTML
```

---

### Tâche 1 : dates, transport HTTP borné et masquage des secrets

**Fichiers :**
- Modifier : `pipeline/lib/date.ts`
- Créer : `pipeline/collect/redact.ts`, `pipeline/collect/http.ts`, `pipeline/collect/limit.ts`, `pipeline/test/collect/fake-http.ts`
- Test : `pipeline/test/lib/date.test.ts`, `pipeline/test/collect/http.test.ts`, `pipeline/test/collect/limit.test.ts`

Comportement attendu :
- **Dates.** `addDays` et `daysBetween` calculent sur le calendrier, sans fuseau, et lèvent une erreur sur une date inexistante (« 2026-02-30 »).
- **Transport.** `HttpFetch` est le sous-ensemble de `fetch` utilisé par la collecte. `fetchJson` borne le temps et lève `HttpError` sur un statut qui n'est pas 2xx ; le message ne contient que l'URL masquée.
- **Lecture bornée.** `readCapped` refuse un corps trop lourd, qu'il soit annoncé par `content-length` ou réel. Il lit un flux morceau par morceau et l'abandonne dès la limite dépassée.
- **Masquage.** `redactUrl` masque `api_token`, `token`, `api_key`, `apikey` et `key`. `stripSecrets` retire chaque secret connu, tel quel ou encodé pour une URL.
- **Concurrence.** `mapLimit` borne la concurrence et garde l'ordre des résultats.

- [ ] **Étape 1 : écrire les tests et le faux `fetch`**

Le faux `fetch` associe le plus long préfixe d'URL à une réponse. Il peut simuler un serveur muet (`hang`), une erreur réseau ou des en-têtes, et il enregistre chaque appel.

`pipeline/test/collect/fake-http.ts` :

```ts
import type { HttpFetch, HttpInit } from '../../collect/http';

export type Reply = {
  status?: number;
  json?: unknown;
  /** Corps texte (HTML, XML) ; encodé en UTF-8. */
  body?: string;
  type?: string | null;
  headers?: Record<string, string>;
  /** Ne répond jamais : seul le signal d'interruption termine l'appel. */
  hang?: boolean;
  /** L'appel lève cette erreur (erreur réseau). */
  error?: Error;
};

export type Call = { url: string; method: string; headers?: Record<string, string>; body?: string; redirect?: string };

/** Faux `fetch` : associe le plus long préfixe d'URL à une réponse (ou à une fonction) et enregistre les appels. */
export function fakeHttp(routes: Record<string, Reply | ((url: string, init?: HttpInit) => Reply)>) {
  const calls: Call[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers, body: init?.body, redirect: init?.redirect });
    const key = keys.find((k) => url.startsWith(k));
    const route = key === undefined ? { status: 404 } : routes[key];
    const reply = typeof route === 'function' ? route(url, init) : route;
    if (reply.hang) {
      await new Promise((_, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }
    if (reply.error) throw reply.error;
    const status = reply.status ?? 200;
    const bytes = new TextEncoder().encode(reply.body ?? (reply.json === undefined ? '' : JSON.stringify(reply.json)));
    const headers: Record<string, string> = {};
    const type = 'type' in reply ? reply.type : reply.body !== undefined ? 'text/html; charset=utf-8' : 'application/json';
    if (type) headers['content-type'] = type;
    for (const [k, v] of Object.entries(reply.headers ?? {})) headers[k.toLowerCase()] = v;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      json: async () => (reply.json !== undefined ? reply.json : JSON.parse(reply.body ?? '')),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };
  return { fetch, calls };
}
```

`pipeline/test/lib/date.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../../lib/date';

describe('calcul de dates', () => {
  it('addDays et daysBetween suivent le calendrier, changement de mois et d’heure compris', () => {
    expect(addDays('2026-11-06', -1)).toBe('2026-11-05');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(daysBetween('2026-10-16', '2026-11-06')).toBe(21);
    expect(daysBetween('2026-11-06', '2026-11-05')).toBe(-1);
  });

  it('lève sur une date inexistante ou mal formée', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow('date illisible');
    expect(() => daysBetween('hier', '2026-11-06')).toThrow('date illisible');
  });
});
```

`pipeline/test/collect/http.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { BodyError, decodeBody, fetchJson, HttpError, readCapped } from '../../collect/http';
import { redactText, redactUrl } from '../../collect/redact';
import { fakeHttp } from './fake-http';

describe('masquage des secrets', () => {
  it('masque les jetons dans les URL (TheNewsAPI, Webz)', () => {
    expect(redactUrl('https://api.thenewsapi.com/v1/news/top?api_token=SECRET123&language=fr')).toBe(
      'https://api.thenewsapi.com/v1/news/top?api_token=***&language=fr',
    );
    expect(redactUrl('https://api.webz.io/newsApiLite?q=x&token=abc-def')).toBe('https://api.webz.io/newsApiLite?q=x&token=***');
  });

  it('masque un secret connu partout, même encodé', () => {
    const msg = redactText('échec : clé k3y/+sec refusée (k3y%2F%2Bsec)', ['k3y/+sec', undefined, '']);
    expect(msg).toBe('échec : clé *** refusée (***)');
  });
});

describe('HTTP', () => {
  it('fetchJson lève HttpError sans le jeton dans le message', async () => {
    const { fetch } = fakeHttp({ 'https://api.x/': { status: 429, json: {} } });
    const err = await fetchJson(fetch, 'https://api.x/top?api_token=SECRET', { timeoutMs: 1000 }).then(() => null, (e: HttpError) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err?.status).toBe(429);
    expect(err?.message).not.toContain('SECRET');
  });

  it('fetchJson interrompt une réponse qui ne vient pas', async () => {
    const { fetch } = fakeHttp({ 'https://api.x/': { hang: true } });
    const err = await fetchJson(fetch, 'https://api.x/top', { timeoutMs: 20 }).then(() => null, (e: Error) => e);
    expect(err?.name).toBe('TimeoutError');
  });

  it('readCapped refuse un corps trop lourd, déclaré ou réel', async () => {
    const { fetch } = fakeHttp({
      'https://a/declared': { body: 'x', headers: { 'content-length': '999999' } },
      'https://a/real': { body: 'x'.repeat(50) },
    });
    await expect(readCapped(await fetch('https://a/declared'), 10)).rejects.toBeInstanceOf(BodyError);
    await expect(readCapped(await fetch('https://a/real'), 10)).rejects.toBeInstanceOf(BodyError);
    expect((await readCapped(await fetch('https://a/real'), 100)).length).toBe(50);
  });

  it('readCapped arrête un flux sans fin dès la limite dépassée', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const res = { ok: true, status: 200, headers: { get: () => null }, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0), body: endless };
    await expect(readCapped(res, 10_000)).rejects.toThrow('corps trop lourd (plus de 10000 octets)');
    expect(pulled).toBeLessThan(20);
    const small = new Response('café').body;
    expect((await readCapped({ ...res, body: small }, 100)).toString('utf8')).toBe('café');
  });

  it('decodeBody suit le charset annoncé', () => {
    expect(decodeBody(Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'text/html; charset=iso-8859-1')).toBe('café');
    expect(decodeBody(Buffer.from('café'), 'text/html; charset=inconnu')).toBe('café');
  });
});
```

`pipeline/test/collect/limit.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { mapLimit } from '../../collect/limit';

describe('mapLimit', () => {
  it('borne la concurrence et garde l’ordre', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });

  it('n’appelle rien sur une liste vide', async () => {
    let calls = 0;
    expect(await mapLimit([], 4, async () => ++calls)).toEqual([]);
    expect(calls).toBe(0);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/lib/date.test.ts pipeline/test/collect/http.test.ts pipeline/test/collect/limit.test.ts`
Attendu : ÉCHEC. `date.test.ts` donne 2 échecs « TypeError: (0 , addDays) is not a function » ; `http.test.ts` et `limit.test.ts` donnent « Cannot find module '../../collect/http' » et « … '../../collect/limit' ».

- [ ] **Étape 3 : compléter `pipeline/lib/date.ts`**

Remplacer tout le fichier par :

`pipeline/lib/date.ts` :

```ts
/** Date du jour à Paris au format AAAA-MM-JJ. */
export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Instant UTC de minuit d'une date AAAA-MM-JJ réelle ; lève sinon (« 2026-02-30 » compris). */
function dayStart(date: string): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) throw new Error(`date illisible : « ${date} »`);
  return t;
}

/** Date AAAA-MM-JJ décalée de `days` jours (calendrier, sans fuseau). */
export function addDays(date: string, days: number): string {
  return new Date(dayStart(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Nombre de jours de `from` à `to` (dates AAAA-MM-JJ) ; négatif si `to` précède `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayStart(to) - dayStart(from)) / 86_400_000);
}
```

- [ ] **Étape 4 : écrire le masquage, le transport et `mapLimit`**

`pipeline/collect/redact.ts` :

```ts
/** Paramètres de requête qui portent un secret (TheNewsAPI : api_token ; Webz : token). */
const SECRET_PARAM = /([?&](?:api_token|token|api_key|apikey|key)=)[^&#\s"']*/gi;

/** URL sans secret : la valeur des paramètres sensibles est remplacée par `***`. */
export function redactUrl(url: string): string {
  return url.replace(SECRET_PARAM, '$1***');
}

/** Chaque secret connu (4 caractères ou plus, tel quel ou encodé pour une URL) remplacé par `***`. */
export function stripSecrets(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 4) continue;
    for (const form of new Set([s, encodeURIComponent(s)])) out = out.split(form).join('***');
  }
  return out;
}

/** Message sans secret : paramètres sensibles masqués dans toute URL, puis secrets connus retirés. */
export function redactText(text: string, secrets: (string | undefined)[]): string {
  return stripSecrets(redactUrl(text), secrets);
}
```

`pipeline/collect/http.ts` :

```ts
import { redactUrl } from './redact';

export type HttpResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Corps en flux (fetch de Node) : permet d'arrêter la lecture dès que la taille maximale est dépassée. */
  body?: ReadableStream<Uint8Array> | null;
};

export type HttpInit = {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** `manual` : la redirection est renvoyée telle quelle (statut 3xx et en-tête `location`). */
  redirect?: 'follow' | 'manual';
};

/** Agent des requêtes vers les médias (flux et pages) : identifié, sans aucune donnée personnelle. */
export const USER_AGENT = 'Mozilla/5.0 (compatible; DailyBrief/1.0)';
/** En-têtes Accept tolérants : le type joker final (toute réponse acceptée) évite les 406 de certains serveurs. */
export const ACCEPT_FEED = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8';
export const ACCEPT_HTML = 'text/html, application/xhtml+xml;q=0.9, */*;q=0.8';

/** Sous-ensemble de `fetch` utilisé par la collecte : injectable dans les tests, aucun appel réseau réel. */
export type HttpFetch = (url: string, init?: HttpInit) => Promise<HttpResponse>;

/** Réponse HTTP en erreur ; le message ne contient que l'URL masquée (jamais de jeton). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} (${redactUrl(url)})`);
    this.name = 'HttpError';
  }
}

/** Corps trop lourd ou type de contenu refusé. */
export class BodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyError';
  }
}

/** Message d'une erreur quelconque. */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/** Signal qui expire après `timeoutMs`, ou plus tôt si `parent` est interrompu. */
export function deadline(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([t, parent]) : t;
}

/** Appel JSON borné dans le temps : lève HttpError si le statut n'est pas 2xx. */
export async function fetchJson(fetch: HttpFetch, url: string, init: HttpInit & { timeoutMs: number }): Promise<unknown> {
  const { timeoutMs, ...rest } = init;
  const signal = deadline(timeoutMs, rest.signal);
  const res = await fetch(url, { ...rest, signal });
  if (!res.ok) throw new HttpError(res.status, url);
  return await res.json();
}

/**
 * Lit un corps d'au plus `maxBytes` octets : en-tête `content-length` d'abord, puis taille réelle.
 * Un corps en flux est lu morceau par morceau et abandonné dès que la limite est dépassée.
 */
export async function readCapped(res: HttpResponse, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyError(`corps trop lourd (${declared} octets)`);
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyError(`corps trop lourd (plus de ${maxBytes} octets)`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new BodyError(`corps trop lourd (${buf.length} octets)`);
  return buf;
}

/** Décode un corps texte selon le `charset` de l'en-tête (UTF-8 par défaut ou si le jeu est inconnu). */
export function decodeBody(buf: Buffer, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** Type MIME sans paramètres, en minuscules. */
export function mimeOf(res: HttpResponse): string {
  return (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
}
```

`pipeline/collect/limit.ts` :

```ts
/** Applique `fn` à chaque élément, au plus `limit` à la fois ; l'ordre des résultats suit celui des éléments. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run pipeline/test/lib/date.test.ts pipeline/test/collect/http.test.ts pipeline/test/collect/limit.test.ts && npm run typecheck`
Attendu : `Tests  11 passed (11)` (2 + 7 + 2), typage propre.

Commande : `npm test`
Attendu : `Test Files  33 passed (33)`, `Tests  263 passed (263)`.

- [ ] **Étape 6 : commit**

```bash
git add pipeline/lib/date.ts pipeline/collect pipeline/test/lib/date.test.ts pipeline/test/collect
git commit -m "feat(collect): dates, transport HTTP borné et masquage des secrets"
```

---

### Tâche 2 : configuration, rubriques, budget de requêtes et disjoncteur

**Fichiers :**
- Créer : `pipeline/collect/config.ts`, `pipeline/config/collect.json`, `pipeline/collect/rubriques.ts`, `pipeline/editorial/rubriques.json`, `pipeline/collect/budget.ts`, `pipeline/collect/usage-ledger.ts`, `pipeline/collect/types.ts`, `pipeline/collect/breaker.ts`, `pipeline/test/collect/source-context.ts`
- Test : `pipeline/test/collect/config.test.ts`, `pipeline/test/collect/breaker.test.ts`

Comportement attendu :
- **`collect.json`.** Il est validé strictement : une clé mal orthographiée est refusée. Le budget TheNewsAPI ne peut pas dépasser 90 au total, et la somme des postes ne peut pas dépasser le total. Les domaines Exa « avec texte » doivent tous être `full` (test).
- **`rubriques.json`.** Il couvre les 9 rubriques dans les 3 langues. `searchOf` construit le paramètre `search` de TheNewsAPI : mots-clés reliés par `|` (OU), expressions entre guillemets.
- **Budget et compteur.** `RequestBudget` refuse une requête quand le poste ou le total est épuisé. `usage-ledger` reprend le compte du jour, repart de zéro le lendemain et ferme le quota si le fichier est illisible.
- **Disjoncteur.** `Breaker` se coupe sur 401, 402, 403, 429 et sur un délai dépassé, mais pas sur une erreur 500 ni sur une réponse illisible.

- [ ] **Étape 1 : écrire l'aide de test et les tests**

`source-context.ts` construit un `SourceContext` sur la vraie configuration, à l'heure de la routine (05:13 à Paris, soit 04:13 UTC).

`pipeline/test/collect/source-context.ts` :

```ts
import { readFileSync } from 'node:fs';
import { loadCollectConfig, type CollectConfig } from '../../collect/config';
import type { HttpFetch } from '../../collect/http';
import { loadRubriques } from '../../collect/rubriques';
import type { SourceContext } from '../../collect/types';
import { loadWhitelist } from '../../lib/whitelist';
import { repoPath, WHITELIST_PATH } from '../helpers';

export const NOW = new Date('2026-11-06T04:13:00Z');
export const CONFIG_PATH = repoPath('pipeline/config/collect.json');
export const RUBRIQUES_PATH = repoPath('pipeline/editorial/rubriques.json');
export const FEEDS_PATH = repoPath('pipeline/config/feeds.json');

export const apiFixture = (name: string): any => JSON.parse(readFileSync(repoPath(`fixtures/api/${name}`), 'utf8'));

/** Contexte de source construit sur la vraie configuration, à l'heure de la routine (05:13 Paris). */
export function testContext(fetch: HttpFetch, patch?: (c: CollectConfig) => void): SourceContext {
  const config = loadCollectConfig(CONFIG_PATH);
  patch?.(config);
  return {
    fetch,
    whitelist: loadWhitelist(WHITELIST_PATH),
    config,
    rubriques: loadRubriques(RUBRIQUES_PATH),
    now: NOW,
    windowStart: new Date(NOW.getTime() - config.windowHours * 3_600_000),
  };
}
```

`pipeline/test/collect/config.test.ts` :

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUBRIC_KEYS } from '@daily-brief/schema';
import { RequestBudget } from '../../collect/budget';
import { CollectConfigSchema, loadCollectConfig } from '../../collect/config';
import { loadRubriques, searchOf } from '../../collect/rubriques';
import { readDailyUsage, utcDay, writeDailyUsage } from '../../collect/usage-ledger';
import { lookupDomain, loadWhitelist } from '../../lib/whitelist';
import { repoPath, WHITELIST_PATH } from '../helpers';

const CONFIG_PATH = repoPath('pipeline/config/collect.json');

describe('collect.json', () => {
  it('se charge et respecte le budget de la spec §4.1 (FR 25, EN 20, ES 20, similar 25, total 90)', () => {
    const c = loadCollectConfig(CONFIG_PATH);
    expect(c.primary).toBe('thenewsapi');
    expect(c.lightThreshold).toBe(15);
    expect(c.thenewsapi.budget).toEqual({ total: 90, fr: 25, en: 20, es: 20, similar: 25 });
  });

  it('refuse un total au-delà de 90, des postes qui dépassent le total et une clé inconnue', () => {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const over = structuredClone(raw);
    over.thenewsapi.budget.total = 95;
    expect(CollectConfigSchema.safeParse(over).success).toBe(false);
    const sum = structuredClone(raw);
    sum.thenewsapi.budget.similar = 40;
    expect(CollectConfigSchema.safeParse(sum).success).toBe(false);
    expect(CollectConfigSchema.safeParse({ ...raw, primery: 'exa' }).success).toBe(false);
  });

  it('R1 : Exa ne demande le texte que sur des domaines au statut full', () => {
    const wl = loadWhitelist(WHITELIST_PATH);
    const c = loadCollectConfig(CONFIG_PATH);
    for (const domains of Object.values(c.exa.fullDomains)) {
      for (const d of domains) expect(lookupDomain(wl, `https://${d}/`)?.status, d).toBe('full');
    }
  });
});

describe('rubriques.json', () => {
  it('couvre les 9 rubriques dans les 3 langues', () => {
    const r = loadRubriques(repoPath('pipeline/editorial/rubriques.json'));
    expect(Object.keys(r).sort()).toEqual([...RUBRIC_KEYS].sort());
    for (const k of RUBRIC_KEYS) for (const l of ['fr', 'en', 'es'] as const) expect(r[k].keywords[l].length).toBeGreaterThan(0);
  });

  it('construit le paramètre search en OU, expressions entre guillemets', () => {
    const r = loadRubriques(repoPath('pipeline/editorial/rubriques.json'));
    expect(searchOf(r.pol, 'fr')).toBeNull();
    expect(searchOf(r.dro, 'fr')).toBe('justice | tribunal | procès | "Conseil constitutionnel" | loi | "Cour de cassation"');
  });
});

describe('budget de requêtes', () => {
  it('plafonne chaque poste et le total', () => {
    const b = new RequestBudget({ fr: 2, similar: 5 }, 3);
    expect([b.take('fr'), b.take('fr'), b.take('fr')]).toEqual([true, true, false]);
    expect(b.remaining('similar')).toBe(1);
    expect([b.take('similar'), b.take('similar')]).toEqual([true, false]);
    expect(b.usage()).toEqual({ fr: 2, similar: 1 });
    expect(b.spentTotal).toBe(3);
  });
});

describe('compteur quotidien TheNewsAPI', () => {
  it('reprend le compte du jour, repart de zéro le lendemain, se ferme si le fichier est illisible', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const path = join(dir, 'thenewsapi-usage.json');
    expect(readDailyUsage(path, '2026-11-06', 90)).toEqual({ used: 0 });
    writeDailyUsage(path, '2026-11-06', 42);
    expect(readDailyUsage(path, '2026-11-06', 90)).toEqual({ used: 42 });
    expect(readDailyUsage(path, '2026-11-07', 90)).toEqual({ used: 0 });
    writeFileSync(path, '{');
    const broken = readDailyUsage(path, '2026-11-06', 90);
    expect(broken.used).toBe(90);
    expect(broken.error).toMatch(/illisible/);
    expect(utcDay(new Date('2026-11-06T04:13:00+01:00'))).toBe('2026-11-06');
  });
});
```

`pipeline/test/collect/breaker.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { Breaker, recordFailure } from '../../collect/breaker';
import { HttpError } from '../../collect/http';
import { emptyRun } from '../../collect/types';

describe('disjoncteur', () => {
  it('se coupe sur 401, 402, 403, 429 et délai dépassé, pas sur 500 ni sur une réponse illisible', () => {
    for (const s of [401, 402, 403, 429]) expect(new Breaker().trip(new HttpError(s, 'https://a'))).toBe(true);
    const timeout = new Error('t');
    timeout.name = 'TimeoutError';
    expect(new Breaker().trip(timeout)).toBe(true);
    const b = new Breaker();
    expect(b.trip(new HttpError(500, 'https://a'))).toBe(false);
    expect(b.trip(new Error('JSON invalide'))).toBe(false);
    expect(b.open).toBe(false);
  });

  it('recordFailure note l’erreur et la coupure dans le bilan', () => {
    const run = emptyRun();
    const b = new Breaker();
    expect(recordFailure(run, b, 'top fr/pol', new HttpError(500, 'https://api/top?api_token=S'))).toBe(false);
    expect(recordFailure(run, b, 'top fr/eco', new HttpError(429, 'https://api/top?api_token=S'))).toBe(true);
    expect(run.stoppedBy).toBe('HTTP 429');
    expect(run.errors).toEqual(['top fr/pol : HTTP 500 (https://api/top?api_token=***)', 'top fr/eco : HTTP 429 (https://api/top?api_token=***) — source coupée']);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/collect/config.test.ts pipeline/test/collect/breaker.test.ts`
Attendu : ÉCHEC, « Cannot find module '../../collect/budget' » et « … '../../collect/breaker' ».

- [ ] **Étape 3 : écrire la configuration**

`pipeline/collect/config.ts` :

```ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const PerLang = <T extends z.ZodType>(t: T) => z.strictObject({ fr: t, en: t, es: t });
const Ms = z.number().int().positive();

/** Plafond quotidien TheNewsAPI : 90 requêtes sur les 100 du plan gratuit (spec §4.1). */
export const THENEWSAPI_DAILY_CAP = 90;

const BudgetSchema = z
  .strictObject({
    total: z.number().int().min(0).max(THENEWSAPI_DAILY_CAP),
    fr: z.number().int().min(0),
    en: z.number().int().min(0),
    es: z.number().int().min(0),
    similar: z.number().int().min(0),
  })
  .refine((b) => b.fr + b.en + b.es + b.similar <= b.total, { message: 'la somme des postes dépasse le total' });

export const CollectConfigSchema = z.strictObject({
  note: z.string().optional(),
  primary: z.enum(['thenewsapi', 'exa']),
  windowHours: z.number().int().min(1).max(72),
  lightThreshold: z.number().int().min(1),
  thenewsapi: z.strictObject({
    limit: z.number().int().min(1).max(100),
    timeoutMs: Ms,
    locales: PerLang(z.string().regex(/^[a-z]{2}(,[a-z]{2})*$/)),
    budget: BudgetSchema,
  }),
  exa: z.strictObject({
    timeoutMs: Ms,
    numResults: z.number().int().min(1).max(100),
    maxRequests: z.number().int().min(0),
    fullDomains: PerLang(z.array(z.string().min(1))),
  }),
  webz: z.strictObject({
    timeoutMs: Ms,
    fallbackBelow: z.number().int().min(0),
    maxRequests: z.number().int().min(0),
    queries: PerLang(z.string().min(1)),
  }),
  rss: z.strictObject({ timeoutMs: Ms, maxBytes: z.number().int().positive(), maxItemsPerFeed: z.number().int().positive() }),
  fulltext: z.strictObject({
    timeoutMs: Ms,
    maxBytes: z.number().int().positive(),
    minChars: z.number().int().min(0),
    concurrency: z.number().int().min(1).max(16),
    maxFetches: z.number().int().min(0),
    deadlineMs: Ms,
  }),
});

export type CollectConfig = z.infer<typeof CollectConfigSchema>;
export type BudgetBucket = 'fr' | 'en' | 'es' | 'similar';

export function loadCollectConfig(path: string): CollectConfig {
  return CollectConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
```

`pipeline/config/collect.json` :

```json
{
  "note": "Réglages de brief:collect. primary : découverte principale (thenewsapi, ou exa si npm run check:thenewsapi montre que TheNewsAPI n'est pas en temps réel, spec §16).",
  "primary": "thenewsapi",
  "windowHours": 24,
  "lightThreshold": 15,
  "thenewsapi": {
    "limit": 3,
    "timeoutMs": 10000,
    "locales": { "fr": "fr", "en": "us,gb", "es": "es" },
    "budget": { "total": 90, "fr": 25, "en": 20, "es": 20, "similar": 25 }
  },
  "exa": {
    "timeoutMs": 15000,
    "numResults": 10,
    "maxRequests": 60,
    "fullDomains": {
      "fr": ["fr.euronews.com", "sudradio.fr"],
      "en": ["www.euronews.com", "aljazeera.com", "cbsnews.com", "pbs.org"],
      "es": ["es.euronews.com", "eldiario.es", "elsaltodiario.com", "alicanteplaza.es", "democrata.es"]
    }
  },
  "webz": {
    "timeoutMs": 10000,
    "fallbackBelow": 10,
    "maxRequests": 3,
    "queries": {
      "fr": "language:french thread.country:FR",
      "en": "language:english (thread.country:US OR thread.country:GB)",
      "es": "language:spanish thread.country:ES"
    }
  },
  "rss": { "timeoutMs": 10000, "maxBytes": 4000000, "maxItemsPerFeed": 30 },
  "fulltext": { "timeoutMs": 15000, "maxBytes": 3000000, "minChars": 400, "concurrency": 4, "maxFetches": 180, "deadlineMs": 240000 }
}
```

- [ ] **Étape 4 : écrire les rubriques**

Les catégories sont celles de TheNewsAPI. `searchKeywords: false` laisse la catégorie seule (politique, sport) ; `true` ajoute les mots-clés pour distinguer des rubriques qui partagent une catégorie.

`pipeline/collect/rubriques.ts` :

```ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { RUBRIC_KEYS, type Lang, type RubricKey } from '@daily-brief/schema';

/** Catégories acceptées par TheNewsAPI (`categories`). */
export const THENEWSAPI_CATEGORIES = ['general', 'science', 'sports', 'business', 'health', 'entertainment', 'tech', 'politics', 'food', 'travel'] as const;

const PerLang = <T extends z.ZodType>(t: T) => z.strictObject({ fr: t, en: t, es: t });

const RubricSchema = z.strictObject({
  categories: z.array(z.enum(THENEWSAPI_CATEGORIES)).min(1),
  searchKeywords: z.boolean(),
  keywords: PerLang(z.array(z.string().min(1)).min(1)),
  exaQuery: PerLang(z.string().min(1)),
});

const RubriquesSchema = z.strictObject({
  note: z.string().optional(),
  rubrics: z.strictObject(Object.fromEntries(RUBRIC_KEYS.map((k) => [k, RubricSchema])) as Record<RubricKey, typeof RubricSchema>),
});

export type Rubric = z.infer<typeof RubricSchema>;
export type Rubriques = Record<RubricKey, Rubric>;

export function loadRubriques(path: string): Rubriques {
  return RubriquesSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).rubrics;
}

/** Paramètre `search` de TheNewsAPI : mots-clés en OU, expressions entre guillemets ; null si la rubrique n'en utilise pas. */
export function searchOf(rubric: Rubric, lang: Lang): string | null {
  if (!rubric.searchKeywords) return null;
  return rubric.keywords[lang].map((k) => (/\s/.test(k) ? `"${k.replace(/"/g, '')}"` : k)).join(' | ');
}
```

`pipeline/editorial/rubriques.json` :

```json
{
  "note": "Correspondance rubriques → collecte (lot 3). categories : catégories TheNewsAPI ; searchKeywords : ajoute keywords au paramètre search de TheNewsAPI (OU logique) ; keywords : mots-clés par langue ; exaQuery : requête sémantique Exa par langue. Le lot 7 affine ces listes.",
  "rubrics": {
    "pol": {
      "categories": ["politics"],
      "searchKeywords": false,
      "keywords": {
        "fr": ["gouvernement", "Assemblée nationale", "Sénat", "Premier ministre", "réforme", "société"],
        "en": ["Congress", "White House", "Parliament", "Downing Street", "election", "policy"],
        "es": ["Gobierno", "Congreso", "Moncloa", "elecciones", "partido", "sociedad"]
      },
      "exaQuery": {
        "fr": "actualité politique et société en France aujourd'hui",
        "en": "US and UK politics and society news today",
        "es": "actualidad política y sociedad en España hoy"
      }
    },
    "int": {
      "categories": ["general", "politics"],
      "searchKeywords": true,
      "keywords": {
        "fr": ["diplomatie", "guerre", "sommet", "ONU", "Union européenne", "conflit"],
        "en": ["diplomacy", "war", "summit", "United Nations", "foreign policy", "conflict"],
        "es": ["diplomacia", "guerra", "cumbre", "ONU", "Unión Europea", "conflicto"]
      },
      "exaQuery": {
        "fr": "actualité internationale et géopolitique",
        "en": "world news and geopolitics",
        "es": "actualidad internacional y geopolítica desde España"
      }
    },
    "eco": {
      "categories": ["business"],
      "searchKeywords": true,
      "keywords": {
        "fr": ["inflation", "croissance", "chômage", "budget", "BCE", "dette"],
        "en": ["inflation", "economy", "jobs", "Federal Reserve", "Bank of England", "budget"],
        "es": ["inflación", "economía", "paro", "presupuestos", "BCE", "deuda"]
      },
      "exaQuery": {
        "fr": "actualité économique en France et en Europe",
        "en": "US and UK economy news",
        "es": "actualidad económica en España"
      }
    },
    "ent": {
      "categories": ["business", "tech"],
      "searchKeywords": true,
      "keywords": {
        "fr": ["entreprise", "PDG", "rachat", "résultats", "salariés", "start-up"],
        "en": ["company", "CEO", "merger", "earnings", "workers", "startup"],
        "es": ["empresa", "consejero delegado", "fusión", "resultados", "plantilla", "startup"]
      },
      "exaQuery": {
        "fr": "actualité des entreprises et du management",
        "en": "business and corporate management news",
        "es": "actualidad de empresas y gestión en España"
      }
    },
    "dro": {
      "categories": ["general", "politics"],
      "searchKeywords": true,
      "keywords": {
        "fr": ["justice", "tribunal", "procès", "Conseil constitutionnel", "loi", "Cour de cassation"],
        "en": ["court", "judge", "trial", "Supreme Court", "lawsuit", "ruling"],
        "es": ["justicia", "tribunal", "juicio", "Tribunal Supremo", "Tribunal Constitucional", "sentencia"]
      },
      "exaQuery": {
        "fr": "actualité du droit et de la justice en France",
        "en": "US and UK law and courts news",
        "es": "actualidad judicial y del derecho en España"
      }
    },
    "tec": {
      "categories": ["tech"],
      "searchKeywords": false,
      "keywords": {
        "fr": ["intelligence artificielle", "numérique", "cybersécurité", "données", "réseaux sociaux", "semi-conducteurs"],
        "en": ["artificial intelligence", "AI", "cybersecurity", "data", "social media", "chips"],
        "es": ["inteligencia artificial", "digital", "ciberseguridad", "datos", "redes sociales", "semiconductores"]
      },
      "exaQuery": {
        "fr": "actualité tech et intelligence artificielle",
        "en": "technology and artificial intelligence news",
        "es": "actualidad de tecnología e inteligencia artificial"
      }
    },
    "env": {
      "categories": ["science"],
      "searchKeywords": true,
      "keywords": {
        "fr": ["climat", "énergie", "nucléaire", "pollution", "sécheresse", "biodiversité"],
        "en": ["climate", "energy", "emissions", "pollution", "drought", "renewables"],
        "es": ["clima", "energía", "emisiones", "contaminación", "sequía", "renovables"]
      },
      "exaQuery": {
        "fr": "actualité environnement, climat et énergie",
        "en": "environment, climate and energy news",
        "es": "actualidad de medio ambiente, clima y energía en España"
      }
    },
    "cul": {
      "categories": ["entertainment"],
      "searchKeywords": false,
      "keywords": {
        "fr": ["cinéma", "musée", "livre", "exposition", "festival", "patrimoine"],
        "en": ["film", "museum", "book", "exhibition", "festival", "heritage"],
        "es": ["cine", "museo", "libro", "exposición", "festival", "patrimonio"]
      },
      "exaQuery": {
        "fr": "actualité culturelle en France",
        "en": "culture and arts news in the US and UK",
        "es": "actualidad cultural en España"
      }
    },
    "spo": {
      "categories": ["sports"],
      "searchKeywords": false,
      "keywords": {
        "fr": ["football", "rugby", "tennis", "Jeux olympiques", "cyclisme", "Ligue 1"],
        "en": ["football", "NFL", "NBA", "Premier League", "tennis", "Olympics"],
        "es": ["fútbol", "LaLiga", "baloncesto", "tenis", "ciclismo", "Juegos Olímpicos"]
      },
      "exaQuery": {
        "fr": "actualité sportive",
        "en": "sports news from the US and UK",
        "es": "actualidad deportiva en España"
      }
    }
  }
}
```

- [ ] **Étape 5 : écrire le budget, le compteur quotidien, les types et le disjoncteur**

`pipeline/collect/budget.ts` :

```ts
/**
 * Budget de requêtes : un plafond par poste et un plafond total. `take` réserve une requête
 * avant l'appel ; une requête refusée n'est jamais envoyée.
 */
export class RequestBudget<K extends string> {
  private readonly used = new Map<K, number>();
  private spent = 0;

  constructor(
    private readonly limits: Record<K, number>,
    private readonly total: number,
  ) {}

  /** Réserve une requête du poste ; faux si le poste ou le total est épuisé. */
  take(bucket: K): boolean {
    const n = this.used.get(bucket) ?? 0;
    if (n >= this.limits[bucket] || this.spent >= this.total) return false;
    this.used.set(bucket, n + 1);
    this.spent += 1;
    return true;
  }

  remaining(bucket: K): number {
    return Math.max(0, Math.min(this.limits[bucket] - (this.used.get(bucket) ?? 0), this.total - this.spent));
  }

  get spentTotal(): number {
    return this.spent;
  }

  /** Requêtes réservées par poste (0 pour un poste inutilisé). */
  usage(): Record<K, number> {
    return Object.fromEntries(Object.keys(this.limits).map((k) => [k, this.used.get(k as K) ?? 0])) as Record<K, number>;
  }
}
```

`pipeline/collect/usage-ledger.ts` :

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const LedgerSchema = z.strictObject({ day: z.iso.date(), used: z.number().int().min(0) });

/** Jour du quota (UTC) : le compteur TheNewsAPI repart de zéro chaque jour. */
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Requêtes déjà consommées aujourd'hui par les passages précédents (relance le même jour).
 * Fichier absent ou d'un autre jour : 0. Fichier illisible : le quota est réputé épuisé
 * (mieux vaut se passer de TheNewsAPI que dépasser le plafond).
 */
export function readDailyUsage(path: string, day: string, cap: number): { used: number; error?: string } {
  if (!existsSync(path)) return { used: 0 };
  try {
    const ledger = LedgerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return { used: ledger.day === day ? ledger.used : 0 };
  } catch {
    return { used: cap, error: `${path} illisible : quota TheNewsAPI réputé épuisé (supprime le fichier pour réinitialiser)` };
  }
}

export function writeDailyUsage(path: string, day: string, used: number): void {
  writeFileSync(path, JSON.stringify({ day, used }, null, 2) + '\n');
}
```

`pipeline/collect/types.ts` :

```ts
import type { RawArticle } from '@daily-brief/schema';
import type { Whitelist } from '../lib/whitelist';
import type { CollectConfig } from './config';
import type { HttpFetch } from './http';
import type { Rubriques } from './rubriques';

export type SourceName = 'thenewsapi' | 'exa' | 'webz' | 'rss';

/** Article candidat ; `seed` relie les résultats de `/similar` à l'article qui les a fait trouver. */
export type Candidate = { article: RawArticle; seed?: string };

/** Bilan d'une source : articles, requêtes envoyées, erreurs (déjà sans secret) et textes écartés par R1. */
export type SourceRun = {
  candidates: Candidate[];
  requests: number;
  errors: string[];
  discardedTexts: number;
  /** Raison de la coupure du disjoncteur, le cas échéant. */
  stoppedBy: string | null;
};

export type SourceContext = {
  fetch: HttpFetch;
  whitelist: Whitelist;
  config: CollectConfig;
  rubriques: Rubriques;
  now: Date;
  /** Début de la fenêtre de collecte (`now - windowHours`). */
  windowStart: Date;
};

export const emptyRun = (): SourceRun => ({ candidates: [], requests: 0, errors: [], discardedTexts: 0, stoppedBy: null });
```

`pipeline/collect/breaker.ts` :

```ts
import { HttpError, isTimeout, messageOf } from './http';
import type { SourceRun } from './types';

/** 401/403 : clé refusée ; 402 : quota épuisé (TheNewsAPI) ; 429 : trop de requêtes. */
const FATAL_STATUS = new Set([401, 402, 403, 429]);

/**
 * Disjoncteur d'une source : après un refus d'accès, un quota épuisé ou un délai dépassé,
 * la source n'est plus appelée pendant le reste du passage.
 */
export class Breaker {
  reason: string | null = null;

  get open(): boolean {
    return this.reason !== null;
  }

  /** Enregistre l'erreur ; renvoie vrai si elle coupe la source. */
  trip(e: unknown): boolean {
    if (e instanceof HttpError && FATAL_STATUS.has(e.status)) this.reason = `HTTP ${e.status}`;
    else if (isTimeout(e)) this.reason = 'délai dépassé';
    return this.open;
  }
}

/** Ajoute l'erreur au bilan de la source ; renvoie vrai si elle coupe la source. */
export function recordFailure(run: SourceRun, breaker: Breaker, where: string, e: unknown): boolean {
  if (breaker.trip(e)) {
    run.stoppedBy = breaker.reason;
    run.errors.push(`${where} : ${messageOf(e)} — source coupée`);
    return true;
  }
  run.errors.push(`${where} : ${messageOf(e)}`);
  return false;
}
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run pipeline/test/collect/config.test.ts pipeline/test/collect/breaker.test.ts && npm run typecheck`
Attendu : `Tests  9 passed (9)` (7 + 2), typage propre.

Commande : `npm test`
Attendu : `Test Files  35 passed (35)`, `Tests  272 passed (272)`.

- [ ] **Étape 7 : commit**

```bash
git add pipeline/collect pipeline/config/collect.json pipeline/editorial/rubriques.json pipeline/test/collect
git commit -m "feat(collect): configuration, rubriques, budget de requêtes et disjoncteur"
```

---

### Tâche 3 : article normalisé et garde R1 à l'entrée

**Fichiers :**
- Créer : `pipeline/collect/article.ts`
- Test : `pipeline/test/collect/article.test.ts`

Comportement attendu :
- **Point d'entrée unique.** `makeArticle` est le seul chemin par lequel un article entre dans la collecte.
- **Normalisation.**
  - URL normalisée par `tryNormalizeUrl` : http(s) seulement, sans `www.` ni paramètres de suivi.
  - Titre et chapô en texte brut : balises retirées, entités décodées.
  - Chapô limité à 600 caractères.
  - Langue en ISO 639-1 (`fr-FR` devient `fr`, `french` est refusé).
  - Date ISO en UTC.
  - Média : celui de la source, sinon le domaine enregistrable.
- **R1.** Le texte n'est gardé que pour un domaine `full`. Sinon il est écarté et signalé (`discardedText`).
- **Entrée invalide.** Une URL illisible, un titre vide ou une langue absente donnent `article: null`, sans lever d'erreur.
- **Identifiant.** `id` vaut `a-` suivi des 16 premiers caractères hexadécimaux du SHA-256 de l'URL normalisée. Il est stable d'un jour et d'une source à l'autre.

- [ ] **Étape 1 : écrire le test qui échoue**

`pipeline/test/collect/article.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { articleId, makeArticle, plainText, toIso } from '../../collect/article';
import { loadWhitelist } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);

describe('makeArticle', () => {
  it('normalise URL, titre, langue et date', () => {
    const { article } = makeArticle(
      {
        url: 'https://www.lemonde.fr/politique/article/x.html?utm_source=tw#haut',
        title: ' Budget&nbsp;: le <b>Sénat</b> vote ',
        lang: 'fr-FR',
        publishedAt: '2026-11-06T05:00:00+01:00',
        description: '<p>Chapô &amp; suite</p>',
        origin: 'thenewsapi',
      },
      wl,
    );
    expect(article).toEqual({
      id: articleId('https://lemonde.fr/politique/article/x.html'),
      url: 'https://lemonde.fr/politique/article/x.html',
      outlet: 'lemonde.fr',
      title: 'Budget : le Sénat vote',
      description: 'Chapô & suite',
      lang: 'fr',
      publishedAt: '2026-11-06T04:00:00.000Z',
      origin: 'thenewsapi',
      text: null,
    });
  });

  it('R1 : écarte le texte d’un domaine qui n’est pas full et le signale', () => {
    const meta = makeArticle({ url: 'https://lemonde.fr/a', title: 'T', lang: 'fr', origin: 'webz', text: 'Texte intégral.' }, wl);
    expect(meta.article?.text).toBeNull();
    expect(meta.discardedText).toBe(true);
    const feed = makeArticle({ url: 'https://npr.org/a', title: 'T', lang: 'en', origin: 'webz', text: 'Full text.' }, wl);
    expect(feed.article?.text).toBeNull();
    const unknown = makeArticle({ url: 'https://inconnu.example/a', title: 'T', lang: 'en', origin: 'exa', text: 'x' }, wl);
    expect(unknown.article?.text).toBeNull();
    const full = makeArticle({ url: 'https://fr.euronews.com/a', title: 'T', lang: 'fr', origin: 'exa', text: 'Para 1\r\n\r\n\r\n\r\nPara 2' }, wl);
    expect(full.article?.text).toBe('Para 1\n\nPara 2');
    expect(full.discardedText).toBe(false);
  });

  it('refuse une URL non http(s), un titre vide ou une langue absente, sans lever', () => {
    expect(makeArticle({ url: 'javascript:alert(1)', title: 'T', lang: 'fr', origin: 'rss' }, wl).article).toBeNull();
    expect(makeArticle({ url: 'pas une url', title: 'T', lang: 'fr', origin: 'rss' }, wl).article).toBeNull();
    expect(makeArticle({ url: 'https://a.fr/x', title: '  <br> ', lang: 'fr', origin: 'rss' }, wl).article).toBeNull();
    expect(makeArticle({ url: 'https://a.fr/x', title: 'T', lang: null, origin: 'rss' }, wl).article).toBeNull();
    expect(makeArticle({ url: 'https://a.fr/x', title: 'T', lang: 'french', origin: 'rss' }, wl).article).toBeNull();
  });

  it('nomme le média par son domaine si la source ne le donne pas, borne la description', () => {
    const { article } = makeArticle({ url: 'https://news.sky.com/story/x', title: 'T', lang: 'en', origin: 'exa', description: 'x'.repeat(2000) }, wl);
    expect(article?.outlet).toBe('sky.com');
    expect(article?.description).toHaveLength(600);
  });
});

describe('utilitaires', () => {
  it('plainText décode les entités numériques et toIso refuse une date illisible', () => {
    expect(plainText('L&#8217;&#xE9;t&eacute;')).toBe('L’ét&eacute;');
    expect(toIso('hier')).toBeNull();
    expect(toIso('Thu, 06 Nov 2026 05:00:00 GMT')).toBe('2026-11-06T05:00:00.000Z');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/collect/article.test.ts`
Attendu : ÉCHEC, « Cannot find module '../../collect/article' ».

- [ ] **Étape 3 : écrire `article.ts`**

`pipeline/collect/article.ts` :

```ts
import { createHash } from 'node:crypto';
import { RawArticleSchema, type RawArticle } from '@daily-brief/schema';
import { outletKey, tryNormalizeUrl } from '../lib/url';
import { canReadFull, type Whitelist } from '../lib/whitelist';

export const MAX_DESCRIPTION = 600;

export type ArticleInput = {
  url: string | null | undefined;
  title: string | null | undefined;
  outlet?: string | null;
  description?: string | null;
  lang: string | null | undefined;
  publishedAt?: string | null;
  origin: RawArticle['origin'];
  text?: string | null;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Texte brut d'un fragment HTML : balises retirées, entités courantes décodées, espaces fusionnés. */
export function plainText(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Date ISO 8601 (UTC) ou null si la date est absente ou illisible. */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Identifiant stable d'un article : empreinte de son URL normalisée. */
export const articleId = (normalizedUrl: string): string => 'a-' + createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 16);

/**
 * Seul point d'entrée des articles dans la collecte. URL normalisée (http(s) seulement), titre
 * non vide, langue ISO 639-1, date ISO. **R1** : le texte n'est gardé que si le domaine est au
 * statut `full` ; sinon il est écarté (`discardedText`) et seules les métadonnées restent.
 */
export function makeArticle(input: ArticleInput, wl: Whitelist): { article: RawArticle | null; discardedText: boolean } {
  const url = input.url ? tryNormalizeUrl(input.url) : null;
  const title = plainText(input.title);
  const lang = /^[a-z]{2}(?![a-z])/i.exec((input.lang ?? '').trim())?.[0].toLowerCase();
  const rawText = input.text?.trim() ? input.text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : null;
  if (!url || !title || !lang) return { article: null, discardedText: false };
  const full = canReadFull(wl, url);
  const description = plainText(input.description).slice(0, MAX_DESCRIPTION) || null;
  const candidate: RawArticle = {
    id: articleId(url),
    url,
    outlet: plainText(input.outlet) || outletKey(url),
    title,
    description,
    lang,
    publishedAt: toIso(input.publishedAt),
    origin: input.origin,
    text: full ? rawText : null,
  };
  const parsed = RawArticleSchema.safeParse(candidate);
  return { article: parsed.success ? parsed.data : null, discardedText: rawText !== null && !full };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/collect/article.test.ts && npm run typecheck`
Attendu : `Tests  5 passed (5)`, typage propre.

Commande : `npm test`
Attendu : `Test Files  36 passed (36)`, `Tests  277 passed (277)`.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/collect/article.ts pipeline/test/collect/article.test.ts
git commit -m "feat(collect): article normalisé et garde R1 à l’entrée"
```

---

### Tâche 4 : client TheNewsAPI

**Fichiers :**
- Créer : `pipeline/collect/thenewsapi.ts`, `fixtures/api/thenewsapi-top.json`, `fixtures/api/thenewsapi-similar.json`
- Modifier : `fixtures/api/README.md`
- Test : `pipeline/test/collect/thenewsapi.test.ts`

Comportement attendu :
- **`/v1/news/top`.** Paramètres `api_token`, `language`, `limit`, `locale`, `categories`, `search` (si la rubrique en a), `published_after` (`AAAA-MM-JJTHH:MM:SS`, UTC) et `page` à partir de 2.
- **`/v1/news/similar/{uuid}`.** L'UUID est encodé dans le chemin ; paramètres `language`, `published_after` et `limit`.
- **Validation.** Une réponse sans tableau `data` lève une erreur. Un article mal formé (sans URL, par exemple) est ignoré.
- **Budget.** Le budget est réservé **avant** chaque appel : jamais plus de 25 FR, 20 EN, 20 ES et 25 `similar`, ni plus de 90 au total.
- **Pannes.** Un 401, un 402 (quota), un 403, un 429 ou un délai dépassé coupe la source dès le premier appel concerné. Une erreur 500 n'arrête que la rubrique concernée.
- **Groupes.** Les résultats de `/similar` sont reliés à leur graine (`seed`). Aucun article TheNewsAPI n'a de texte : le champ `snippet` n'est jamais repris.

- [ ] **Étape 1 : écrire les réponses construites**

`fixtures/api/thenewsapi-top.json` :

```json
{
  "meta": { "found": 1284, "returned": 3, "limit": 3, "page": 1 },
  "data": [
    {
      "uuid": "6f1c0a52-3b7e-4d0e-9a51-2c8e7d4f1a01",
      "title": "Budget 2027 : le Sénat adopte la première partie du texte",
      "description": "Les sénateurs ont voté dans la nuit la partie recettes du projet de loi de finances.",
      "keywords": "budget, Sénat, finances publiques",
      "snippet": "Les sénateurs ont adopté dans la nuit de mercredi à jeudi la première partie du projet de loi de finances pour 2027…",
      "url": "https://www.lemonde.fr/politique/article/2026/11/06/budget-2027-le-senat-adopte-la-premiere-partie_6512345_823448.html",
      "image_url": "https://img.lemde.fr/2026/11/06/0/0/4000/2666/1440/960/60/0/abc123_1.jpg",
      "language": "fr",
      "published_at": "2026-11-06T04:12:00.000000Z",
      "source": "lemonde.fr",
      "categories": ["politics", "general"],
      "relevance_score": null,
      "locale": "fr"
    },
    {
      "uuid": "0b7d93a4-1f25-4c8e-8e6a-55d2b0c9e302",
      "title": "Réforme des retraites : les syndicats appellent à une nouvelle journée de mobilisation",
      "description": "L'intersyndicale fixe une date de grève nationale pour la fin du mois.",
      "keywords": "",
      "snippet": "L'intersyndicale a annoncé jeudi une nouvelle journée de mobilisation…",
      "url": "https://fr.euronews.com/2026/11/06/reforme-des-retraites-les-syndicats-appellent-a-une-nouvelle-journee",
      "image_url": null,
      "language": "fr",
      "published_at": "2026-11-06T03:47:10.000000Z",
      "source": "fr.euronews.com",
      "categories": ["politics"],
      "relevance_score": null,
      "locale": "fr"
    },
    {
      "uuid": "c4e0f6b1-77aa-4a3e-b5c2-9e1d2f3a4b03",
      "title": "Article sans URL (doit être ignoré)",
      "description": null,
      "keywords": "",
      "snippet": "",
      "image_url": null,
      "language": "fr",
      "published_at": "2026-11-06T02:00:00.000000Z",
      "source": "exemple.fr",
      "categories": ["general"],
      "relevance_score": null,
      "locale": "fr"
    }
  ]
}
```

`fixtures/api/thenewsapi-similar.json` :

```json
{
  "meta": { "found": 12, "returned": 2, "limit": 3, "page": 1 },
  "data": [
    {
      "uuid": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c01",
      "title": "Retraites : l'intersyndicale annonce une grève nationale",
      "description": "Une nouvelle journée d'action est prévue fin novembre.",
      "keywords": "retraites, grève",
      "snippet": "L'intersyndicale a fixé jeudi…",
      "url": "https://www.sudradio.fr/societe/retraites-l-intersyndicale-annonce-une-greve-nationale",
      "image_url": null,
      "language": "fr",
      "published_at": "2026-11-06T04:30:00.000000Z",
      "source": "sudradio.fr",
      "categories": ["general"],
      "relevance_score": 31.4,
      "locale": "fr"
    },
    {
      "uuid": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c02",
      "title": "Retraites : une nouvelle journée de mobilisation fin novembre",
      "description": "Les syndicats maintiennent la pression sur le gouvernement.",
      "keywords": "",
      "snippet": "Les syndicats…",
      "url": "https://www.lefigaro.fr/social/retraites-une-nouvelle-journee-de-mobilisation-20261106",
      "image_url": null,
      "language": "fr",
      "published_at": "2026-11-06T04:05:00.000000Z",
      "source": "lefigaro.fr",
      "categories": ["general"],
      "relevance_score": 28.9,
      "locale": "fr"
    }
  ]
}
```

Ajouter à la fin de `fixtures/api/README.md` :

```markdown
- `thenewsapi-top.json` : `GET https://api.thenewsapi.com/v1/news/top` (documentation TheNewsAPI : `meta` et `data[]` avec `uuid`, `title`, `description`, `keywords`, `snippet`, `url`, `image_url`, `language`, `published_at`, `source`, `categories`, `relevance_score`, `locale`). Le troisième article n'a pas d'URL : il doit être ignoré.
- `thenewsapi-similar.json` : `GET https://api.thenewsapi.com/v1/news/similar/{uuid}`, même forme, `relevance_score` numérique.
```

- [ ] **Étape 2 : écrire le test qui échoue**

`pipeline/test/collect/thenewsapi.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { RequestBudget } from '../../collect/budget';
import type { BudgetBucket, CollectConfig } from '../../collect/config';
import { collectTheNewsApi, parseNews, similarNews, THENEWSAPI_BASE, topNews } from '../../collect/thenewsapi';
import { apiFixture, NOW, testContext } from './source-context';
import { fakeHttp, type Reply } from './fake-http';

const TOKEN = 'tna-SECRET-123';
const budgetOf = (c: CollectConfig) => {
  const { total, ...limits } = c.thenewsapi.budget;
  return new RequestBudget<BudgetBucket>(limits, total);
};

/** Réponse pleine (3 articles distincts) quelle que soit la requête. */
const fullPage = (url: string): Reply => {
  const u = new URL(url);
  const lang = u.searchParams.get('language');
  const tag = `${u.pathname.split('/').pop()}-${u.searchParams.get('categories') ?? 'sim'}-${u.searchParams.get('page') ?? 1}`;
  return {
    json: {
      meta: { found: 99, returned: 3, limit: 3, page: 1 },
      data: [0, 1, 2].map((i) => ({
        uuid: `${lang}-${tag}-${i}`,
        title: `Titre ${lang} ${tag} ${i}`,
        description: null,
        url: `https://${i === 0 ? 'lemonde.fr' : 'fr.euronews.com'}/${lang}/${tag}/${i}`,
        language: lang,
        published_at: '2026-11-06T03:00:00Z',
        source: 'x',
      })),
    },
  };
};

describe('client TheNewsAPI', () => {
  it('appelle /top avec les paramètres de la spec et ignore un article mal formé', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: { json: apiFixture('thenewsapi-top.json') } });
    const items = await topNews(
      { language: 'fr', locale: 'fr', categories: 'politics', search: 'a | b', publishedAfter: new Date('2026-11-05T04:13:00Z'), limit: 3, page: 2 },
      { token: TOKEN, fetch, timeoutMs: 1000 },
    );
    expect(items.map((i) => i.uuid)).toEqual(['6f1c0a52-3b7e-4d0e-9a51-2c8e7d4f1a01', '0b7d93a4-1f25-4c8e-8e6a-55d2b0c9e302']);
    const q = new URL(calls[0].url).searchParams;
    expect(Object.fromEntries(q)).toEqual({
      api_token: TOKEN,
      language: 'fr',
      limit: '3',
      locale: 'fr',
      categories: 'politics',
      search: 'a | b',
      published_after: '2026-11-05T04:13:00',
      page: '2',
    });
  });

  it('appelle /similar/{uuid}', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/similar/`]: { json: apiFixture('thenewsapi-similar.json') } });
    const items = await similarNews('a/b', { language: 'fr', publishedAfter: NOW, limit: 3 }, { token: TOKEN, fetch, timeoutMs: 1000 });
    expect(items).toHaveLength(2);
    expect(calls[0].url).toMatch(/\/similar\/a%2Fb\?/);
  });

  it('lève sur une réponse sans tableau data', () => {
    expect(() => parseNews({ error: { code: 'invalid_api_token' } })).toThrow();
  });
});

describe('collectTheNewsApi', () => {
  it('ne dépasse jamais le budget : 25 FR, 20 EN, 20 ES, 25 similar, 90 au total', async () => {
    const { fetch, calls } = fakeHttp({ [THENEWSAPI_BASE]: fullPage });
    const ctx = testContext(fetch);
    const budget = budgetOf(ctx.config);
    const run = await collectTheNewsApi(ctx, TOKEN, budget);
    expect(calls).toHaveLength(90);
    expect(run.requests).toBe(90);
    expect(budget.usage()).toEqual({ fr: 25, en: 20, es: 20, similar: 25 });
    const langs = (lang: string) => calls.filter((c) => c.url.includes('/top?') && new URL(c.url).searchParams.get('language') === lang).length;
    expect([langs('fr'), langs('en'), langs('es')]).toEqual([25, 20, 20]);
  });

  it('parcourt les 9 rubriques en page 1 avant de passer en page 2', async () => {
    const { fetch, calls } = fakeHttp({ [THENEWSAPI_BASE]: fullPage });
    await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    const fr = calls.filter((c) => new URL(c.url).searchParams.get('language') === 'fr' && c.url.includes('/top?')).map((c) => new URL(c.url).searchParams);
    expect(new Set(fr.slice(0, 9).map((q) => q.get('categories') + '|' + q.get('search'))).size).toBe(9);
    expect(fr.slice(0, 9).every((q) => q.get('page') === null)).toBe(true);
    expect(fr[9].get('page')).toBe('2');
    expect(fr[0].get('locale')).toBe('fr');
  });

  it('abandonne une rubrique épuisée (moins de 3 résultats) sans gaspiller le budget', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: { json: { data: [] } }, [`${THENEWSAPI_BASE}/similar/`]: { json: { data: [] } } });
    const run = await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    expect(calls).toHaveLength(27);
    expect(run.candidates).toEqual([]);
  });

  it('se coupe au premier 402 (quota) sans autre appel, sans jeton dans les erreurs', async () => {
    const { fetch, calls } = fakeHttp({ [THENEWSAPI_BASE]: { status: 402, json: { error: { code: 'usage_limit_reached' } } } });
    const run = await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    expect(calls).toHaveLength(1);
    expect(run.stoppedBy).toBe('HTTP 402');
    expect(JSON.stringify(run.errors)).not.toContain(TOKEN);
  });

  it('se coupe sur un délai dépassé au lieu de rester bloquée', async () => {
    const { fetch, calls } = fakeHttp({ [THENEWSAPI_BASE]: { hang: true } });
    const ctx = testContext(fetch, (c) => (c.thenewsapi.timeoutMs = 20));
    const run = await collectTheNewsApi(ctx, TOKEN, budgetOf(ctx.config));
    expect(calls).toHaveLength(1);
    expect(run.stoppedBy).toBe('délai dépassé');
  });

  it('une erreur 500 n’arrête que la rubrique concernée', async () => {
    let n = 0;
    const { fetch } = fakeHttp({ [THENEWSAPI_BASE]: (url) => (++n === 1 ? { status: 500, json: {} } : fullPage(url)) });
    const run = await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    expect(run.errors).toHaveLength(1);
    expect(run.errors[0]).toMatch(/^top fr\/pol p1 : HTTP 500/);
    expect(run.stoppedBy).toBeNull();
    expect(run.candidates.length).toBeGreaterThan(100);
  });

  it('relie les résultats de /similar à leur graine, domaines full d’abord', async () => {
    const { fetch, calls } = fakeHttp({
      [`${THENEWSAPI_BASE}/top`]: (url) => (url.includes('language=fr') && !url.includes('page=') && url.includes('categories=politics&') ? { json: apiFixture('thenewsapi-top.json') } : { json: { data: [] } }),
      [`${THENEWSAPI_BASE}/similar/`]: { json: apiFixture('thenewsapi-similar.json') },
    });
    const run = await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    const sims = calls.filter((c) => c.url.includes('/similar/'));
    expect(sims).toHaveLength(2);
    expect(sims[0].url).toContain('/similar/0b7d93a4-1f25-4c8e-8e6a-55d2b0c9e302?');
    const euronews = run.candidates.find((c) => c.article.url.includes('euronews'))!;
    const linked = run.candidates.filter((c) => c.seed === euronews.article.id).map((c) => c.article.outlet);
    expect(linked).toEqual(['sudradio.fr', 'lefigaro.fr']);
    expect(run.candidates.every((c) => c.article.text === null && c.article.origin === 'thenewsapi')).toBe(true);
  });
});
```

- [ ] **Étape 3 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/collect/thenewsapi.test.ts`
Attendu : ÉCHEC, « Cannot find module '../../collect/thenewsapi' ».

- [ ] **Étape 4 : écrire `thenewsapi.ts`**

`pipeline/collect/thenewsapi.ts` :

```ts
import { z } from 'zod';
import { LANGS, RUBRIC_KEYS, type Lang, type RubricKey } from '@daily-brief/schema';
import { canReadFull } from '../lib/whitelist';
import { makeArticle } from './article';
import { Breaker, recordFailure } from './breaker';
import type { RequestBudget } from './budget';
import type { BudgetBucket } from './config';
import { fetchJson, type HttpFetch } from './http';
import { searchOf } from './rubriques';
import { emptyRun, type Candidate, type SourceContext, type SourceRun } from './types';

export const THENEWSAPI_BASE = 'https://api.thenewsapi.com/v1/news';

/** Article TheNewsAPI : analyse tolérante (champs inconnus ignorés, champs absents acceptés). */
const ItemSchema = z.object({
  uuid: z.string().min(1),
  title: z.string().nullish(),
  description: z.string().nullish(),
  url: z.string().min(1),
  language: z.string().nullish(),
  published_at: z.string().nullish(),
  source: z.string().nullish(),
});
const ResponseSchema = z.object({ data: z.array(z.unknown()) });

export type NewsItem = z.infer<typeof ItemSchema>;

/** `published_after` au format attendu par l'API (UTC, à la seconde). */
export const publishedAfterParam = (d: Date): string => d.toISOString().slice(0, 19);

/** Articles valides d'une réponse ; un article mal formé est ignoré, une réponse mal formée lève. */
export function parseNews(json: unknown): NewsItem[] {
  return ResponseSchema.parse(json).data.flatMap((d) => {
    const r = ItemSchema.safeParse(d);
    return r.success ? [r.data] : [];
  });
}

type Common = { token: string; fetch: HttpFetch; timeoutMs: number };

export type TopParams = { language: string; locale?: string; categories?: string; search?: string | null; publishedAfter?: Date; limit: number; page?: number };

/** `GET /v1/news/top`. */
export async function topNews(p: TopParams, c: Common): Promise<NewsItem[]> {
  const q = new URLSearchParams({ api_token: c.token, language: p.language, limit: String(p.limit) });
  if (p.locale) q.set('locale', p.locale);
  if (p.categories) q.set('categories', p.categories);
  if (p.search) q.set('search', p.search);
  if (p.publishedAfter) q.set('published_after', publishedAfterParam(p.publishedAfter));
  if (p.page && p.page > 1) q.set('page', String(p.page));
  return parseNews(await fetchJson(c.fetch, `${THENEWSAPI_BASE}/top?${q}`, { timeoutMs: c.timeoutMs }));
}

/** `GET /v1/news/similar/{uuid}` : articles d'autres médias sur la même information. */
export async function similarNews(uuid: string, p: { language: string; publishedAfter: Date; limit: number }, c: Common): Promise<NewsItem[]> {
  const q = new URLSearchParams({ api_token: c.token, language: p.language, published_after: publishedAfterParam(p.publishedAfter), limit: String(p.limit) });
  return parseNews(await fetchJson(c.fetch, `${THENEWSAPI_BASE}/similar/${encodeURIComponent(uuid)}?${q}`, { timeoutMs: c.timeoutMs }));
}

/**
 * Découverte TheNewsAPI : pour chaque langue, une requête `/top` par rubrique et par page, en
 * tourniquet (page 1 de toutes les rubriques, puis page 2…), tant que le poste de la langue le
 * permet ; puis `/similar` sur les premiers articles (domaines `full` d'abord) avec le poste
 * `similar`. Le budget est réservé avant chaque requête ; un 401/402/403/429 ou un délai dépassé
 * coupe la source.
 */
export async function collectTheNewsApi(ctx: SourceContext, token: string, budget: RequestBudget<BudgetBucket>): Promise<SourceRun> {
  const cfg = ctx.config.thenewsapi;
  const common: Common = { token, fetch: ctx.fetch, timeoutMs: cfg.timeoutMs };
  const run = emptyRun();
  const breaker = new Breaker();
  const uuids = new Map<string, string>();
  const discovered: Candidate[] = [];

  const add = (items: NewsItem[], lang: Lang, seed?: string) => {
    for (const it of items) {
      const { article } = makeArticle(
        { url: it.url, title: it.title, outlet: it.source, description: it.description, lang: it.language ?? lang, publishedAt: it.published_at, origin: 'thenewsapi' },
        ctx.whitelist,
      );
      if (!article) continue;
      if (!uuids.has(article.id)) uuids.set(article.id, it.uuid);
      const c: Candidate = seed ? { article, seed } : { article };
      run.candidates.push(c);
      if (!seed) discovered.push(c);
    }
  };

  for (const lang of LANGS) {
    const active: RubricKey[] = [...RUBRIC_KEYS];
    for (let page = 1; active.length > 0 && !breaker.open && budget.remaining(lang) > 0; page++) {
      for (const key of [...active]) {
        if (breaker.open || !budget.take(lang)) break;
        run.requests++;
        const rubric = ctx.rubriques[key];
        try {
          const items = await topNews(
            { language: lang, locale: cfg.locales[lang], categories: rubric.categories.join(','), search: searchOf(rubric, lang), publishedAfter: ctx.windowStart, limit: cfg.limit, page },
            common,
          );
          add(items, lang);
          if (items.length < cfg.limit) active.splice(active.indexOf(key), 1);
        } catch (e) {
          if (recordFailure(run, breaker, `top ${lang}/${key} p${page}`, e)) break;
          active.splice(active.indexOf(key), 1);
        }
      }
    }
  }

  for (const seed of similarSeeds(discovered, ctx)) {
    if (breaker.open || !budget.take('similar')) break;
    run.requests++;
    try {
      const items = await similarNews(uuids.get(seed.article.id)!, { language: seed.article.lang, publishedAfter: ctx.windowStart, limit: cfg.limit }, common);
      add(items, seed.article.lang as Lang, seed.article.id);
    } catch (e) {
      if (recordFailure(run, breaker, `similar ${seed.article.lang}`, e)) break;
    }
  }
  return run;
}

/** Ordre des graines de `/similar` : une par article, domaines `full` d'abord, langues en alternance. */
export function similarSeeds(discovered: Candidate[], ctx: Pick<SourceContext, 'whitelist'>): Candidate[] {
  const seen = new Set<string>();
  const perLang = LANGS.map((lang) => {
    const mine = discovered.filter((c) => c.article.lang === lang && !seen.has(c.article.id) && seen.add(c.article.id));
    return [...mine.filter((c) => canReadFull(ctx.whitelist, c.article.url)), ...mine.filter((c) => !canReadFull(ctx.whitelist, c.article.url))];
  });
  const out: Candidate[] = [];
  for (let i = 0; perLang.some((l) => i < l.length); i++) for (const l of perLang) if (i < l.length) out.push(l[i]);
  return out;
}
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run pipeline/test/collect/thenewsapi.test.ts && npm run typecheck`
Attendu : `Tests  10 passed (10)`, typage propre. Le test du délai dépassé prend environ 20 ms.

Commande : `npm test`
Attendu : `Test Files  37 passed (37)`, `Tests  287 passed (287)`.

- [ ] **Étape 6 : commit**

```bash
git add pipeline/collect/thenewsapi.ts pipeline/test/collect/thenewsapi.test.ts fixtures/api
git commit -m "feat(collect): client TheNewsAPI (top, similar, budget de 90 requêtes)"
```

---

### Tâche 5 : Exa et secours Webz

**Fichiers :**
- Créer : `pipeline/collect/exa.ts`, `pipeline/collect/webz.ts`, `fixtures/api/exa-search.json`, `fixtures/api/webz-news-lite.json`
- Modifier : `fixtures/api/README.md`
- Test : `pipeline/test/collect/exa.test.ts`, `pipeline/test/collect/webz.test.ts`

Comportement attendu :
- **Requête Exa.** `POST https://api.exa.ai/search` avec l'en-tête `x-api-key`. Le corps contient `{ query, category: 'news', startPublishedDate, numResults, includeDomains? }`.
- **R1 côté Exa.** `contents: { text: true }` n'est ajouté **que** si `includeDomains` est non vide et ne contient que des domaines `full` (`canRequestText`). Une recherche ouverte ne demande jamais le texte. Un texte reçu malgré tout pour un domaine qui n'est pas `full` est écarté et compté.
- **Volume Exa.** 9 rubriques × 3 langues × (1 recherche, ou 2 si Exa est principal), avec un plafond `exa.maxRequests` (60). Un 401 coupe la source ; la clé n'apparaît dans aucun message.
- **Requête Webz.** `GET https://api.webz.io/newsApiLite?token=…&q=…`, une requête par langue demandée, `webz.maxRequests` (3) au plus.
- **R1 côté Webz.** Le texte d'un domaine qui n'est pas `full` est écarté, et le chapô n'est jamais tiré du texte. Les posts hors fenêtre ou mal formés sont ignorés.
- **Langue Webz.** Elle est donnée en toutes lettres (`spanish`) ou en code. Absente, c'est la langue de la requête. Toute autre langue écarte le post.

- [ ] **Étape 1 : écrire les réponses construites**

`fixtures/api/exa-search.json` :

```json
{
  "requestId": "b5947044c4b78efa9552a7c89b306d95",
  "resolvedSearchType": "neural",
  "results": [
    {
      "id": "https://fr.euronews.com/2026/11/06/cop31-les-negociations-butent-sur-le-financement",
      "title": "COP31 : les négociations butent sur le financement",
      "url": "https://fr.euronews.com/2026/11/06/cop31-les-negociations-butent-sur-le-financement",
      "publishedDate": "2026-11-06T03:20:00.000Z",
      "author": "Rédaction Euronews",
      "text": "Les délégations réunies à Belém n'ont pas trouvé d'accord jeudi sur le financement de l'adaptation.\n\n« Nous ne repartirons pas sans un chiffre », a déclaré la ministre."
    },
    {
      "id": "https://www.sudradio.fr/societe/greve-sncf-preavis-depose",
      "title": "Grève SNCF : un préavis déposé pour le week-end",
      "url": "https://www.sudradio.fr/societe/greve-sncf-preavis-depose",
      "publishedDate": "2026-11-05T19:02:00.000Z",
      "author": null,
      "text": "SUD-Rail a déposé mercredi soir un préavis de grève couvrant le week-end."
    },
    {
      "id": "https://www.lemonde.fr/planete/article/2026/11/06/cop31.html",
      "title": "COP31 : à Belém, l'argent divise",
      "url": "https://www.lemonde.fr/planete/article/2026/11/06/cop31.html",
      "publishedDate": "2026-11-06T02:00:00.000Z",
      "author": null,
      "text": "Texte intégral qui ne doit jamais être conservé (domaine meta)."
    },
    {
      "id": "sans-url",
      "title": "Résultat mal formé"
    }
  ]
}
```

`fixtures/api/webz-news-lite.json` :

```json
{
  "posts": [
    {
      "thread": {
        "uuid": "1f0e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6",
        "url": "https://www.eldiario.es/politica/congreso-aprueba-presupuestos_1_11000001.html",
        "site": "eldiario.es",
        "site_type": "news",
        "country": "ES",
        "title": "El Congreso aprueba los Presupuestos",
        "published": "2026-11-06T05:10:00.000+01:00"
      },
      "uuid": "1f0e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6",
      "url": "https://www.eldiario.es/politica/congreso-aprueba-presupuestos_1_11000001.html",
      "author": "Redacción",
      "published": "2026-11-06T05:10:00.000+01:00",
      "title": "El Congreso aprueba los Presupuestos",
      "text": "El pleno del Congreso aprobó este jueves los Presupuestos Generales del Estado.\nLa votación salió adelante por un estrecho margen.",
      "language": "spanish",
      "sentiment": "neutral",
      "categories": ["Politics"]
    },
    {
      "thread": {
        "uuid": "2a1b0c9d8e7f60514233241506f7e8d9c0b1a2f3",
        "url": "https://elpais.com/economia/2026-11-06/el-paro-baja.html",
        "site": "elpais.com",
        "site_type": "news",
        "country": "ES",
        "title": "El paro baja en octubre",
        "published": "2026-11-06T04:00:00.000+01:00"
      },
      "uuid": "2a1b0c9d8e7f60514233241506f7e8d9c0b1a2f3",
      "url": "https://elpais.com/economia/2026-11-06/el-paro-baja.html",
      "author": "",
      "published": "2026-11-06T04:00:00.000+01:00",
      "title": "El paro baja en octubre",
      "text": "Texto íntegro de un medio con estado meta: nunca debe conservarse.",
      "language": "spanish",
      "sentiment": "neutral",
      "categories": ["Economy"]
    },
    {
      "thread": { "site": "ejemplo.es", "title": "Noticia antigua" },
      "uuid": "3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c",
      "url": "https://ejemplo.es/noticia-antigua",
      "published": "2026-10-01T08:00:00.000+02:00",
      "title": "Noticia antigua (hors fenêtre, doit être ignorée)",
      "text": "",
      "language": "spanish"
    },
    {
      "uuid": "sans-url",
      "title": "Post mal formé"
    }
  ],
  "totalResults": 4,
  "moreResultsAvailable": 0,
  "next": "/newsApiLite?token=WEBZ-SECRET-789&q=language%3Aspanish&from=10",
  "requestsLeft": 987,
  "warnings": null
}
```

Ajouter à la fin de `fixtures/api/README.md` :

```markdown
- `exa-search.json` : `POST https://api.exa.ai/search` (documentation Exa : `results[]` avec `id`, `title`, `url`, `publishedDate`, `author`, `text`). Le résultat de lemonde.fr porte un texte qui doit être écarté (R1) ; le dernier résultat est mal formé.
- `webz-news-lite.json` : `GET https://api.webz.io/newsApiLite` (forme des `posts[]` de Webz.io : `thread`, `uuid`, `url`, `published`, `title`, `text`, `language` en toutes lettres). Le texte d'elpais.com doit être écarté (R1) ; un post est hors fenêtre, un autre mal formé. Le champ `next` contient un faux jeton.
```

- [ ] **Étape 2 : écrire les tests qui échouent**

`pipeline/test/collect/exa.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { canRequestText, collectExa, EXA_SEARCH, exaSearch } from '../../collect/exa';
import { loadWhitelist } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';
import { apiFixture, NOW, testContext } from './source-context';
import { fakeHttp } from './fake-http';

const KEY = 'exa-SECRET-456';
const wl = loadWhitelist(WHITELIST_PATH);

describe('R1 : texte Exa', () => {
  it('ne demande le texte que pour des domaines tous full', () => {
    expect(canRequestText(wl, ['fr.euronews.com', 'sudradio.fr'])).toBe(true);
    expect(canRequestText(wl, ['fr.euronews.com', 'lemonde.fr'])).toBe(false);
    expect(canRequestText(wl, ['npr.org'])).toBe(false);
    expect(canRequestText(wl, ['inconnu.example'])).toBe(false);
    expect(canRequestText(wl, [])).toBe(false);
    expect(canRequestText(wl, undefined)).toBe(false);
  });

  it('envoie contents.text seulement avec des domaines full', async () => {
    const { fetch, calls } = fakeHttp({ [EXA_SEARCH]: { json: { results: [] } } });
    const c = { apiKey: KEY, fetch, timeoutMs: 1000, whitelist: wl };
    await exaSearch({ query: 'q', startPublishedDate: NOW, numResults: 5, includeDomains: ['sudradio.fr'] }, c);
    await exaSearch({ query: 'q', startPublishedDate: NOW, numResults: 5, includeDomains: ['sudradio.fr', 'lefigaro.fr'] }, c);
    await exaSearch({ query: 'q', startPublishedDate: NOW, numResults: 5 }, c);
    const bodies = calls.map((x) => JSON.parse(x.body!));
    expect(bodies[0]).toEqual({ query: 'q', category: 'news', startPublishedDate: '2026-11-06T04:13:00.000Z', numResults: 5, includeDomains: ['sudradio.fr'], contents: { text: true } });
    expect(bodies[1].contents).toBeUndefined();
    expect(bodies[2]).toEqual({ query: 'q', category: 'news', startPublishedDate: '2026-11-06T04:13:00.000Z', numResults: 5 });
    expect(calls[0]).toMatchObject({ method: 'POST', headers: { 'x-api-key': KEY, 'content-type': 'application/json' } });
  });
});

describe('collectExa', () => {
  it('garde le texte des domaines full, écarte celui des autres et ignore un résultat mal formé', async () => {
    const { fetch } = fakeHttp({ [EXA_SEARCH]: { json: apiFixture('exa-search.json') } });
    const ctx = testContext(fetch, (c) => (c.exa.maxRequests = 1));
    const run = await collectExa(ctx, KEY, { broad: false });
    expect(run.requests).toBe(1);
    const byOutlet = Object.fromEntries(run.candidates.map((c) => [c.article.outlet, c.article]));
    expect(Object.keys(byOutlet)).toEqual(['euronews.com', 'sudradio.fr', 'lemonde.fr']);
    expect(byOutlet['euronews.com'].text).toContain('« Nous ne repartirons pas sans un chiffre »');
    expect(byOutlet['euronews.com'].lang).toBe('fr');
    expect(byOutlet['lemonde.fr'].text).toBeNull();
    expect(run.discardedTexts).toBe(1);
  });

  it('en recherche ouverte (Exa principal), ne demande jamais le texte et n’en garde aucun', async () => {
    const { fetch, calls } = fakeHttp({ [EXA_SEARCH]: { json: apiFixture('exa-search.json') } });
    const ctx = testContext(fetch, (c) => {
      c.exa.fullDomains.fr = [];
    });
    const run = await collectExa(ctx, KEY, { broad: true });
    const fr = calls.slice(0, 9).map((x) => JSON.parse(x.body!));
    expect(fr.every((b) => b.contents === undefined && b.includeDomains === undefined)).toBe(true);
    expect(run.candidates.filter((c) => c.article.lang === 'fr').every((c) => c.article.text === null)).toBe(true);
  });

  it('respecte le plafond de requêtes : 9 rubriques × 3 langues × 2 recherches = 54 ≤ 60', async () => {
    const { fetch, calls } = fakeHttp({ [EXA_SEARCH]: { json: { results: [] } } });
    const run = await collectExa(testContext(fetch), KEY, { broad: true });
    expect(calls).toHaveLength(54);
    const capped = fakeHttp({ [EXA_SEARCH]: { json: { results: [] } } });
    await collectExa(testContext(capped.fetch, (c) => (c.exa.maxRequests = 10)), KEY, { broad: true });
    expect(capped.calls).toHaveLength(10);
    expect(run.errors).toEqual([]);
  });

  it('se coupe sur un 401, sans la clé dans les erreurs', async () => {
    const { fetch, calls } = fakeHttp({ [EXA_SEARCH]: { status: 401, json: { error: `invalid key ${KEY}` } } });
    const run = await collectExa(testContext(fetch), KEY, { broad: true });
    expect(calls).toHaveLength(1);
    expect(run.stoppedBy).toBe('HTTP 401');
    expect(JSON.stringify(run)).not.toContain(KEY);
  });
});
```

`pipeline/test/collect/webz.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { collectWebz, WEBZ_LITE, webzLang } from '../../collect/webz';
import { apiFixture, testContext } from './source-context';
import { fakeHttp } from './fake-http';

const TOKEN = 'WEBZ-SECRET-789';

describe('collectWebz', () => {
  it('appelle News API Lite avec le jeton et la requête de la langue', async () => {
    const { fetch, calls } = fakeHttp({ [WEBZ_LITE]: { json: { posts: [] } } });
    await collectWebz(testContext(fetch), TOKEN, ['es']);
    const q = new URL(calls[0].url).searchParams;
    expect(q.get('token')).toBe(TOKEN);
    expect(q.get('q')).toBe('language:spanish thread.country:ES');
  });

  it('R1 : garde le texte d’eldiario.es (full), écarte celui d’elpais.com (meta), ignore les posts hors fenêtre ou mal formés', async () => {
    const { fetch } = fakeHttp({ [WEBZ_LITE]: { json: apiFixture('webz-news-lite.json') } });
    const run = await collectWebz(testContext(fetch), TOKEN, ['es']);
    expect(run.candidates.map((c) => c.article.outlet)).toEqual(['eldiario.es', 'elpais.com']);
    const [eldiario, elpais] = run.candidates.map((c) => c.article);
    expect(eldiario).toMatchObject({ lang: 'es', origin: 'webz', publishedAt: '2026-11-06T04:10:00.000Z', description: null });
    expect(eldiario.text).toBe('El pleno del Congreso aprobó este jueves los Presupuestos Generales del Estado.\nLa votación salió adelante por un estrecho margen.');
    expect(elpais.text).toBeNull();
    expect(elpais.description).toBeNull();
    expect(run.discardedTexts).toBe(1);
  });

  it('plafonne les requêtes et se coupe sur un 429 sans jeton dans les erreurs', async () => {
    const ok = fakeHttp({ [WEBZ_LITE]: { json: { posts: [] } } });
    await collectWebz(testContext(ok.fetch, (c) => (c.webz.maxRequests = 2)), TOKEN, ['fr', 'en', 'es']);
    expect(ok.calls).toHaveLength(2);
    const ko = fakeHttp({ [WEBZ_LITE]: { status: 429, json: {} } });
    const run = await collectWebz(testContext(ko.fetch), TOKEN, ['fr', 'en', 'es']);
    expect(ko.calls).toHaveLength(1);
    expect(run.stoppedBy).toBe('HTTP 429');
    expect(run.errors[0]).toContain('token=***');
    expect(JSON.stringify(run)).not.toContain(TOKEN);
  });

  it('langue : nom ou code ISO, langue de la requête si absente, article écarté si autre langue', async () => {
    expect([webzLang('Spanish', 'fr'), webzLang('en', 'fr'), webzLang(null, 'es'), webzLang('german', 'fr')]).toEqual(['es', 'en', 'es', 'german']);
    const post = (url: string, language?: string) => ({ url, title: `Titre ${url}`, published: '2026-11-06T04:00:00Z', ...(language ? { language } : {}) });
    const { fetch } = fakeHttp({
      [WEBZ_LITE]: { json: { posts: [post('https://eldiario.es/a', 'spanish'), post('https://eldiario.es/b'), post('https://dw.com/c', 'german')] } },
    });
    const run = await collectWebz(testContext(fetch), TOKEN, ['es']);
    expect(run.candidates.map((c) => [c.article.url, c.article.lang])).toEqual([
      ['https://eldiario.es/a', 'es'],
      ['https://eldiario.es/b', 'es'],
    ]);
  });

  it('une réponse sans tableau posts est une erreur, pas un plantage', async () => {
    const { fetch } = fakeHttp({ [WEBZ_LITE]: { json: { message: 'Bad query' } } });
    const run = await collectWebz(testContext(fetch), TOKEN, ['fr', 'en']);
    expect(run.errors).toHaveLength(2);
    expect(run.stoppedBy).toBeNull();
  });
});
```

- [ ] **Étape 3 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/collect/exa.test.ts pipeline/test/collect/webz.test.ts`
Attendu : ÉCHEC, « Cannot find module '../../collect/exa' » et « … '../../collect/webz' ».

- [ ] **Étape 4 : écrire `exa.ts` et `webz.ts`**

`pipeline/collect/exa.ts` :

```ts
import { z } from 'zod';
import { LANGS, RUBRIC_KEYS } from '@daily-brief/schema';
import { lookupDomain, type Whitelist } from '../lib/whitelist';
import { makeArticle } from './article';
import { Breaker, recordFailure } from './breaker';
import { fetchJson, type HttpFetch } from './http';
import { emptyRun, type SourceContext, type SourceRun } from './types';

export const EXA_SEARCH = 'https://api.exa.ai/search';

/** Résultat Exa : analyse tolérante, `text` présent seulement si `contents.text` a été demandé. */
const ResultSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullish(),
  publishedDate: z.string().nullish(),
  text: z.string().nullish(),
});
const ResponseSchema = z.object({ results: z.array(z.unknown()) });

export type ExaResult = z.infer<typeof ResultSchema>;

/**
 * R1 : le texte n'est demandé que si la recherche est restreinte à des domaines **tous** au
 * statut `full`. Sans `includeDomains`, ou avec un seul domaine `feed`, `meta` ou inconnu : jamais.
 */
export function canRequestText(wl: Whitelist, includeDomains: string[] | undefined): boolean {
  return !!includeDomains && includeDomains.length > 0 && includeDomains.every((d) => lookupDomain(wl, `https://${d}/`)?.status === 'full');
}

export type ExaParams = { query: string; startPublishedDate: Date; numResults: number; includeDomains?: string[] };

/** `POST /search` (catégorie news) ; `textRequested` indique si `contents.text` a été demandé. */
export async function exaSearch(
  p: ExaParams,
  c: { apiKey: string; fetch: HttpFetch; timeoutMs: number; whitelist: Whitelist },
): Promise<{ results: ExaResult[]; textRequested: boolean }> {
  const textRequested = canRequestText(c.whitelist, p.includeDomains);
  const body: Record<string, unknown> = {
    query: p.query,
    category: 'news',
    startPublishedDate: p.startPublishedDate.toISOString(),
    numResults: p.numResults,
  };
  if (p.includeDomains?.length) body.includeDomains = p.includeDomains;
  if (textRequested) body.contents = { text: true };
  const json = await fetchJson(c.fetch, EXA_SEARCH, {
    method: 'POST',
    headers: { 'x-api-key': c.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: c.timeoutMs,
  });
  const results = ResponseSchema.parse(json).results.flatMap((r) => {
    const parsed = ResultSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
  return { results, textRequested };
}

/**
 * Exa, par langue et par rubrique : une recherche restreinte aux domaines `full` de la langue
 * (avec texte), puis, si `broad`, une recherche ouverte (métadonnées seulement). `broad` sert
 * quand Exa est la découverte principale (§16). Plafond : `exa.maxRequests` par passage.
 */
export async function collectExa(ctx: SourceContext, apiKey: string, opts: { broad: boolean }): Promise<SourceRun> {
  const cfg = ctx.config.exa;
  const run = emptyRun();
  const breaker = new Breaker();
  const common = { apiKey, fetch: ctx.fetch, timeoutMs: cfg.timeoutMs, whitelist: ctx.whitelist };
  outer: for (const lang of LANGS) {
    for (const key of RUBRIC_KEYS) {
      const searches = [...(cfg.fullDomains[lang].length ? [cfg.fullDomains[lang]] : []), ...(opts.broad ? [undefined] : [])];
      for (const includeDomains of searches) {
        if (breaker.open || run.requests >= cfg.maxRequests) break outer;
        run.requests++;
        try {
          const { results, textRequested } = await exaSearch(
            { query: ctx.rubriques[key].exaQuery[lang], startPublishedDate: ctx.windowStart, numResults: cfg.numResults, includeDomains },
            common,
          );
          for (const r of results) {
            const text = textRequested ? r.text : null;
            const { article, discardedText } = makeArticle({ url: r.url, title: r.title, lang, publishedAt: r.publishedDate, origin: 'exa', text }, ctx.whitelist);
            if (discardedText || (!textRequested && r.text)) run.discardedTexts++;
            if (article) run.candidates.push({ article });
          }
        } catch (e) {
          if (recordFailure(run, breaker, `exa ${lang}/${key}${includeDomains ? ' (full)' : ''}`, e)) break outer;
        }
      }
    }
  }
  return run;
}
```

`pipeline/collect/webz.ts` :

```ts
import { z } from 'zod';
import type { Lang } from '@daily-brief/schema';
import { makeArticle, toIso } from './article';
import { Breaker, recordFailure } from './breaker';
import { fetchJson, type HttpFetch } from './http';
import { emptyRun, type SourceContext, type SourceRun } from './types';

export const WEBZ_LITE = 'https://api.webz.io/newsApiLite';

/** Article Webz.io News API Lite : analyse tolérante. */
const PostSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullish(),
  text: z.string().nullish(),
  published: z.string().nullish(),
  language: z.string().nullish(),
  thread: z.object({ site: z.string().nullish(), title: z.string().nullish() }).nullish(),
});
const ResponseSchema = z.object({ posts: z.array(z.unknown()) });

export type WebzPost = z.infer<typeof PostSchema>;

/** Webz donne la langue en toutes lettres. */
const LANG_CODES: Record<string, string> = { french: 'fr', english: 'en', spanish: 'es' };

/**
 * Langue ISO 639-1 d'un post : nom connu converti, code gardé tel quel, langue de la requête si
 * absente. Une autre langue (« german ») est rendue telle quelle et `makeArticle` écarte l'article.
 */
export function webzLang(language: string | null | undefined, fallback: Lang): string {
  const l = (language ?? '').trim().toLowerCase();
  return l === '' ? fallback : (LANG_CODES[l] ?? l);
}

/** `GET /newsApiLite?token=…&q=…` ; le jeton est dans l'URL, d'où le masquage des messages d'erreur. */
export async function webzSearch(q: string, c: { token: string; fetch: HttpFetch; timeoutMs: number }): Promise<WebzPost[]> {
  const url = `${WEBZ_LITE}?${new URLSearchParams({ token: c.token, q })}`;
  return ResponseSchema.parse(await fetchJson(c.fetch, url, { timeoutMs: c.timeoutMs })).posts.flatMap((p) => {
    const r = PostSchema.safeParse(p);
    return r.success ? [r.data] : [];
  });
}

/**
 * Secours Webz pour les langues dont la découverte principale est sous le seuil. **R1** : le texte
 * d'un domaine qui n'est pas `full` est écarté par `makeArticle` ; aucun chapô n'est tiré du texte.
 * Les articles datés d'avant la fenêtre de collecte sont ignorés.
 */
export async function collectWebz(ctx: SourceContext, token: string, langs: Lang[]): Promise<SourceRun> {
  const cfg = ctx.config.webz;
  const run = emptyRun();
  const breaker = new Breaker();
  for (const lang of langs) {
    if (breaker.open || run.requests >= cfg.maxRequests) break;
    run.requests++;
    try {
      for (const p of await webzSearch(cfg.queries[lang], { token, fetch: ctx.fetch, timeoutMs: cfg.timeoutMs })) {
        const published = toIso(p.published);
        if (published && published < ctx.windowStart.toISOString()) continue;
        const { article, discardedText } = makeArticle(
          {
            url: p.url,
            title: p.title || p.thread?.title,
            outlet: p.thread?.site,
            lang: webzLang(p.language, lang),
            publishedAt: published,
            origin: 'webz',
            text: p.text,
          },
          ctx.whitelist,
        );
        if (discardedText) run.discardedTexts++;
        if (article) run.candidates.push({ article });
      }
    } catch (e) {
      if (recordFailure(run, breaker, `webz ${lang}`, e)) break;
    }
  }
  return run;
}
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run pipeline/test/collect/exa.test.ts pipeline/test/collect/webz.test.ts && npm run typecheck`
Attendu : `Tests  11 passed (11)` (6 + 5), typage propre.

Commande : `npm test`
Attendu : `Test Files  39 passed (39)`, `Tests  298 passed (298)`.

- [ ] **Étape 6 : commit**

```bash
git add pipeline/collect/exa.ts pipeline/collect/webz.ts pipeline/test/collect/exa.test.ts pipeline/test/collect/webz.test.ts fixtures/api
git commit -m "feat(collect): Exa (texte seulement pour les domaines full) et secours Webz"
```

---

### Tâche 6 : flux RSS et Atom

**Fichiers :**
- Modifier : `pipeline/package.json`, `package-lock.json` (fast-xml-parser), `fixtures/api/README.md`
- Créer : `pipeline/config/feeds.json`, `pipeline/collect/rss.ts`, `fixtures/api/rss-euronews-fr.xml`, `fixtures/api/atom-elsalto.xml`
- Test : `pipeline/test/collect/rss.test.ts`

Comportement attendu :
- **`feeds.json`.** Il ne liste que des domaines `full` ou `feed` de `whitelist.json` : un test le vérifie, et `collectRss` ignore de toute façon un flux hors liste avec une erreur dans le bilan.
- **Analyse.** RSS 2.0 (CDATA, entités, `guid` comme lien de secours) et Atom (lien `alternate`, date de publication ou de mise à jour). Un document qui n'est ni l'un ni l'autre lève une erreur. Les entités imbriquées ne sont pas développées à l'infini : fast-xml-parser borne l'expansion.
- **Collecte.** Métadonnées seulement (titre, lien, chapô en texte brut, date, média) : aucun texte, même si le flux contient `content:encoded`. Seuls les liens vers un domaine `full` ou `feed` sont gardés. Les articles datés d'avant la fenêtre sont ignorés, et un flux donne au plus `maxItemsPerFeed` articles.
- **Pannes.** Délai et taille bornés, 4 flux à la fois. Un flux en échec, trop lourd ou muet n'empêche pas les autres. Les résultats suivent l'ordre de `feeds.json`.
- **En-têtes.** Chaque requête envoie `ACCEPT_FEED` et `USER_AGENT` (`http.ts`).

- [ ] **Étape 1 : installer fast-xml-parser**

Commande : `npm install -w pipeline fast-xml-parser@^5.12.0 && npm ls fast-xml-parser`
Attendu : `fast-xml-parser@5.12.0` listé sous `@daily-brief/pipeline`. `pipeline/package.json` devient :

```json
{
  "name": "@daily-brief/pipeline",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@daily-brief/maps": "*",
    "@daily-brief/render-pdf": "*",
    "@daily-brief/schema": "*",
    "fast-xml-parser": "^5.12.0",
    "zod": "^4.0.0"
  }
}
```

- [ ] **Étape 2 : écrire les flux construits et `feeds.json`**

`fixtures/api/rss-euronews-fr.xml` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Euronews (exemple construit)</title>
    <link>https://fr.euronews.com</link>
    <description>Flux construit pour les tests, d'après la forme RSS 2.0 du flux Euronews.</description>
    <item>
      <title><![CDATA[L'UE et le Royaume-Uni veulent relier leurs marchés du carbone]]></title>
      <link>https://fr.euronews.com/2026/11/06/lue-et-le-royaume-uni-veulent-relier-leurs-marches-du-carbone?utm_source=rss</link>
      <guid>https://fr.euronews.com/2026/11/06/lue-et-le-royaume-uni-veulent-relier-leurs-marches-du-carbone</guid>
      <pubDate>Fri, 06 Nov 2026 04:59:02 +0100</pubDate>
      <description>&lt;p&gt;L'accord pourrait éviter aux industriels des taxes carbone aux frontières.&lt;/p&gt;</description>
      <content:encoded><![CDATA[<p>Texte intégral du flux : jamais repris par la collecte (le texte passe par fulltext.ts).</p>]]></content:encoded>
    </item>
    <item>
      <title>Grève &amp; mobilisation : l&#8217;intersyndicale se réunit</title>
      <guid isPermaLink="true">https://fr.euronews.com/2026/11/06/greve-et-mobilisation</guid>
      <pubDate>Fri, 06 Nov 2026 03:10:00 +0100</pubDate>
      <description>Sans balise link : le guid sert de lien.</description>
    </item>
    <item>
      <title>Lien vers un média au statut meta</title>
      <link>https://www.lemonde.fr/economie/article/2026/11/06/x.html</link>
      <pubDate>Fri, 06 Nov 2026 02:00:00 +0100</pubDate>
      <description>Doit être ignoré : lemonde.fr n'est ni full ni feed.</description>
    </item>
    <item>
      <title>Article d'il y a une semaine</title>
      <link>https://fr.euronews.com/2026/10/30/article-ancien</link>
      <pubDate>Fri, 30 Oct 2026 10:00:00 +0100</pubDate>
      <description>Hors fenêtre de 24 h.</description>
    </item>
    <item>
      <title>Article sans lien ni guid</title>
      <pubDate>Fri, 06 Nov 2026 01:00:00 +0100</pubDate>
    </item>
  </channel>
</rss>
```

`fixtures/api/atom-elsalto.xml` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>El Salto (ejemplo construido)</title>
  <id>https://www.elsaltodiario.com/general/feed</id>
  <updated>2026-11-06T04:00:00Z</updated>
  <entry>
    <title type="html">Vivienda: el Gobierno prepara un tope a los alquileres de temporada</title>
    <link rel="alternate" type="text/html" href="https://www.elsaltodiario.com/vivienda/tope-alquileres-temporada"/>
    <link rel="enclosure" type="image/jpeg" href="https://static.elsaltodiario.com/img/alquiler.jpg"/>
    <id>tag:elsaltodiario.com,2026:vivienda-tope</id>
    <published>2026-11-06T03:30:00Z</published>
    <updated>2026-11-06T03:45:00Z</updated>
    <summary type="html"><![CDATA[El Ministerio de Vivienda ultima una norma.<br/><a href='https://www.elsaltodiario.com/vivienda'>Vivienda</a>]]></summary>
  </entry>
  <entry>
    <title>Entrada sin fecha</title>
    <link href="https://www.elsaltodiario.com/opinion/entrada-sin-fecha"/>
    <id>tag:elsaltodiario.com,2026:sin-fecha</id>
    <summary>Sin fecha de publicación: se conserva.</summary>
  </entry>
</feed>
```

Ajouter à la fin de `fixtures/api/README.md` :

```markdown
- `rss-euronews-fr.xml` et `atom-elsalto.xml` : flux RSS 2.0 et Atom construits d'après la forme des flux Euronews et El Salto (CDATA, entités, `guid` sans `link`, lien `alternate`, article hors liste blanche, hors fenêtre ou sans lien).
```

Les URL des flux ont été vérifiées le 06/11/2026, puis le 11/11/2026 avec les en-têtes de `http.ts` (democrata.es répond 403 : simple avertissement).

`pipeline/config/feeds.json` :

```json
{
  "note": "Flux RSS/Atom lus par brief:collect. Uniquement des domaines au statut full ou feed de whitelist.json (test pipeline/test/collect/rss.test.ts). Le flux ne donne que des métadonnées ; le texte intégral passe par fulltext.ts, pour les domaines full seulement (R1). URL vérifiées le 06/11/2026 (thehill.com a répondu 429 ce jour-là).",
  "feeds": [
    { "url": "https://fr.euronews.com/rss", "outlet": "Euronews", "lang": "fr" },
    { "url": "https://www.sudradio.fr/feed", "outlet": "Sud Radio", "lang": "fr" },
    { "url": "https://www.euronews.com/rss", "outlet": "Euronews", "lang": "en" },
    { "url": "https://www.aljazeera.com/xml/rss/all.xml", "outlet": "Al Jazeera", "lang": "en" },
    { "url": "https://www.cbsnews.com/latest/rss/main", "outlet": "CBS News", "lang": "en" },
    { "url": "https://www.pbs.org/newshour/feeds/rss/headlines", "outlet": "PBS NewsHour", "lang": "en" },
    { "url": "https://feeds.npr.org/1001/rss.xml", "outlet": "NPR", "lang": "en" },
    { "url": "https://thehill.com/feed/", "outlet": "The Hill", "lang": "en" },
    { "url": "https://es.euronews.com/rss", "outlet": "Euronews", "lang": "es" },
    { "url": "https://www.eldiario.es/rss/", "outlet": "elDiario.es", "lang": "es" },
    { "url": "https://www.elsaltodiario.com/general/feed", "outlet": "El Salto", "lang": "es" },
    { "url": "https://alicanteplaza.es/rss", "outlet": "Alicante Plaza", "lang": "es" },
    { "url": "https://www.democrata.es/feed/", "outlet": "Demócrata", "lang": "es" }
  ]
}
```

- [ ] **Étape 3 : écrire le test qui échoue**

`pipeline/test/collect/rss.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCEPT_FEED, USER_AGENT } from '../../collect/http';
import { collectRss, isReadableFeedDomain, loadFeeds, parseFeed, type Feed } from '../../collect/rss';
import { lookupDomain, loadWhitelist } from '../../lib/whitelist';
import { repoPath, WHITELIST_PATH } from '../helpers';
import { FEEDS_PATH, testContext } from './source-context';
import { fakeHttp } from './fake-http';

const wl = loadWhitelist(WHITELIST_PATH);
const xml = (name: string) => readFileSync(repoPath(`fixtures/api/${name}`), 'utf8');
const RSS_TYPE = 'application/rss+xml; charset=utf-8';

describe('feeds.json', () => {
  it('ne liste que des domaines full ou feed de la liste blanche', () => {
    const feeds = loadFeeds(FEEDS_PATH);
    expect(feeds.length).toBeGreaterThan(0);
    for (const f of feeds) expect(lookupDomain(wl, f.url)?.status, f.url).toMatch(/^(full|feed)$/);
    expect(feeds.every((f) => isReadableFeedDomain(wl, f.url))).toBe(true);
    expect(new Set(feeds.map((f) => f.lang))).toEqual(new Set(['fr', 'en', 'es']));
  });
});

describe('parseFeed', () => {
  it('lit le RSS 2.0 : CDATA, entités, guid en lien de secours', () => {
    const items = parseFeed(xml('rss-euronews-fr.xml'));
    expect(items).toHaveLength(5);
    expect(items[0]).toEqual({
      title: "L'UE et le Royaume-Uni veulent relier leurs marchés du carbone",
      link: 'https://fr.euronews.com/2026/11/06/lue-et-le-royaume-uni-veulent-relier-leurs-marches-du-carbone?utm_source=rss',
      description: "<p>L'accord pourrait éviter aux industriels des taxes carbone aux frontières.</p>",
      published: 'Fri, 06 Nov 2026 04:59:02 +0100',
    });
    expect(items[1].title).toBe('Grève & mobilisation : l’intersyndicale se réunit');
    expect(items[1].link).toBe('https://fr.euronews.com/2026/11/06/greve-et-mobilisation');
    expect(items[4].link).toBeNull();
  });

  it('lit l’Atom : lien alternate, date de publication ou de mise à jour', () => {
    const items = parseFeed(xml('atom-elsalto.xml'));
    expect(items.map((i) => i.link)).toEqual(['https://www.elsaltodiario.com/vivienda/tope-alquileres-temporada', 'https://www.elsaltodiario.com/opinion/entrada-sin-fecha']);
    expect(items[0].published).toBe('2026-11-06T03:30:00Z');
    expect(items[1].published).toBeNull();
  });

  it('lève sur un document qui n’est pas un flux, sans développer les entités en chaîne', () => {
    expect(() => parseFeed('<html><body>Erreur</body></html>')).toThrow('ni RSS 2.0 ni Atom');
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]>' +
      '<rss><channel><item><title>&c;</title><link>https://fr.euronews.com/x</link></item></channel></rss>';
    expect(parseFeed(bomb)[0].title.length).toBeLessThan(1000);
  });
});

describe('collectRss', () => {
  const feeds: Feed[] = [
    { url: 'https://fr.euronews.com/rss', outlet: 'Euronews', lang: 'fr' },
    { url: 'https://www.elsaltodiario.com/general/feed', outlet: 'El Salto', lang: 'es' },
  ];

  it('garde les articles récents des domaines full/feed, sans texte', async () => {
    const { fetch, calls } = fakeHttp({
      'https://fr.euronews.com/rss': { body: xml('rss-euronews-fr.xml'), type: RSS_TYPE },
      'https://www.elsaltodiario.com/general/feed': { body: xml('atom-elsalto.xml'), type: 'application/atom+xml' },
    });
    const run = await collectRss(testContext(fetch), feeds);
    expect(run.requests).toBe(2);
    expect(calls[0].headers).toEqual({ accept: ACCEPT_FEED, 'user-agent': USER_AGENT });
    expect(run.errors).toEqual([]);
    expect(run.candidates.map((c) => c.article.url)).toEqual([
      'https://fr.euronews.com/2026/11/06/lue-et-le-royaume-uni-veulent-relier-leurs-marches-du-carbone',
      'https://fr.euronews.com/2026/11/06/greve-et-mobilisation',
      'https://elsaltodiario.com/vivienda/tope-alquileres-temporada',
      'https://elsaltodiario.com/opinion/entrada-sin-fecha',
    ]);
    const first = run.candidates[0].article;
    expect(first).toMatchObject({ outlet: 'Euronews', lang: 'fr', origin: 'rss', text: null, publishedAt: '2026-11-06T03:59:02.000Z' });
    expect(first.description).toBe("L'accord pourrait éviter aux industriels des taxes carbone aux frontières.");
    expect(run.candidates.every((c) => c.article.text === null)).toBe(true);
  });

  it('un flux en échec, trop lourd ou hors liste blanche n’empêche pas les autres', async () => {
    const { fetch, calls } = fakeHttp({
      'https://fr.euronews.com/rss': { status: 503, body: '' },
      'https://www.elsaltodiario.com/general/feed': { body: xml('atom-elsalto.xml'), headers: { 'content-length': '99999999' } },
      'https://es.euronews.com/rss': { body: xml('rss-euronews-fr.xml').replaceAll('fr.euronews.com', 'es.euronews.com'), type: RSS_TYPE },
    });
    const run = await collectRss(testContext(fetch), [
      ...feeds,
      { url: 'https://www.lemonde.fr/rss/une.xml', outlet: 'Le Monde', lang: 'fr' },
      { url: 'https://es.euronews.com/rss', outlet: 'Euronews', lang: 'es' },
    ]);
    expect(calls.map((c) => c.url)).not.toContain('https://www.lemonde.fr/rss/une.xml');
    expect(run.errors).toEqual([
      'rss https://fr.euronews.com/rss : HTTP 503 (https://fr.euronews.com/rss)',
      'rss https://www.elsaltodiario.com/general/feed : corps trop lourd (99999999 octets)',
      'rss https://www.lemonde.fr/rss/une.xml : domaine ni full ni feed, flux ignoré',
    ]);
    expect(run.candidates).toHaveLength(2);
  });

  it('borne le nombre d’articles par flux et ne reste pas bloqué sur un flux muet', async () => {
    const { fetch } = fakeHttp({ 'https://fr.euronews.com/rss': { body: xml('rss-euronews-fr.xml'), type: RSS_TYPE }, 'https://www.elsaltodiario.com/': { hang: true } });
    const run = await collectRss(
      testContext(fetch, (c) => {
        c.rss.maxItemsPerFeed = 1;
        c.rss.timeoutMs = 20;
      }),
      feeds,
    );
    expect(run.candidates).toHaveLength(1);
    expect(run.errors).toEqual(['rss https://www.elsaltodiario.com/general/feed : The operation was aborted due to timeout']);
  });
});
```

- [ ] **Étape 4 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/collect/rss.test.ts`
Attendu : ÉCHEC, « Cannot find module '../../collect/rss' ».

- [ ] **Étape 5 : écrire `rss.ts`**

`pipeline/collect/rss.ts` :

```ts
import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { LangSchema, UrlSchema } from '@daily-brief/schema';
import { lookupDomain, type Whitelist } from '../lib/whitelist';
import { makeArticle, toIso } from './article';
import { ACCEPT_FEED, decodeBody, deadline, HttpError, messageOf, readCapped, USER_AGENT, type HttpFetch } from './http';
import { mapLimit } from './limit';
import { emptyRun, type Candidate, type SourceContext, type SourceRun } from './types';

const FeedSchema = z.strictObject({ url: UrlSchema, outlet: z.string().min(1), lang: LangSchema });
const FeedsSchema = z.strictObject({ note: z.string().optional(), feeds: z.array(FeedSchema) });

export type Feed = z.infer<typeof FeedSchema>;
export type FeedItem = { title: string; link: string | null; description: string; published: string | null };

export function loadFeeds(path: string): Feed[] {
  return FeedsSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).feeds;
}

/** Un flux n'est lu que sur un domaine `full` ou `feed` de la liste blanche. */
export function isReadableFeedDomain(wl: Whitelist, url: string): boolean {
  const status = lookupDomain(wl, url)?.status;
  return status === 'full' || status === 'feed';
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
});

/** Texte d'un nœud analysé (chaîne, nombre, `{ '#text' }` ou premier élément d'un tableau). */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (v && typeof v === 'object' && '#text' in v) return textOf((v as Record<string, unknown>)['#text']);
  return '';
}

/** Lien d'un article : texte (RSS) ou `href` du lien `alternate` ou sans `rel` (Atom). */
function linkOf(v: unknown): string | null {
  const links = Array.isArray(v) ? v : v === undefined ? [] : [v];
  for (const l of links) if (typeof l === 'string' && l.trim()) return l.trim();
  const atom = links.filter((l): l is Record<string, unknown> => !!l && typeof l === 'object');
  const best = atom.find((l) => l['@_rel'] === undefined || l['@_rel'] === 'alternate') ?? atom[0];
  const href = best?.['@_href'];
  return typeof href === 'string' && href.trim() ? href.trim() : null;
}

const RssDoc = z.object({ rss: z.object({ channel: z.object({ item: z.array(z.record(z.string(), z.unknown())).optional() }) }) });
const AtomDoc = z.object({ feed: z.object({ entry: z.array(z.record(z.string(), z.unknown())).optional() }) });

/** Articles d'un flux RSS 2.0 ou Atom ; lève si le document n'est ni l'un ni l'autre. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  const rss = RssDoc.safeParse(doc);
  if (rss.success) {
    return (rss.data.rss.channel.item ?? []).map((i) => ({
      title: textOf(i.title),
      link: linkOf(i.link) ?? (/^https?:/.test(textOf(i.guid)) ? textOf(i.guid) : null),
      description: textOf(i.description),
      published: textOf(i.pubDate) || textOf(i['dc:date']) || null,
    }));
  }
  const atom = AtomDoc.safeParse(doc);
  if (atom.success) {
    return (atom.data.feed.entry ?? []).map((e) => ({
      title: textOf(e.title),
      link: linkOf(e.link),
      description: textOf(e.summary),
      published: textOf(e.published) || textOf(e.updated) || null,
    }));
  }
  throw new Error('ni RSS 2.0 ni Atom');
}

/** Télécharge et analyse un flux (délai, taille bornée). */
export async function fetchFeed(url: string, c: { fetch: HttpFetch; timeoutMs: number; maxBytes: number }): Promise<FeedItem[]> {
  const res = await c.fetch(url, { signal: deadline(c.timeoutMs), headers: { accept: ACCEPT_FEED, 'user-agent': USER_AGENT } });
  if (!res.ok) throw new HttpError(res.status, url);
  return parseFeed(decodeBody(await readCapped(res, c.maxBytes), res.headers.get('content-type')));
}

/**
 * Lit les flux de `feeds.json` (4 à la fois). Seuls les liens vers un domaine `full` ou `feed`
 * sont gardés, sans texte : les métadonnées seulement. Articles datés d'avant la fenêtre ignorés,
 * `maxItemsPerFeed` au plus par flux. Un flux en échec n'arrête pas les autres.
 */
export async function collectRss(ctx: SourceContext, feeds: Feed[]): Promise<SourceRun> {
  const cfg = ctx.config.rss;
  const run = emptyRun();
  const since = ctx.windowStart.toISOString();
  const perFeed = await mapLimit(feeds, 4, async (feed): Promise<{ candidates: Candidate[]; error?: string }> => {
    if (!isReadableFeedDomain(ctx.whitelist, feed.url)) return { candidates: [], error: `rss ${feed.url} : domaine ni full ni feed, flux ignoré` };
    run.requests++;
    try {
      const items = await fetchFeed(feed.url, { fetch: ctx.fetch, timeoutMs: cfg.timeoutMs, maxBytes: cfg.maxBytes });
      const candidates: Candidate[] = [];
      for (const it of items) {
        if (candidates.length >= cfg.maxItemsPerFeed) break;
        if (!it.link || !isReadableFeedDomain(ctx.whitelist, it.link)) continue;
        const published = toIso(it.published);
        if (published && published < since) continue;
        const { article } = makeArticle(
          { url: it.link, title: it.title, outlet: feed.outlet, description: it.description, lang: feed.lang, publishedAt: published, origin: 'rss' },
          ctx.whitelist,
        );
        if (article) candidates.push({ article });
      }
      return { candidates };
    } catch (e) {
      return { candidates: [], error: `rss ${feed.url} : ${messageOf(e)}` };
    }
  });
  // Ordre de feeds.json, quel que soit l'ordre d'arrivée des réponses.
  for (const r of perFeed) {
    run.candidates.push(...r.candidates);
    if (r.error) run.errors.push(r.error);
  }
  return run;
}
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run pipeline/test/collect/rss.test.ts && npm run typecheck`
Attendu : `Tests  7 passed (7)`, typage propre.

Commande : `npm test`
Attendu : `Test Files  40 passed (40)`, `Tests  305 passed (305)`.

- [ ] **Étape 7 : commit**

```bash
git add pipeline/package.json package-lock.json pipeline/config/feeds.json pipeline/collect/rss.ts pipeline/test/collect/rss.test.ts fixtures/api
git commit -m "feat(collect): flux RSS et Atom des domaines full et feed"
```

---

### Tâche 7 : texte intégral des seuls domaines `full`

**Fichiers :**
- Modifier : `pipeline/package.json`, `package-lock.json` (@mozilla/readability, linkedom), `fixtures/api/README.md`
- Créer : `pipeline/collect/fulltext.ts`, `fixtures/api/article-euronews.html`
- Test : `pipeline/test/collect/fulltext.test.ts`

Comportement attendu :
- **Garde R1, testée unitairement.** `fetchFullText` lève `NotFullError` **avant toute requête** si l'URL n'est pas sur un domaine `full` : domaine `meta`, `feed`, inconnu, non http(s) ou illisible. Il suit les redirections lui-même (`redirect: 'manual'`, 3 au plus) et revérifie chaque cible : une redirection vers un autre domaine n'est jamais suivie.
- **Contrôles de la réponse.** HTML seulement (`text/html`, `application/xhtml+xml`), corps limité à `maxBytes` (en flux), délai par page, au moins `minChars` caractères de texte.
- **Extraction.** `extractText` passe la page à Readability sur un document linkedom, puis garde un bloc par paragraphe (titres, paragraphes, éléments de liste, citations), séparés par une ligne vide. Menus, scripts, encadrés et pied de page sont exclus.
- **Remplissage.** `fillFullTexts` ne touche qu'aux articles sans texte et sur un domaine `full`, sans modifier l'entrée.
  - **Ordre.** Langues en alternance (`fullTextTargets`), pour que le plafond `maxFetches` profite aux trois éditions.
  - **Bornes.** Au plus `concurrency` pages à la fois (4) ; à l'échéance `deadlineMs`, tout s'arrête.
  - **Hôte en panne.** Un hôte qui répond 401, 402, 403 ou 429, ou qui ne répond pas, est abandonné pour le reste du passage.

  Les erreurs sont triées, 20 au plus.

- [ ] **Étape 1 : installer Readability et linkedom**

Commande : `npm install -w pipeline @mozilla/readability@^0.6.0 linkedom@^0.18.15 && npm ls @mozilla/readability linkedom`
Attendu : `@mozilla/readability@0.6.0` et `linkedom@0.18.15` listés sous `@daily-brief/pipeline`. `pipeline/package.json` devient :

```json
{
  "name": "@daily-brief/pipeline",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@daily-brief/maps": "*",
    "@daily-brief/render-pdf": "*",
    "@daily-brief/schema": "*",
    "@mozilla/readability": "^0.6.0",
    "fast-xml-parser": "^5.12.0",
    "linkedom": "^0.18.15",
    "zod": "^4.0.0"
  }
}
```

- [ ] **Étape 2 : écrire la page construite**

`fixtures/api/article-euronews.html` :

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>COP31 : les négociations butent sur le financement | Euronews (page construite)</title>
  <script>window.tracking = "ne doit jamais apparaître";</script>
  <style>body { font-family: sans-serif; }</style>
</head>
<body>
  <header><nav><a href="/">Accueil</a> <a href="/monde">Monde</a> <a href="/newsletter">Newsletter</a></nav></header>
  <main>
    <article>
      <h1>COP31 : les négociations butent sur le financement</h1>
      <p class="byline">Par la rédaction · 06/11/2026</p>
      <p>Les délégations réunies à Belém n'ont pas trouvé d'accord jeudi sur le financement de l'adaptation au changement climatique, malgré une nuit de discussions entre les principaux blocs de pays.</p>
      <p>« Nous ne repartirons pas sans un chiffre », a déclaré la ministre brésilienne de l'Environnement, Marina Silva, devant la presse à l'issue de la séance plénière.</p>
      <p>Les pays en développement réclament 300 milliards de dollars par an d'ici 2035, un montant que plusieurs pays européens jugent hors de portée dans le contexte budgétaire actuel.</p>
      <blockquote><p>« L'adaptation n'est pas une option, c'est une question de survie », a rappelé le représentant des petits États insulaires.</p></blockquote>
      <ul>
        <li>Prochaine séance plénière : vendredi matin.</li>
        <li>Clôture prévue : samedi soir.</li>
      </ul>
    </article>
  </main>
  <aside><p>À lire aussi : nos autres articles sur le climat et l'énergie, abonnez-vous à la newsletter.</p></aside>
  <footer><p>© Euronews 2026 · Mentions légales · Cookies</p></footer>
</body>
</html>
```

Ajouter à la fin de `fixtures/api/README.md` :

```markdown
- `article-euronews.html` : page d'article construite (menu, script, article, encadré, pied de page) pour l'extraction du texte intégral.
```

- [ ] **Étape 3 : écrire le test qui échoue**

`pipeline/test/collect/fulltext.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RawArticle } from '@daily-brief/schema';
import { extractText, fetchFullText, fillFullTexts, fullTextTargets, NotFullError } from '../../collect/fulltext';
import { USER_AGENT } from '../../collect/http';
import type { HttpFetch } from '../../collect/http';
import { loadWhitelist } from '../../lib/whitelist';
import { repoPath, WHITELIST_PATH } from '../helpers';
import { fakeHttp } from './fake-http';

const wl = loadWhitelist(WHITELIST_PATH);
const PAGE = readFileSync(repoPath('fixtures/api/article-euronews.html'), 'utf8');
const URL_FULL = 'https://fr.euronews.com/2026/11/06/cop31';
const base = { whitelist: wl, timeoutMs: 1000, maxBytes: 1_000_000, minChars: 200 };

const art = (url: string, text: string | null = null, lang = 'fr'): RawArticle => ({
  id: url,
  url,
  outlet: 'x',
  title: 't',
  description: null,
  lang,
  publishedAt: null,
  origin: 'rss',
  text,
});

describe('extractText', () => {
  it('garde le corps de l’article, un paragraphe par ligne, sans menu, script ni pied de page', () => {
    const text = extractText(PAGE);
    const paras = text.split('\n\n');
    expect(paras).toContain('« Nous ne repartirons pas sans un chiffre », a déclaré la ministre brésilienne de l\'Environnement, Marina Silva, devant la presse à l\'issue de la séance plénière.');
    expect(paras).toContain('Prochaine séance plénière : vendredi matin.');
    expect(text).not.toMatch(/tracking|Newsletter|Mentions légales|Cookies/);
    expect(text).not.toContain('\n\n\n');
  });

  it('renvoie une chaîne vide pour une page sans contenu', () => {
    expect(extractText('<html><body></body></html>')).toBe('');
  });
});

describe('fetchFullText : garde R1', () => {
  it('n’envoie aucune requête pour un domaine meta, feed, inconnu ou non http(s)', async () => {
    const { fetch, calls } = fakeHttp({ 'https://': { body: PAGE } });
    for (const url of ['https://www.lemonde.fr/a', 'https://www.npr.org/a', 'https://inconnu.example/a', 'ftp://fr.euronews.com/a', 'pas une url']) {
      await expect(fetchFullText(url, { ...base, fetch })).rejects.toBeInstanceOf(NotFullError);
    }
    expect(calls).toEqual([]);
  });

  it('suit une redirection vers un domaine full, refuse celle vers un autre domaine sans la suivre', async () => {
    const { fetch, calls } = fakeHttp({
      'https://fr.euronews.com/court': { status: 301, headers: { location: '/2026/11/06/cop31' }, type: null },
      'https://fr.euronews.com/2026/11/06/cop31': { body: PAGE },
      'https://fr.euronews.com/fuite': { status: 302, headers: { location: 'https://www.lemonde.fr/copie' }, type: null },
    });
    expect(await fetchFullText('https://fr.euronews.com/court', { ...base, fetch })).toContain('Belém');
    await expect(fetchFullText('https://fr.euronews.com/fuite', { ...base, fetch })).rejects.toBeInstanceOf(NotFullError);
    expect(calls.map((c) => c.url)).toEqual(['https://fr.euronews.com/court', URL_FULL, 'https://fr.euronews.com/fuite']);
    expect(calls.every((c) => c.redirect === 'manual')).toBe(true);
  });

  it('refuse un type non HTML, un corps trop lourd, un texte trop court et une boucle de redirections', async () => {
    const { fetch } = fakeHttp({
      'https://fr.euronews.com/pdf': { body: '%PDF', type: 'application/pdf' },
      'https://fr.euronews.com/lourd': { body: PAGE, headers: { 'content-length': '5000000' } },
      'https://fr.euronews.com/court-texte': { body: '<html><body><article><p>Bref.</p></article></body></html>' },
      'https://fr.euronews.com/boucle': { status: 302, headers: { location: '/boucle' }, type: null },
    });
    await expect(fetchFullText('https://fr.euronews.com/pdf', { ...base, fetch })).rejects.toThrow('type application/pdf refusé');
    await expect(fetchFullText('https://fr.euronews.com/lourd', { ...base, fetch })).rejects.toThrow('corps trop lourd');
    await expect(fetchFullText('https://fr.euronews.com/court-texte', { ...base, fetch })).rejects.toThrow('texte trop court');
    await expect(fetchFullText('https://fr.euronews.com/boucle', { ...base, fetch })).rejects.toThrow('trop de redirections');
  });
});

describe('fillFullTexts', () => {
  const opts = { ...base, concurrency: 2, maxFetches: 10, deadlineMs: 5000 };

  it('alterne les langues pour partager le plafond entre les éditions', async () => {
    const input = [
      art('https://fr.euronews.com/1'),
      art('https://fr.euronews.com/2'),
      art('https://fr.euronews.com/3'),
      art('https://www.euronews.com/4', null, 'en'),
      art('https://lemonde.fr/5', null, 'en'),
      art('https://es.euronews.com/6', null, 'es'),
      art('https://es.euronews.com/7', null, 'es'),
    ];
    expect(fullTextTargets(input, wl)).toEqual([0, 3, 5, 1, 6, 2]);
    const { fetch, calls } = fakeHttp({ 'https://': { body: PAGE } });
    const { stats } = await fillFullTexts(input, { ...opts, concurrency: 1, maxFetches: 3, fetch });
    expect(calls.map((c) => c.url)).toEqual(['https://fr.euronews.com/1', 'https://www.euronews.com/4', 'https://es.euronews.com/6']);
    expect(calls[0].headers).toMatchObject({ 'user-agent': USER_AGENT });
    expect(stats).toMatchObject({ extracted: 3, skipped: 3 });
  });

  it('ne complète que les articles full sans texte, en gardant l’ordre', async () => {
    const { fetch, calls } = fakeHttp({ 'https://fr.euronews.com/': { body: PAGE }, 'https://sudradio.fr/': { body: PAGE } });
    const input = [art('https://lemonde.fr/a'), art('https://fr.euronews.com/b'), art('https://sudradio.fr/c', 'déjà lu'), art('https://npr.org/d'), art('https://sudradio.fr/e')];
    const { articles, stats } = await fillFullTexts(input, { ...opts, fetch });
    expect(calls.map((c) => c.url)).toEqual(['https://fr.euronews.com/b', 'https://sudradio.fr/e']);
    expect(articles.map((a) => (a.text ? a.text.slice(0, 4) : null))).toEqual([null, 'Les ', 'déjà', null, 'Les ']);
    expect(stats).toMatchObject({ attempted: 2, extracted: 2, failed: 0, skipped: 0 });
    expect(input[1].text).toBeNull();
  });

  it('abandonne un hôte après un 403 et borne le nombre de pages', async () => {
    const { fetch, calls } = fakeHttp({ 'https://fr.euronews.com/': { status: 403, body: '' } });
    const input = ['a', 'b', 'c', 'd', 'e'].map((x) => art(`https://fr.euronews.com/${x}`));
    const { stats } = await fillFullTexts(input, { ...opts, concurrency: 1, maxFetches: 4, fetch });
    expect(calls).toHaveLength(1);
    expect(stats).toMatchObject({ attempted: 1, failed: 1, skipped: 4 });
    expect(stats.errors).toEqual(['https://fr.euronews.com/a : HTTP 403 (https://fr.euronews.com/a)']);
  });

  it('borne la concurrence à 4 et s’arrête à l’échéance globale', async () => {
    let active = 0;
    let peak = 0;
    const inner = fakeHttp({ 'https://fr.euronews.com/': { body: PAGE }, 'https://sudradio.fr/': { hang: true } });
    const fetch: HttpFetch = async (url, init) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise((r) => setTimeout(r, 5));
        return await inner.fetch(url, init);
      } finally {
        active--;
      }
    };
    const many = Array.from({ length: 12 }, (_, i) => art(`https://fr.euronews.com/${i}`));
    const r = await fillFullTexts(many, { ...opts, maxFetches: 20, concurrency: 4, fetch });
    expect(r.stats.extracted).toBe(12);
    expect(peak).toBe(4);
    const slow = Array.from({ length: 6 }, (_, i) => art(`https://sudradio.fr/${i}`));
    const t0 = Date.now();
    const s = await fillFullTexts(slow, { ...opts, timeoutMs: 10_000, concurrency: 2, deadlineMs: 50, fetch });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(s.stats.extracted).toBe(0);
    expect(s.stats.attempted + s.stats.skipped).toBe(6);
  });
});
```

- [ ] **Étape 4 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/collect/fulltext.test.ts`
Attendu : ÉCHEC, « Cannot find module '../../collect/fulltext' ».

- [ ] **Étape 5 : écrire `fulltext.ts`**

`pipeline/collect/fulltext.ts` :

```ts
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { RawArticle } from '@daily-brief/schema';
import { hostOf } from '../lib/url';
import { canReadFull, type Whitelist } from '../lib/whitelist';
import { Breaker } from './breaker';
import { ACCEPT_HTML, BodyError, decodeBody, deadline, HttpError, messageOf, mimeOf, readCapped, USER_AGENT, type HttpFetch } from './http';
import { mapLimit } from './limit';

/** Refus R1 : l'URL (ou une redirection) ne mène pas à un domaine `full`. Aucune requête n'est envoyée vers elle. */
export class NotFullError extends Error {
  constructor(url: string) {
    super(`R1 : ${url} n'est pas un domaine full`);
    this.name = 'NotFullError';
  }
}

export type FullTextOptions = {
  whitelist: Whitelist;
  fetch: HttpFetch;
  timeoutMs: number;
  maxBytes: number;
  minChars: number;
  maxRedirects?: number;
  /** Interruption globale (échéance de la phase). */
  signal?: AbortSignal;
};

const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption';
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/** Texte principal d'une page (Readability), un bloc par paragraphe, séparés par une ligne vide. */
export function extractText(html: string): string {
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]).parse();
  if (!article?.content) return '';
  const { document: doc } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
  const blocks = [...doc.querySelectorAll(BLOCKS)]
    .filter((el) => !el.querySelector(BLOCKS))
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return blocks.length > 0 ? blocks.join('\n\n') : (article.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Texte intégral d'un article. **Garde R1** : l'URL et chaque redirection doivent être sur un
 * domaine `full`, sinon NotFullError avant toute requête vers elles. http(s) seulement, délai,
 * taille et nombre de redirections bornés, HTML seulement, texte d'au moins `minChars` caractères.
 */
export async function fetchFullText(url: string, o: FullTextOptions): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
    if (!canReadFull(o.whitelist, current)) throw new NotFullError(current);
    const res = await o.fetch(current, {
      redirect: 'manual',
      signal: deadline(o.timeoutMs, o.signal),
      headers: { accept: ACCEPT_HTML, 'user-agent': USER_AGENT },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new HttpError(res.status, current);
    if (!HTML_TYPES.has(mimeOf(res))) throw new BodyError(`type ${mimeOf(res) || 'absent'} refusé`);
    const text = extractText(decodeBody(await readCapped(res, o.maxBytes), res.headers.get('content-type')));
    if (text.length < o.minChars) throw new BodyError(`texte trop court (${text.length} caractères)`);
    return text;
  }
  throw new Error('trop de redirections');
}

export type FullTextStats = { attempted: number; extracted: number; failed: number; skipped: number; errors: string[] };

/**
 * Indices des articles à lire, langues en alternance (FR, EN, ES, FR…) : le plafond `maxFetches`
 * est partagé entre les éditions au lieu d'être épuisé par la première. L'ordre interne à chaque
 * langue est conservé (celui de `dedupe` : les plus grands groupes d'abord).
 */
export function fullTextTargets(articles: RawArticle[], wl: Whitelist): number[] {
  const byLang = new Map<string, number[]>();
  articles.forEach((a, i) => {
    if (a.text !== null || !canReadFull(wl, a.url)) return;
    byLang.set(a.lang, [...(byLang.get(a.lang) ?? []), i]);
  });
  const queues = [...byLang.values()];
  const out: number[] = [];
  for (let k = 0; queues.some((q) => k < q.length); k++) for (const q of queues) if (k < q.length) out.push(q[k]);
  return out;
}

/**
 * Complète `text` des articles sans texte dont le domaine est `full` (et eux seuls), au plus
 * `concurrency` à la fois et `maxFetches` en tout, langues en alternance. Un hôte qui répond 401/402/403/429 ou ne
 * répond pas est abandonné ; après `deadlineMs`, les articles restants sont laissés sans texte.
 */
export async function fillFullTexts(
  articles: RawArticle[],
  o: Omit<FullTextOptions, 'signal'> & { concurrency: number; maxFetches: number; deadlineMs: number },
): Promise<{ articles: RawArticle[]; stats: FullTextStats }> {
  const stats: FullTextStats = { attempted: 0, extracted: 0, failed: 0, skipped: 0, errors: [] };
  const targets = fullTextTargets(articles, o.whitelist);
  stats.skipped = Math.max(0, targets.length - o.maxFetches);
  const phase = AbortSignal.timeout(o.deadlineMs);
  const breakers = new Map<string, Breaker>();
  const out = articles.map((a) => ({ ...a }));
  const errors: string[] = [];
  await mapLimit(targets.slice(0, o.maxFetches), o.concurrency, async (i) => {
    const host = hostOf(out[i].url);
    const breaker = breakers.get(host) ?? breakers.set(host, new Breaker()).get(host)!;
    if (phase.aborted || breaker.open) {
      stats.skipped++;
      return;
    }
    stats.attempted++;
    try {
      out[i].text = await fetchFullText(out[i].url, { ...o, signal: phase });
      stats.extracted++;
    } catch (e) {
      stats.failed++;
      breaker.trip(e);
      errors.push(`${out[i].url} : ${messageOf(e)}`);
    }
  });
  stats.errors = errors.sort().slice(0, 20);
  return { articles: out, stats };
}
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run pipeline/test/collect/fulltext.test.ts && npm run typecheck`
Attendu : `Tests  9 passed (9)`, typage propre.

Commande : `npm test`
Attendu : `Test Files  41 passed (41)`, `Tests  314 passed (314)`.

- [ ] **Étape 7 : commit**

```bash
git add pipeline/package.json package-lock.json pipeline/collect/fulltext.ts pipeline/test/collect/fulltext.test.ts fixtures/api
git commit -m "feat(collect): texte intégral des seuls domaines full (Readability + linkedom)"
```

---

### Tâche 8 : dédoublonnage et groupes

**Fichiers :**
- Créer : `pipeline/collect/dedupe.ts`
- Test : `pipeline/test/collect/dedupe.test.ts`

Comportement attendu :
- **Fusion par URL.** Les candidats sont fusionnés par URL normalisée ; une URL illisible est ignorée. L'article fusionné garde :
  - les métadonnées de la meilleure origine (RSS, puis TheNewsAPI, Exa et Webz) ;
  - le premier chapô non vide ;
  - la date la plus ancienne ;
  - un texte seulement si l'URL est sur un domaine `full` (R1).
- **Groupes.** Mêmes groupes pour les articles reliés par `/similar` (`seed`) et pour les titres de similarité de Jaccard ≥ 0,6. La similarité porte sur les trigrammes de caractères, sans accents, casse ni ponctuation. Les titres de moins de 20 caractères (« En direct ») ne sont jamais regroupés sur le seul titre.
- **Déterminisme.** L'ordre d'entrée ne change pas la sortie. `groupId` vaut `g-` suivi de l'empreinte du plus petit id du groupe. Tri : langue (FR, EN, ES), taille du groupe décroissante, groupe, id.

- [ ] **Étape 1 : écrire le test qui échoue**

`pipeline/test/collect/dedupe.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import type { RawArticle } from '@daily-brief/schema';
import { articleId } from '../../collect/article';
import { dedupe, jaccard, trigrams } from '../../collect/dedupe';
import type { Candidate } from '../../collect/types';
import { loadWhitelist } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);

const art = (url: string, title: string, extra: Partial<RawArticle> = {}): Candidate => ({
  article: { id: articleId(url), url, outlet: new URL(url).hostname, title, description: null, lang: 'fr', publishedAt: null, origin: 'thenewsapi', text: null, ...extra },
});

describe('similarité des titres', () => {
  it('Jaccard sur trigrammes, insensible aux accents, à la casse et à la ponctuation', () => {
    const sim = (a: string, b: string) => jaccard(trigrams(a), trigrams(b));
    expect(sim('Budget 2027 : le Sénat adopte la première partie du texte', 'Le Sénat adopte la première partie du budget 2027')).toBeCloseTo(0.873, 3);
    expect(sim('Budget 2027 : le Sénat adopte la première partie du texte', 'Budget 2027 : l’Assemblée rejette la seconde partie du texte')).toBeCloseTo(0.405, 3);
    expect(sim('ÉTÉ, été !', 'ete ete')).toBe(1);
  });
});

describe('dedupe', () => {
  it('fusionne une même URL vue par plusieurs sources : métadonnées RSS, chapô présent, date la plus ancienne', () => {
    const out = dedupe(
      [
        art('https://www.lemonde.fr/a?utm_source=x', 'Titre agrégateur', { publishedAt: '2026-11-06T05:00:00.000Z', origin: 'thenewsapi' }),
        art('https://lemonde.fr/a', 'Titre éditeur', { outlet: 'Le Monde', origin: 'rss', publishedAt: '2026-11-06T04:00:00.000Z' }),
        art('https://lemonde.fr/a#comments', 'Titre Exa', { description: 'Chapô', origin: 'exa' }),
      ],
      wl,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: articleId('https://lemonde.fr/a'),
      url: 'https://lemonde.fr/a',
      outlet: 'Le Monde',
      title: 'Titre éditeur',
      description: 'Chapô',
      publishedAt: '2026-11-06T04:00:00.000Z',
      origin: 'rss',
    });
  });

  it('R1 : ne garde un texte fusionné que pour un domaine full', () => {
    const out = dedupe(
      [
        art('https://lemonde.fr/b', 'Article Le Monde assez long pour le test', { text: 'texte qui n’aurait jamais dû arriver ici' }),
        art('https://sudradio.fr/c', 'Article Sud Radio assez long pour le test', { origin: 'rss' }),
        art('https://sudradio.fr/c', 'Article Sud Radio assez long pour le test', { origin: 'exa', text: 'Texte intégral légitime.' }),
      ],
      wl,
    );
    expect(out.find((a) => a.url.includes('lemonde'))!.text).toBeNull();
    expect(out.find((a) => a.url.includes('sudradio'))!.text).toBe('Texte intégral légitime.');
  });

  it('regroupe par titre (≥ 0,6) et par /similar, pas les titres courts ni les sujets voisins', () => {
    const seed = art('https://fr.euronews.com/retraites', 'Réforme des retraites : les syndicats appellent à une nouvelle journée de mobilisation');
    const out = dedupe(
      [
        art('https://lemonde.fr/budget', 'Budget 2027 : le Sénat adopte la première partie du texte'),
        art('https://lefigaro.fr/budget', 'Le Sénat adopte la première partie du budget 2027'),
        art('https://liberation.fr/budget-an', 'Budget 2027 : l’Assemblée rejette la seconde partie du texte'),
        seed,
        { ...art('https://lefigaro.fr/retraites', 'Retraites : une nouvelle journée de mobilisation fin novembre'), seed: seed.article.id },
        art('https://a.fr/direct', 'En direct'),
        art('https://b.fr/direct', 'En direct'),
      ],
      wl,
    );
    const group = (host: string) => out.find((a) => a.url.includes(host))!.groupId;
    expect(group('lemonde.fr/budget')).toBe(group('lefigaro.fr/budget'));
    expect(group('liberation.fr')).not.toBe(group('lemonde.fr/budget'));
    expect(group('lefigaro.fr/retraites')).toBe(group('euronews.com/retraites'));
    expect(group('a.fr/direct')).not.toBe(group('b.fr/direct'));
    expect(out.every((a) => /^g-[0-9a-f]{16}$/.test(a.groupId!))).toBe(true);
  });

  it('est déterministe : l’ordre d’entrée ne change pas la sortie', () => {
    const input = [
      art('https://lemonde.fr/budget', 'Budget 2027 : le Sénat adopte la première partie du texte'),
      art('https://bbc.co.uk/x', 'Budget vote in France: Senate adopts first part', { lang: 'en' }),
      art('https://lefigaro.fr/budget', 'Le Sénat adopte la première partie du budget 2027'),
      art('https://elpais.com/x', 'El Senado francés aprueba la primera parte del presupuesto', { lang: 'es' }),
      art('https://liberation.fr/autre', 'Un tout autre sujet sans aucun rapport avec le budget'),
    ];
    const a = dedupe(input, wl);
    const b = dedupe([...input].reverse(), wl);
    expect(b).toEqual(a);
    expect(a.map((x) => x.lang)).toEqual(['fr', 'fr', 'fr', 'en', 'es']);
    expect(a[0].groupId).toBe(a[1].groupId);
  });

  it('ignore une URL illisible sans lever', () => {
    expect(dedupe([art('https://lemonde.fr/ok', 'Titre valide pour le test'), { article: { ...art('https://x.fr', 'T').article, url: 'mailto:x@y.fr' } }], wl)).toHaveLength(1);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/collect/dedupe.test.ts`
Attendu : ÉCHEC, « Cannot find module '../../collect/dedupe' ».

- [ ] **Étape 3 : écrire `dedupe.ts`**

`pipeline/collect/dedupe.ts` :

```ts
import { LANGS, type RawArticle } from '@daily-brief/schema';
import { tryNormalizeUrl } from '../lib/url';
import { canReadFull, type Whitelist } from '../lib/whitelist';
import { articleId } from './article';
import type { Candidate } from './types';

/** Seuil de similarité des titres (Jaccard sur trigrammes de caractères). */
export const SIMILARITY_THRESHOLD = 0.6;
/** Titres trop courts (« Direct », « Live ») : jamais regroupés sur le seul titre. */
const MIN_TITLE_CHARS = 20;
/** Origine dont on garde les métadonnées en cas de doublon : l'éditeur (RSS) d'abord. */
const ORIGIN_RANK: Record<RawArticle['origin'], number> = { rss: 0, thenewsapi: 1, exa: 2, webz: 3, newsletter: 4 };

/** Comparaison binaire de chaînes, indépendante de la locale. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Titre sans accents, en minuscules, ponctuation remplacée par des espaces. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function trigrams(title: string): Set<string> {
  const t = ` ${normalizeTitle(title)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Fusion des doublons d'une même URL : métadonnées de la meilleure origine, date la plus ancienne. R1 revérifié. */
function merge(url: string, group: RawArticle[], wl: Whitelist): RawArticle {
  const [best] = group;
  const dates = group.map((a) => a.publishedAt).filter((d): d is string => d !== null).sort();
  const text = canReadFull(wl, url) ? (group.find((a) => a.text)?.text ?? null) : null;
  return {
    id: articleId(url),
    url,
    outlet: best.outlet,
    title: best.title,
    description: group.find((a) => a.description)?.description ?? null,
    lang: best.lang,
    publishedAt: dates[0] ?? null,
    origin: best.origin,
    text,
  };
}

/**
 * Dédoublonne les candidats : fusion par URL normalisée, puis regroupement (`groupId`) des
 * articles liés par `/similar` ou dont les titres se ressemblent (Jaccard ≥ 0,6). Déterministe :
 * la même entrée donne toujours la même sortie, triée par langue, taille de groupe, groupe, id.
 * **R1** : un texte n'est conservé que si l'URL est sur un domaine `full`.
 */
export function dedupe(candidates: Candidate[], wl: Whitelist): RawArticle[] {
  const byUrl = new Map<string, { article: RawArticle; index: number }[]>();
  candidates.forEach((c, index) => {
    const url = tryNormalizeUrl(c.article.url);
    if (!url) return;
    byUrl.set(url, [...(byUrl.get(url) ?? []), { article: c.article, index }]);
  });
  const articles = [...byUrl.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([url, group]) =>
      merge(
        url,
        group.sort((x, y) => ORIGIN_RANK[x.article.origin] - ORIGIN_RANK[y.article.origin] || x.index - y.index).map((g) => g.article),
        wl,
      ),
    );

  const ids = articles.map((a) => a.id);
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };

  for (const c of candidates) {
    const url = tryNormalizeUrl(c.article.url);
    if (c.seed && url) union(articleId(url), c.seed);
  }
  const grams = articles.map((a) => (normalizeTitle(a.title).length >= MIN_TITLE_CHARS ? trigrams(a.title) : null));
  for (let i = 0; i < articles.length; i++) {
    const gi = grams[i];
    if (!gi) continue;
    for (let j = i + 1; j < articles.length; j++) {
      const gj = grams[j];
      if (!gj || Math.min(gi.size, gj.size) / Math.max(gi.size, gj.size) < SIMILARITY_THRESHOLD) continue;
      if (jaccard(gi, gj) >= SIMILARITY_THRESHOLD) union(ids[i], ids[j]);
    }
  }

  const groupOf = (a: RawArticle) => 'g-' + find(a.id).slice(2);
  const sizes = new Map<string, number>();
  for (const a of articles) sizes.set(groupOf(a), (sizes.get(groupOf(a)) ?? 0) + 1);
  const langRank = (l: string) => {
    const i = (LANGS as readonly string[]).indexOf(l);
    return i === -1 ? LANGS.length : i;
  };
  return articles
    .map((a) => ({ ...a, groupId: groupOf(a) }))
    .sort((a, b) => langRank(a.lang) - langRank(b.lang) || sizes.get(b.groupId)! - sizes.get(a.groupId)! || cmp(a.groupId, b.groupId) || cmp(a.id, b.id));
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/collect/dedupe.test.ts && npm run typecheck`
Attendu : `Tests  6 passed (6)`, typage propre.

Commande : `npm test`
Attendu : `Test Files  42 passed (42)`, `Tests  320 passed (320)`.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/collect/dedupe.ts pipeline/test/collect/dedupe.test.ts
git commit -m "feat(collect): dédoublonnage par URL et regroupement des titres (Jaccard ≥ 0,6)"
```

---

### Tâche 9 : `npm run brief:collect`

**Fichiers :**
- Créer : `pipeline/collect/run-collect.ts`, `pipeline/collect/cli.ts`, `pipeline/test/run-cli.ts`
- Modifier : `package.json` (script `brief:collect`)
- Test : `pipeline/test/collect/run-collect.test.ts`, `pipeline/test/collect/cli.test.ts`

Comportement attendu :
- **Ordre des sources, chacune indépendante.** Une exception inattendue dans une source est consignée sans arrêter les autres.
  1. La découverte principale : TheNewsAPI si `primary` vaut `thenewsapi`, avec le budget du jour moins le compte de `out/thenewsapi-usage.json`.
  2. Exa : domaines `full` avec texte, plus la recherche ouverte si Exa est principal.
  3. RSS.
  4. Webz, pour les langues où la découverte principale a donné moins de `webz.fallbackBelow` candidats.
- **Clés.** `THENEWSAPI_KEY`, `EXA_API_KEY` et `WEBZ_TOKEN` viennent de l'environnement ou de `.env`. Sans clé, la source est ignorée avec un avertissement, et l'API n'est pas appelée.
- **Assemblage.** Dédoublonnage, textes intégraux (domaines `full` seulement), puis une dernière garde R1 sur chaque article.
- **Sorties.**
  - **Nettoyage.** `raw.json` et `collect-report.json` sont d'abord supprimés.
  - **`raw.json`.** Validé par `RawCollectionSchema` ; ses `errors` sont les messages des sources.
  - **`collect-report.json`.** Toujours écrit. Il donne les compteurs par source, le budget (TheNewsAPI : plafond, déjà utilisé, ce passage, par poste ; Exa et Webz : requêtes et maximum) et les statistiques des textes intégraux. Il compte les textes écartés par R1. Par langue, il donne le nombre d'articles et de textes lus, avec `light: true` sous `lightThreshold` (15).
- **Secrets.** Aucun secret n'apparaît, ni dans les messages, ni dans `raw.json`, ni dans le rapport.
- **Codes de sortie.** 0 si au moins un article ; 2 sinon, et `raw.json` n'est pas écrit. Une date invalide ne crée aucun dossier.
- **CLI.** Il charge `.env` s'il existe et n'ignore que l'absence du fichier (`ENOENT`). Il affiche les problèmes, puis une ligne par langue.

- [ ] **Étape 1 : écrire l'aide de CLI et les tests**

`run-cli.ts` lance un script avec tsx depuis un dossier temporaire vide (aucun `.env` n'y est lu) et sans variable secrète : un test de CLI n'atteint jamais une vraie API.

`pipeline/test/run-cli.ts` :

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoPath } from './helpers';

/** Variables jamais transmises aux CLI testés : aucun test ne doit atteindre une vraie API. */
const SECRET_VARS = ['THENEWSAPI_KEY', 'EXA_API_KEY', 'WEBZ_TOKEN', 'PEXELS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

/**
 * Lance un script TypeScript du dépôt avec tsx, depuis un dossier vide (aucun `.env` n'y est lu)
 * et sans les variables secrètes ; `env` en ajoute d'autres.
 */
export function runCli(script: string, args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string; cwd: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'cli-'));
  const base = { ...process.env };
  for (const k of SECRET_VARS) delete base[k];
  const r = spawnSync(process.execPath, ['--import', repoPath('node_modules/tsx/dist/loader.mjs'), repoPath(script), ...args], {
    cwd,
    env: { ...base, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, cwd };
}
```

`pipeline/test/collect/run-collect.test.ts` :

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RawCollectionSchema } from '@daily-brief/schema';
import { EXA_SEARCH } from '../../collect/exa';
import type { HttpFetch } from '../../collect/http';
import { runCollect, type CollectKeys } from '../../collect/run-collect';
import { THENEWSAPI_BASE } from '../../collect/thenewsapi';
import { WEBZ_LITE } from '../../collect/webz';
import { canReadFull, loadWhitelist } from '../../lib/whitelist';
import { repoPath, WHITELIST_PATH } from '../helpers';
import { apiFixture, CONFIG_PATH, FEEDS_PATH, NOW, RUBRIQUES_PATH } from './source-context';
import { fakeHttp, type Reply } from './fake-http';

const DAY = '2026-11-06';
const KEYS: CollectKeys = { thenewsapi: 'tna-SECRET-123', exa: 'exa-SECRET-456', webz: 'WEBZ-SECRET-789' };
const PAGE = readFileSync(repoPath('fixtures/api/article-euronews.html'), 'utf8');
const RSS = readFileSync(repoPath('fixtures/api/rss-euronews-fr.xml'), 'utf8');
const wl = loadWhitelist(WHITELIST_PATH);

/** Réseau simulé : une réponse par source, les pages des domaines full, 404 ailleurs. */
function network(overrides: Record<string, Reply | ((url: string) => Reply)> = {}) {
  return fakeHttp({
    [`${THENEWSAPI_BASE}/top`]: (url) =>
      url.includes('language=fr') && url.includes('categories=politics&') && !url.includes('page=') ? { json: apiFixture('thenewsapi-top.json') } : { json: { data: [] } },
    [`${THENEWSAPI_BASE}/similar/`]: { json: apiFixture('thenewsapi-similar.json') },
    [EXA_SEARCH]: { json: apiFixture('exa-search.json') },
    [WEBZ_LITE]: { json: apiFixture('webz-news-lite.json') },
    'https://fr.euronews.com/rss': { body: RSS, type: 'application/rss+xml' },
    'https://fr.euronews.com/20': { body: PAGE },
    'https://sudradio.fr/': { body: PAGE },
    'https://eldiario.es/': { body: PAGE },
    ...overrides,
  });
}

function setup(configPatch?: (c: any) => void) {
  const outDir = mkdtempSync(join(tmpdir(), 'collect-'));
  let configPath = CONFIG_PATH;
  if (configPatch) {
    const c = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    configPatch(c);
    configPath = join(outDir, 'collect.json');
    writeFileSync(configPath, JSON.stringify(c));
  }
  const run = (fetch: HttpFetch, keys: CollectKeys = KEYS, date = DAY) =>
    runCollect({ outDir, date, keys, fetch, now: NOW, configPath, rubriquesPath: RUBRIQUES_PATH, feedsPath: FEEDS_PATH, whitelistPath: WHITELIST_PATH });
  return { outDir, dayDir: join(outDir, DAY), run };
}

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const noSecret = (text: string) => {
  for (const k of Object.values(KEYS)) expect(text).not.toContain(k);
};

describe('runCollect', () => {
  it('collecte toutes les sources, écrit raw.json et le rapport, texte seulement pour les domaines full', async () => {
    const { dayDir, run } = setup();
    const net = network();
    const r = await run(net.fetch);
    expect(r.exitCode).toBe(0);
    const raw = RawCollectionSchema.parse(read(join(dayDir, 'raw.json')));
    expect(raw).toMatchObject({ date: DAY, collectedAt: '2026-11-06T04:13:00.000Z' });
    expect(raw.articles.length).toBe(r.report.articles);
    for (const a of raw.articles) if (a.text !== null) expect(canReadFull(wl, a.url), a.url).toBe(true);
    expect(raw.articles.find((a) => a.url.includes('lemonde.fr/planete'))!.text).toBeNull();
    expect(raw.articles.find((a) => a.url.includes('elpais.com'))!.text).toBeNull();
    const report = read(join(dayDir, 'collect-report.json'));
    expect(report).toMatchObject({
      date: DAY,
      exitCode: 0,
      primary: 'thenewsapi',
      sources: { thenewsapi: { used: true, requests: 29 }, exa: { used: true, requests: 27 }, rss: { used: true, requests: 13 }, webz: { used: true, requests: 3 } },
      budget: { thenewsapi: { dailyCap: 90, usedBefore: 0, usedThisRun: 29, perBucket: { fr: 9, en: 9, es: 9, similar: 2 } }, exa: { requests: 27, max: 60 }, webz: { requests: 3, max: 3 } },
    });
    expect(report.perLang.fr.light).toBe(true);
    expect(report.perLang.fr.fullTexts).toBe(raw.articles.filter((a) => a.lang === 'fr' && a.text).length);
    expect(report.discardedTexts).toBeGreaterThanOrEqual(2);
    noSecret(readFileSync(join(dayDir, 'raw.json'), 'utf8') + readFileSync(join(dayDir, 'collect-report.json'), 'utf8'));
  });

  it('sans clé : chaque source à clé est ignorée avec un avertissement, aucun appel aux API, le RSS suffit', async () => {
    const { dayDir, run } = setup();
    const net = network();
    const r = await run(net.fetch, {});
    expect(r.exitCode).toBe(0);
    expect(net.calls.some((c) => /api\.(thenewsapi|exa|webz)/.test(c.url))).toBe(false);
    expect(r.report.issues.filter((i) => i.level === 'warning' && /absente/.test(i.message)).map((i) => i.source)).toEqual(['thenewsapi', 'exa', 'webz']);
    expect(read(join(dayDir, 'raw.json')).articles.every((a: { origin: string }) => a.origin === 'rss')).toBe(true);
  });

  it('rien de collecté : code 2, ancien raw.json supprimé, rapport réécrit', async () => {
    const { dayDir, run } = setup();
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, 'raw.json'), '{"périmé":true}');
    writeFileSync(join(dayDir, 'collect-report.json'), '{"exitCode":0}');
    const r = await run(fakeHttp({}).fetch, {});
    expect(r.exitCode).toBe(2);
    expect(existsSync(join(dayDir, 'raw.json'))).toBe(false);
    expect(read(join(dayDir, 'collect-report.json'))).toMatchObject({ exitCode: 2, articles: 0 });
  });

  it('une source en panne réseau n’arrête pas les autres et aucun secret ne fuit dans les messages', async () => {
    const { dayDir, run } = setup();
    const leak = (url: string): Reply => ({ error: new Error(`connect ECONNREFUSED ${url}`) });
    const net = network({ [`${THENEWSAPI_BASE}/top`]: leak, [WEBZ_LITE]: leak, [EXA_SEARCH]: { error: new Error(`refus pour la clé ${KEYS.exa}`) } });
    const r = await run(net.fetch);
    expect(r.exitCode).toBe(0);
    expect(r.report.sources.thenewsapi.errors).toHaveLength(27);
    expect(r.report.sources.webz.errors).toHaveLength(3);
    expect(r.report.sources.exa.errors).toHaveLength(27);
    expect(r.report.sources.rss.candidates).toBeGreaterThan(0);
    noSecret(readFileSync(join(dayDir, 'raw.json'), 'utf8') + readFileSync(join(dayDir, 'collect-report.json'), 'utf8'));
    expect(JSON.stringify(r.report)).toContain('api_token=***');
  });

  it('Exa en découverte principale : TheNewsAPI n’est pas appelée, Exa cherche aussi sans restriction de domaine', async () => {
    const { run } = setup((c) => (c.primary = 'exa'));
    const net = network();
    const r = await run(net.fetch);
    expect(r.report.primary).toBe('exa');
    expect(net.calls.some((c) => c.url.startsWith(THENEWSAPI_BASE))).toBe(false);
    const bodies = net.calls.filter((c) => c.url === EXA_SEARCH).map((c) => JSON.parse(c.body!));
    expect(bodies).toHaveLength(54);
    expect(bodies.filter((b) => b.includeDomains === undefined).every((b) => b.contents === undefined)).toBe(true);
  });

  it('le plafond de 90 requêtes TheNewsAPI vaut pour la journée : une relance reprend le compte', async () => {
    const { outDir, run } = setup();
    await run(network().fetch);
    expect(read(join(outDir, 'thenewsapi-usage.json'))).toEqual({ day: '2026-11-06', used: 29 });
    writeFileSync(join(outDir, 'thenewsapi-usage.json'), JSON.stringify({ day: '2026-11-06', used: 90 }));
    const net = network();
    const r = await run(net.fetch);
    expect(net.calls.some((c) => c.url.startsWith(THENEWSAPI_BASE))).toBe(false);
    expect(r.report.budget.thenewsapi).toMatchObject({ usedBefore: 90, usedThisRun: 0 });
  });

  it('refuse une date invalide sans rien écrire, et une configuration invalide avec un rapport', async () => {
    const { outDir, run } = setup();
    const bad = await run(fakeHttp({}).fetch, KEYS, '../2026-13-45');
    expect(bad.exitCode).toBe(2);
    expect(existsSync(join(outDir, '2026-13-45'))).toBe(false);
    const broken = setup((c) => (c.thenewsapi.budget.total = 120));
    const r = await broken.run(fakeHttp({}).fetch);
    expect(r.exitCode).toBe(2);
    expect(read(join(broken.dayDir, 'collect-report.json')).issues[0].message).toMatch(/^configuration illisible/);
  });
});
```

`pipeline/test/collect/cli.test.ts` :

```ts
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../run-cli';

describe('CLI brief:collect', () => {
  it('sort avec le code 2 sur une option inconnue', () => {
    const r = runCli('pipeline/collect/cli.ts', ['--dat', '2026-11-06']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('brief:collect :');
  }, 30_000);

  it('sort avec le code 2 sur une date invalide, sans rien écrire', () => {
    const out = mkdtempSync(join(tmpdir(), 'collect-cli-'));
    const r = runCli('pipeline/collect/cli.ts', ['--date', '2026-02-30', '--out', out]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] date incorrecte : « 2026-02-30 »');
    expect(existsSync(join(out, '2026-02-30'))).toBe(false);
  }, 30_000);
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/collect/run-collect.test.ts pipeline/test/collect/cli.test.ts`
Attendu : ÉCHEC. `run-collect.test.ts` donne « Cannot find module '../../collect/run-collect' » ; les 2 tests de `cli.test.ts` donnent « expected 1 to be 2 » (le script n'existe pas encore).

- [ ] **Étape 3 : écrire l'orchestrateur et le CLI**

`pipeline/collect/run-collect.ts` :

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IsoDateSchema, LANGS, RawCollectionSchema, type Lang, type RawArticle } from '@daily-brief/schema';
import { canReadFull, loadWhitelist } from '../lib/whitelist';
import { RequestBudget } from './budget';
import { loadCollectConfig, THENEWSAPI_DAILY_CAP, type BudgetBucket, type CollectConfig } from './config';
import { dedupe } from './dedupe';
import { collectExa } from './exa';
import { fillFullTexts, type FullTextStats } from './fulltext';
import { messageOf, type HttpFetch } from './http';
import { redactText, stripSecrets } from './redact';
import { collectRss, loadFeeds } from './rss';
import { loadRubriques } from './rubriques';
import { collectTheNewsApi } from './thenewsapi';
import type { SourceContext, SourceName, SourceRun } from './types';
import { readDailyUsage, utcDay, writeDailyUsage } from './usage-ledger';
import { collectWebz } from './webz';

export type CollectKeys = { thenewsapi?: string; exa?: string; webz?: string };

export type RunCollectOptions = {
  outDir: string;
  date: string;
  keys: CollectKeys;
  fetch: HttpFetch;
  configPath: string;
  rubriquesPath: string;
  feedsPath: string;
  whitelistPath: string;
  /** Heure de la collecte (maintenant par défaut) : la fenêtre est `[now - windowHours, now]`. */
  now?: Date;
};

export type CollectIssue = { level: 'error' | 'warning'; source?: SourceName; message: string };

export type SourceReport = { used: boolean; requests: number; candidates: number; stoppedBy: string | null; errors: string[] };

export type CollectReport = {
  date: string;
  generatedAt: string;
  exitCode: 0 | 2;
  primary: CollectConfig['primary'] | null;
  articles: number;
  groups: number;
  perLang: Record<Lang, { articles: number; fullTexts: number; light: boolean }>;
  sources: Record<SourceName, SourceReport>;
  budget: {
    thenewsapi: { dailyCap: number; usedBefore: number; usedThisRun: number; perBucket: Record<BudgetBucket, number> | null };
    exa: { requests: number; max: number | null };
    webz: { requests: number; max: number | null };
  };
  fulltext: Omit<FullTextStats, 'errors'> | null;
  /** Textes renvoyés par une API pour un domaine qui n'est pas `full`, écartés (R1). */
  discardedTexts: number;
  issues: CollectIssue[];
};

export type RunCollectResult = { exitCode: 0 | 2; report: CollectReport };

const SOURCES: SourceName[] = ['thenewsapi', 'exa', 'rss', 'webz'];
const KEY_NAMES: Record<keyof CollectKeys, string> = { thenewsapi: 'THENEWSAPI_KEY', exa: 'EXA_API_KEY', webz: 'WEBZ_TOKEN' };

function emptyReport(date: string, now: Date): CollectReport {
  return {
    date,
    generatedAt: now.toISOString(),
    exitCode: 2,
    primary: null,
    articles: 0,
    groups: 0,
    perLang: Object.fromEntries(LANGS.map((l) => [l, { articles: 0, fullTexts: 0, light: true }])) as CollectReport['perLang'],
    sources: Object.fromEntries(SOURCES.map((s) => [s, { used: false, requests: 0, candidates: 0, stoppedBy: null, errors: [] }])) as unknown as CollectReport['sources'],
    budget: {
      thenewsapi: { dailyCap: THENEWSAPI_DAILY_CAP, usedBefore: 0, usedThisRun: 0, perBucket: null },
      exa: { requests: 0, max: null },
      webz: { requests: 0, max: null },
    },
    fulltext: null,
    discardedTexts: 0,
    issues: [],
  };
}

/**
 * `brief:collect` : interroge chaque source indépendamment (une source en échec n'arrête pas les
 * autres), dédoublonne, complète les textes des domaines `full`, puis écrit `out/<date>/raw.json`
 * et `collect-report.json`. Les anciens fichiers sont supprimés d'abord ; le rapport est toujours
 * écrit, sans aucun secret. Code 0 si au moins un article, 2 sinon.
 */
export async function runCollect(opts: RunCollectOptions): Promise<RunCollectResult> {
  const now = opts.now ?? new Date();
  const report = emptyReport(opts.date, now);
  const secrets = [opts.keys.thenewsapi, opts.keys.exa, opts.keys.webz];
  const clean = (m: string) => redactText(m, secrets);
  const issue = (level: CollectIssue['level'], message: string, source?: SourceName) =>
    report.issues.push({ level, ...(source ? { source } : {}), message: clean(message) });

  if (!IsoDateSchema.safeParse(opts.date).success) {
    issue('error', `date incorrecte : « ${opts.date} »`);
    return { exitCode: 2, report };
  }
  const dayDir = join(opts.outDir, opts.date);
  const rawPath = join(dayDir, 'raw.json');
  const reportPath = join(dayDir, 'collect-report.json');
  mkdirSync(dayDir, { recursive: true });
  rmSync(rawPath, { force: true });
  rmSync(reportPath, { force: true });

  let lightThreshold = 15;
  const finish = (articles: RawArticle[] | null): RunCollectResult => {
    const list = articles ?? [];
    report.articles = list.length;
    report.groups = new Set(list.map((a) => a.groupId)).size;
    for (const lang of LANGS) {
      const mine = list.filter((a) => a.lang === lang);
      const fullTexts = mine.filter((a) => a.text !== null).length;
      report.perLang[lang] = { articles: mine.length, fullTexts, light: fullTexts < lightThreshold };
    }
    report.exitCode = list.length > 0 ? 0 : 2;
    if (report.exitCode === 2) rmSync(rawPath, { force: true });
    writeFileSync(reportPath, clean(JSON.stringify(report, null, 2)) + '\n');
    return { exitCode: report.exitCode, report };
  };

  try {
    let config: CollectConfig;
    let ctx: SourceContext;
    let feeds: ReturnType<typeof loadFeeds>;
    try {
      config = loadCollectConfig(opts.configPath);
      const whitelist = loadWhitelist(opts.whitelistPath);
      ctx = {
        fetch: opts.fetch,
        whitelist,
        config,
        rubriques: loadRubriques(opts.rubriquesPath),
        now,
        windowStart: new Date(now.getTime() - config.windowHours * 3_600_000),
      };
      feeds = loadFeeds(opts.feedsPath);
    } catch (e) {
      issue('error', `configuration illisible : ${messageOf(e)}`);
      return finish(null);
    }
    report.primary = config.primary;
    lightThreshold = config.lightThreshold;
    report.budget.exa.max = config.exa.maxRequests;
    report.budget.webz.max = config.webz.maxRequests;

    const runs: Partial<Record<SourceName, SourceRun>> = {};
    const record = (name: SourceName, run: SourceRun) => {
      runs[name] = run;
      report.sources[name] = { used: true, requests: run.requests, candidates: run.candidates.length, stoppedBy: run.stoppedBy, errors: run.errors.map(clean) };
      report.discardedTexts += run.discardedTexts;
      for (const m of run.errors) issue('warning', m, name);
    };
    /** Lance une source ; une exception inattendue est consignée sans arrêter les autres. */
    const guarded = async (name: SourceName, fn: () => Promise<SourceRun>) => {
      try {
        record(name, await fn());
      } catch (e) {
        report.sources[name].used = true;
        issue('error', `${name} : erreur inattendue : ${messageOf(e)}`, name);
      }
    };
    const missing = (k: keyof CollectKeys, what: string) => issue('warning', `${KEY_NAMES[k]} absente : ${what}`, k);

    // 1. Découverte principale (§16 : TheNewsAPI, ou Exa en recherche ouverte).
    if (config.primary === 'thenewsapi') {
      const token = opts.keys.thenewsapi;
      if (token) {
        const ledgerPath = join(opts.outDir, 'thenewsapi-usage.json');
        const day = utcDay(now);
        const before = readDailyUsage(ledgerPath, day, THENEWSAPI_DAILY_CAP);
        if (before.error) issue('error', before.error, 'thenewsapi');
        const { total, ...limits } = config.thenewsapi.budget;
        const budget = new RequestBudget<BudgetBucket>(limits, Math.max(0, Math.min(total, THENEWSAPI_DAILY_CAP - before.used)));
        report.budget.thenewsapi.usedBefore = before.used;
        try {
          await guarded('thenewsapi', () => collectTheNewsApi(ctx, token, budget));
        } finally {
          report.budget.thenewsapi.usedThisRun = budget.spentTotal;
          report.budget.thenewsapi.perBucket = budget.usage();
          if (!before.error) writeDailyUsage(ledgerPath, day, before.used + budget.spentTotal);
        }
      } else missing('thenewsapi', 'TheNewsAPI ignorée');
    }

    // 2. Exa : domaines full avec texte ; recherche ouverte en plus si Exa est la découverte principale.
    if (opts.keys.exa) {
      const key = opts.keys.exa;
      await guarded('exa', () => collectExa(ctx, key, { broad: config.primary === 'exa' }));
      report.budget.exa.requests = runs.exa?.requests ?? 0;
    } else missing('exa', config.primary === 'exa' ? 'découverte principale (Exa) indisponible' : 'Exa ignorée');

    // 3. Flux RSS des domaines full et feed.
    await guarded('rss', () => collectRss(ctx, feeds));

    // 4. Webz en secours, pour les langues où la découverte principale est sous le seuil.
    const primaryRun = runs[config.primary];
    const below = LANGS.filter((l) => (primaryRun?.candidates.filter((c) => c.article.lang === l).length ?? 0) < config.webz.fallbackBelow);
    if (below.length > 0) {
      if (opts.keys.webz) {
        const token = opts.keys.webz;
        await guarded('webz', () => collectWebz(ctx, token, below));
        report.budget.webz.requests = runs.webz?.requests ?? 0;
      } else missing('webz', `secours indisponible pour ${below.join(', ')}`);
    }

    // 5. Dédoublonnage, textes intégraux (domaines full seulement), dernière garde R1.
    const candidates = SOURCES.flatMap((s) => runs[s]?.candidates ?? []);
    let articles = dedupe(candidates, ctx.whitelist);
    const ft = config.fulltext;
    const filled = await fillFullTexts(articles, { whitelist: ctx.whitelist, fetch: opts.fetch, ...ft });
    articles = filled.articles;
    const { errors: ftErrors, ...ftStats } = filled.stats;
    report.fulltext = ftStats;
    if (ftErrors.length > 0) issue('warning', `textes intégraux non lus : ${ftErrors.join(' ; ')}`);
    articles = articles.map((a) => {
      if (a.text === null || canReadFull(ctx.whitelist, a.url)) return a;
      report.discardedTexts++;
      return { ...a, text: null };
    });

    if (articles.length === 0) {
      issue('error', 'aucun article collecté : raw.json non écrit');
      return finish(null);
    }
    const collection = RawCollectionSchema.parse({
      date: opts.date,
      collectedAt: now.toISOString(),
      articles,
      errors: report.issues.filter((i) => i.source).map((i) => ({ source: i.source!, message: i.message })),
    });
    writeFileSync(rawPath, stripSecrets(JSON.stringify(collection, null, 2), secrets) + '\n');
    return finish(collection.articles);
  } catch (e) {
    // Quoi qu'il arrive, le rapport est écrit et aucun raw.json partiel ne reste.
    issue('error', `erreur inattendue : ${messageOf(e)}`);
    return finish(null);
  }
}
```

`pipeline/collect/cli.ts` :

```ts
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LANGS } from '@daily-brief/schema';
import { parisToday } from '../lib/date';
import type { HttpFetch } from './http';
import { runCollect } from './run-collect';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const key = (name: string) => process.env[name]?.trim() || undefined;

try {
  try {
    process.loadEnvFile('.env');
  } catch (e) {
    // Pas de .env : variables d'environnement du processus seulement. Toute autre erreur est remontée.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const { exitCode, report } = await runCollect({
    outDir: values.out!,
    date,
    keys: { thenewsapi: key('THENEWSAPI_KEY'), exa: key('EXA_API_KEY'), webz: key('WEBZ_TOKEN') },
    fetch: fetch as HttpFetch,
    configPath: path('../config/collect.json'),
    rubriquesPath: path('../editorial/rubriques.json'),
    feedsPath: path('../config/feeds.json'),
    whitelistPath: path('../config/whitelist.json'),
  });
  console.log(`brief:collect ${date}`);
  for (const i of report.issues) console.log(`[${i.level}]${i.source ? ' ' + i.source : ''} ${i.message}`);
  for (const lang of LANGS) {
    const l = report.perLang[lang];
    console.log(`${lang.toUpperCase()} : ${l.articles} articles, ${l.fullTexts} textes lus${l.light ? ' (édition allégée)' : ''}`);
  }
  console.log(exitCode === 0 ? `raw.json : ${report.articles} articles, ${report.groups} groupes` : 'Erreur : aucun article collecté.');
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:collect : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
```

Dans `package.json` (racine), ajouter dans `"scripts"`, juste avant `"brief:verify"` :

```json
    "brief:collect": "tsx pipeline/collect/cli.ts",
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/collect/run-collect.test.ts pipeline/test/collect/cli.test.ts && npm run typecheck`
Attendu : `Tests  9 passed (9)` (7 + 2), typage propre. Chaque test de CLI prend environ 0,6 s.

Commande : `npm test`
Attendu : `Test Files  44 passed (44)`, `Tests  329 passed (329)`.

- [ ] **Étape 5 : essai sans réseau**

Commande : `npm run -s brief:collect -- --date 2026-02-30 --out /tmp/collect-essai; echo "collect=$?"`
Attendu :

```text
brief:collect 2026-02-30
[error] date incorrecte : « 2026-02-30 »
FR : 0 articles, 0 textes lus (édition allégée)
EN : 0 articles, 0 textes lus (édition allégée)
ES : 0 articles, 0 textes lus (édition allégée)
Erreur : aucun article collecté.
collect=2
```

- [ ] **Étape 6 (facultative, réseau requis) : essai réel sans clé**

À faire seulement si le conteneur a accès à Internet. Sans clé, seuls les flux RSS et les pages des domaines `full` sont lus.

Commande : `env -u THENEWSAPI_KEY -u EXA_API_KEY -u WEBZ_TOKEN npm run -s brief:collect -- --out /tmp/collect-essai; echo "collect=$?"`
Attendu, en une vingtaine de secondes :
- trois avertissements `… absente` (thenewsapi, exa, webz) ;
- éventuellement `rss … democrata.es/feed/ : HTTP 403` et quelques « texte trop court » (pages vidéo) ;
- puis trois lignes `FR/EN/ES : N articles, M textes lus` et `collect=0`.

Le 11/11/2026, la collecte a donné FR 50 articles et 48 textes, EN 144 et 62, ES 91 et 65. Supprimer ensuite le dossier : `rm -rf /tmp/collect-essai`.

- [ ] **Étape 7 : commit**

```bash
git add pipeline/collect/run-collect.ts pipeline/collect/cli.ts pipeline/test/run-cli.ts pipeline/test/collect package.json
git commit -m "feat(collect): commande brief:collect (raw.json, rapport, édition allégée)"
```

---

### Tâche 10 : vérification §16, TheNewsAPI en temps réel

**Fichiers :**
- Créer : `pipeline/collect/realtime.ts`, `pipeline/collect/check-thenewsapi.ts`
- Modifier : `package.json` (script `check:thenewsapi`)
- Test : `pipeline/test/collect/realtime.test.ts`

Comportement attendu :
- **Appels.** `checkRealtime` appelle `/v1/news/top?api_token=…&language=<l>&limit=3` une fois par langue, sans `published_after`, avec le tri par défaut de l'API (date de publication). Il calcule l'âge de l'article le plus récent en minutes ; un article daté dans le futur compte pour 0.
- **Verdict.**
  - `exa` : une langue a un article le plus récent de plus de 120 min, ou aucun article daté.
  - `thenewsapi` : les trois langues sont vérifiées et fraîches.
  - `unknown` : sinon (clé refusée, réseau).
- **Pannes.** Un 401, 402, 403, 429 ou un délai dépassé arrête les appels suivants : les langues restantes sont « non vérifiées ». Aucun secret n'apparaît, même dans une erreur réseau qui citerait l'URL.
- **Affichage.** `describeRealtime` donne les lignes affichées et la consigne pour `pipeline/config/collect.json`. La commande ne modifie jamais la configuration elle-même.
- **CLI.** Il lit `THENEWSAPI_KEY` (environnement ou `.env`) et donne le code 0 (temps réel), 1 (passer à Exa) ou 2 (impossible, ou clé absente, sans aucun appel). Il consomme 3 requêtes, prises sur la marge de 10 hors du budget de 90.

- [ ] **Étape 1 : écrire le test qui échoue**

`pipeline/test/collect/realtime.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { checkRealtime, describeRealtime } from '../../collect/realtime';
import { THENEWSAPI_BASE } from '../../collect/thenewsapi';
import { runCli } from '../run-cli';
import { fakeHttp, type Reply } from './fake-http';

const TOKEN = 'tna-SECRET-123';
const NOW = new Date('2026-11-06T10:00:00Z');

/** Réponse /top dont l'article le plus récent a `ages[lang]` minutes (null : aucun article). */
function top(ages: Record<string, number | null>) {
  return (url: string): Reply => {
    const lang = new URL(url).searchParams.get('language')!;
    const age = ages[lang];
    if (age === null) return { json: { meta: { found: 0, returned: 0, limit: 3, page: 1 }, data: [] } };
    const at = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString().replace('Z', '000Z');
    return {
      json: {
        meta: { found: 50, returned: 2, limit: 3, page: 1 },
        data: [
          { uuid: `${lang}-1`, title: 'Ancien', url: `https://ex.com/${lang}/1`, language: lang, published_at: at(age + 300), source: 'ex.com' },
          { uuid: `${lang}-2`, title: 'Récent', url: `https://ex.com/${lang}/2`, language: lang, published_at: at(age), source: 'ex.com' },
        ],
      },
    };
  };
}

describe('vérification §16 : TheNewsAPI en temps réel', () => {
  it('un appel /top par langue, sans published_after ; trois langues fraîches : TheNewsAPI reste principale', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: top({ fr: 12, en: 3, es: 120 }) });
    const r = await checkRealtime({ token: TOKEN, fetch, now: NOW });
    expect(calls.map((c) => Object.fromEntries(new URL(c.url).searchParams))).toEqual(
      ['fr', 'en', 'es'].map((language) => ({ api_token: TOKEN, language, limit: '3' })),
    );
    expect(r.perLang.fr).toEqual({ newest: '2026-11-06T09:48:00.000Z', ageMinutes: 12, articles: 2, error: null });
    expect(r.perLang.es.ageMinutes).toBe(120);
    expect(r).toMatchObject({ verdict: 'thenewsapi', requests: 3, maxAgeMinutes: 120, checkedAt: '2026-11-06T10:00:00.000Z' });
    expect(describeRealtime(r, 'thenewsapi')).toEqual([
      'FR : article le plus récent publié il y a 12 min (2026-11-06T09:48:00.000Z)',
      'EN : article le plus récent publié il y a 3 min (2026-11-06T09:57:00.000Z)',
      'ES : article le plus récent publié il y a 120 min (2026-11-06T08:00:00.000Z)',
      'Verdict : TheNewsAPI est en temps réel (au plus 120 min dans les trois langues).',
      'Requêtes TheNewsAPI utilisées : 3 (hors budget quotidien de 90 de brief:collect).',
    ]);
  });

  it('plus de 2 h ou aucun article dans une langue : Exa doit devenir principale', async () => {
    const late = await checkRealtime({ token: TOKEN, fetch: fakeHttp({ [`${THENEWSAPI_BASE}/top`]: top({ fr: 5, en: 121, es: 5 }) }).fetch, now: NOW });
    expect(late.verdict).toBe('exa');
    const lines = describeRealtime(late, 'thenewsapi');
    expect(lines).toContain('À faire : passer "primary": "exa" dans pipeline/config/collect.json.');
    const empty = await checkRealtime({ token: TOKEN, fetch: fakeHttp({ [`${THENEWSAPI_BASE}/top`]: top({ fr: 5, en: 5, es: null }) }).fetch, now: NOW });
    expect(empty.verdict).toBe('exa');
    expect(describeRealtime(empty, 'exa')[2]).toBe('ES : aucun article daté (0 renvoyés)');
    expect(describeRealtime(empty, 'exa')).not.toContain('À faire : passer "primary": "exa" dans pipeline/config/collect.json.');
  });

  it('clé refusée : arrêt au premier appel, verdict inconnu, aucun secret', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: { status: 401, json: { error: { code: 'invalid_api_token' } } } });
    const r = await checkRealtime({ token: TOKEN, fetch, now: NOW });
    expect(calls).toHaveLength(1);
    expect(r.verdict).toBe('unknown');
    expect(r.perLang.fr.error).toBe('HTTP 401 (https://api.thenewsapi.com/v1/news/top?api_token=***&language=fr&limit=3)');
    expect(r.perLang.es.error).toBe('non vérifié (HTTP 401)');
    expect(JSON.stringify(r) + describeRealtime(r, 'thenewsapi').join('\n')).not.toContain(TOKEN);
    expect(describeRealtime(r, 'thenewsapi')).toContain('Verdict : vérification impossible, configuration inchangée. Relance plus tard.');
  });

  it('ne reste pas bloquée : délai dépassé, puis arrêt', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: { hang: true } });
    const r = await checkRealtime({ token: TOKEN, fetch, now: NOW, timeoutMs: 20 });
    expect(calls).toHaveLength(1);
    expect(r.verdict).toBe('unknown');
    expect(r.perLang.en.error).toBe('non vérifié (délai dépassé)');
  });

  it('une erreur réseau qui cite le jeton est masquée ; une langue en retard l’emporte sur une erreur', async () => {
    let n = 0;
    const route = (url: string): Reply => (++n === 1 ? { error: new Error(`ECONNRESET ${url}`) } : top({ en: 500, es: 1 })(url));
    const r = await checkRealtime({ token: TOKEN, fetch: fakeHttp({ [`${THENEWSAPI_BASE}/top`]: route }).fetch, now: NOW });
    expect(r.perLang.fr.error).not.toContain(TOKEN);
    expect(r.perLang.fr.error).toContain('api_token=***');
    expect(r.requests).toBe(3);
    expect(r.verdict).toBe('exa');
  });
});

describe('CLI check:thenewsapi', () => {
  it('sans clé : code 2, aucun appel réseau', () => {
    const r = runCli('pipeline/collect/check-thenewsapi.ts', []);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('check:thenewsapi (découverte principale actuelle : thenewsapi)\nTHENEWSAPI_KEY absente (environnement ou .env) : vérification impossible.\n');
  }, 30_000);
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/collect/realtime.test.ts`
Attendu : ÉCHEC, « Cannot find module '../../collect/realtime' ».

- [ ] **Étape 3 : écrire la vérification et son CLI**

`pipeline/collect/realtime.ts` :

```ts
import { LANGS, type Lang } from '@daily-brief/schema';
import { toIso } from './article';
import { Breaker } from './breaker';
import { messageOf, type HttpFetch } from './http';
import { stripSecrets } from './redact';
import { topNews } from './thenewsapi';

/** Âge maximal de l'article le plus récent pour juger TheNewsAPI « en temps réel » (spec §16). */
export const REALTIME_MAX_AGE_MINUTES = 120;

export type LangFreshness = {
  /** Date de publication la plus récente parmi les articles renvoyés, ou null. */
  newest: string | null;
  /** Âge de cet article en minutes (0 s'il est daté dans le futur), ou null. */
  ageMinutes: number | null;
  articles: number;
  error: string | null;
};

export type RealtimeVerdict = 'thenewsapi' | 'exa' | 'unknown';

export type RealtimeReport = {
  checkedAt: string;
  maxAgeMinutes: number;
  perLang: Record<Lang, LangFreshness>;
  requests: number;
  /** thenewsapi : temps réel ; exa : Exa doit devenir la découverte principale ; unknown : vérification impossible. */
  verdict: RealtimeVerdict;
};

/**
 * Vérification §16 : un appel `/v1/news/top` par langue (tri par défaut : date de publication),
 * puis l'âge de l'article le plus récent. Verdict `exa` dès qu'une langue n'a aucun article ou un
 * article le plus récent de plus de 2 h ; `thenewsapi` si les trois langues sont fraîches ;
 * `unknown` si une langue n'a pas pu être vérifiée et qu'aucune n'est en retard. Un 401, 402, 403,
 * 429 ou un délai dépassé arrête les appels suivants. Aucun secret dans le rapport.
 */
export async function checkRealtime(opts: {
  token: string;
  fetch: HttpFetch;
  now?: Date;
  timeoutMs?: number;
  maxAgeMinutes?: number;
}): Promise<RealtimeReport> {
  const now = opts.now ?? new Date();
  const maxAge = opts.maxAgeMinutes ?? REALTIME_MAX_AGE_MINUTES;
  const breaker = new Breaker();
  const perLang = {} as Record<Lang, LangFreshness>;
  let requests = 0;
  for (const lang of LANGS) {
    if (breaker.open) {
      perLang[lang] = { newest: null, ageMinutes: null, articles: 0, error: `non vérifié (${breaker.reason})` };
      continue;
    }
    requests++;
    try {
      const items = await topNews({ language: lang, limit: 3 }, { token: opts.token, fetch: opts.fetch, timeoutMs: opts.timeoutMs ?? 10_000 });
      const dates = items.map((i) => toIso(i.published_at)).filter((d): d is string => d !== null).sort();
      const newest = dates.at(-1) ?? null;
      const ageMinutes = newest === null ? null : Math.max(0, Math.floor((now.getTime() - Date.parse(newest)) / 60_000));
      perLang[lang] = { newest, ageMinutes, articles: items.length, error: null };
    } catch (e) {
      breaker.trip(e);
      perLang[lang] = { newest: null, ageMinutes: null, articles: 0, error: stripSecrets(messageOf(e), [opts.token]) };
    }
  }
  const checked = LANGS.map((l) => perLang[l]).filter((f) => f.error === null);
  const late = checked.some((f) => f.ageMinutes === null || f.ageMinutes > maxAge);
  const verdict: RealtimeVerdict = late ? 'exa' : checked.length === LANGS.length ? 'thenewsapi' : 'unknown';
  return { checkedAt: now.toISOString(), maxAgeMinutes: maxAge, perLang, requests, verdict };
}

/** Lignes affichées par `npm run check:thenewsapi`, avec la consigne pour `collect.json`. */
export function describeRealtime(r: RealtimeReport, currentPrimary: 'thenewsapi' | 'exa'): string[] {
  const lines = LANGS.map((lang) => {
    const f = r.perLang[lang];
    if (f.error !== null) return `${lang.toUpperCase()} : erreur, ${f.error}`;
    if (f.newest === null) return `${lang.toUpperCase()} : aucun article daté (${f.articles} renvoyés)`;
    return `${lang.toUpperCase()} : article le plus récent publié il y a ${f.ageMinutes} min (${f.newest})`;
  });
  if (r.verdict === 'thenewsapi') {
    lines.push(`Verdict : TheNewsAPI est en temps réel (au plus ${r.maxAgeMinutes} min dans les trois langues).`);
    if (currentPrimary !== 'thenewsapi') lines.push('À faire : remettre "primary": "thenewsapi" dans pipeline/config/collect.json.');
  } else if (r.verdict === 'exa') {
    lines.push(`Verdict : TheNewsAPI n'est pas en temps réel (plus de ${r.maxAgeMinutes} min ou aucun article) : Exa doit devenir la découverte principale (spec §16).`);
    if (currentPrimary !== 'exa') lines.push('À faire : passer "primary": "exa" dans pipeline/config/collect.json.');
  } else {
    lines.push('Verdict : vérification impossible, configuration inchangée. Relance plus tard.');
  }
  lines.push(`Requêtes TheNewsAPI utilisées : ${r.requests} (hors budget quotidien de 90 de brief:collect).`);
  return lines;
}
```

`pipeline/collect/check-thenewsapi.ts` :

```ts
import { fileURLToPath } from 'node:url';
import { loadCollectConfig } from './config';
import type { HttpFetch } from './http';
import { checkRealtime, describeRealtime } from './realtime';

const CODES = { thenewsapi: 0, exa: 1, unknown: 2 } as const;

try {
  try {
    process.loadEnvFile('.env');
  } catch (e) {
    // Pas de .env : variables d'environnement du processus seulement. Toute autre erreur est remontée.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const { primary } = loadCollectConfig(fileURLToPath(new URL('../config/collect.json', import.meta.url)));
  const token = process.env.THENEWSAPI_KEY?.trim();
  console.log(`check:thenewsapi (découverte principale actuelle : ${primary})`);
  if (!token) {
    console.log('THENEWSAPI_KEY absente (environnement ou .env) : vérification impossible.');
    process.exit(2);
  }
  const report = await checkRealtime({ token, fetch: fetch as HttpFetch });
  for (const line of describeRealtime(report, primary)) console.log(line);
  process.exit(CODES[report.verdict]);
} catch (e) {
  console.error(`check:thenewsapi : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
```

Dans `package.json` (racine), ajouter dans `"scripts"`, juste après `"brief:render"` :

```json
    "check:thenewsapi": "tsx pipeline/collect/check-thenewsapi.ts",
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/collect/realtime.test.ts && npm run typecheck`
Attendu : `Tests  6 passed (6)`, typage propre.

Commande : `npm test`
Attendu : `Test Files  45 passed (45)`, `Tests  335 passed (335)`.

- [ ] **Étape 5 : essai sans clé (aucun appel réseau)**

S'assurer qu'aucun `.env` n'existe à la racine, puis lancer :

Commande : `env -u THENEWSAPI_KEY npm run -s check:thenewsapi; echo "check=$?"`
Attendu :

```text
check:thenewsapi (découverte principale actuelle : thenewsapi)
THENEWSAPI_KEY absente (environnement ou .env) : vérification impossible.
check=2
```

- [ ] **Étape 6 : commit**

```bash
git add pipeline/collect/realtime.ts pipeline/collect/check-thenewsapi.ts pipeline/test/collect/realtime.test.ts package.json
git commit -m "feat(collect): vérification §16 du temps réel de TheNewsAPI"
```

---

### Tâche 11 : `npm run brief:context` et fermeture des Threads (R12)

**Fichiers :**
- Créer : `pipeline/context/store.ts`, `pipeline/context/stale.ts`, `pipeline/context/memory-store.ts`, `pipeline/context/select-store.ts`, `pipeline/context/run-context.ts`, `pipeline/context/cli.ts`
- Modifier : `package.json` (script `brief:context`)
- Test : `pipeline/test/context/memory-store.test.ts`, `pipeline/test/context/run-context.test.ts`, `pipeline/test/context/cli.test.ts`

Comportement attendu :
- **Interface `ContextStore`.** Elle offre `openThreads()`, `yesterdayTopics(date)` et `closeStaleThreads(date, days = 21)`. `EmptyContextStore` ne renvoie rien. `MemoryContextStore` sert de référence de comportement pour le store Supabase du lot 4.
- **R12.** Un Thread dont le dernier événement (sinon `updatedAt`, en date de Paris) date d'au moins 21 jours est fermé. Un événement futur ne le rend jamais périmé. `staleCutoff(date)` donne la dernière date d'événement qui rend un Thread périmé, pour la requête SQL du lot 4.
- **Choix du store.** `selectStore` choisit le store vide, avec un avertissement, sans `SUPABASE_URL` ou sans `SUPABASE_SERVICE_ROLE_KEY`. Le lot 4 remplacera la seconde branche par le store Supabase.
- **`runContext`, étapes.**
  1. Fermer les Threads périmés.
  2. Lire les Threads ouverts, puis les sujets de la veille. Chaque appel au store est borné à 30 s.
  3. Revalider chaque élément : un Thread invalide, en double ou déjà fermé est retiré avec un avertissement, de même qu'un sujet vide.
  4. Trier : Threads par langue, mise à jour décroissante puis id ; sujets par langue, dans leur ordre.
  5. Écrire `context.json` (`ContextSchema`) et `context-report.json` : store, Threads fermés, compteurs et problèmes.
- **`runContext`, pannes.**
  - Une erreur ou un délai dépassé du store : code 2, pas de `context.json`, l'ancien fichier supprimé. Un contexte faux ferait dupliquer des Threads.
  - Une date invalide : rien n'est écrit.
  - La clé Supabase est masquée dans tous les messages.
- **CLI.** Il charge `.env` comme `brief:collect` et affiche le store, les problèmes et le bilan.

- [ ] **Étape 1 : écrire les tests qui échouent**

`pipeline/test/context/memory-store.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { lastEventDate, MemoryContextStore, type StoredThread } from '../../context/memory-store';
import { isStale, STALE_DAYS, staleCutoff } from '../../context/stale';
import { EmptyContextStore } from '../../context/store';

const thread = (id: string, events: string[], extra: Partial<StoredThread> = {}): StoredThread => ({
  id,
  slug: id,
  title: `Thread ${id}`,
  lang: 'fr',
  updatedAt: '2026-10-01T08:00:00+02:00',
  status: 'open',
  events,
  ...extra,
});

describe('R12 : Thread sans événement depuis 21 jours', () => {
  it('périmé à partir de 21 jours pleins, jamais pour un événement futur', () => {
    expect(STALE_DAYS).toBe(21);
    expect(isStale('2026-10-16', '2026-11-06')).toBe(true);
    expect(isStale('2026-10-17', '2026-11-06')).toBe(false);
    expect(isStale('2026-11-10', '2026-11-06')).toBe(false);
    expect(staleCutoff('2026-11-06')).toBe('2026-10-16');
    expect(staleCutoff('2026-03-01', 1)).toBe('2026-02-28');
  });

  it('dernier événement, ou date de Paris de la dernière mise à jour s’il n’y en a pas', () => {
    expect(lastEventDate(thread('a', ['2026-10-20', '2026-11-02', '2026-10-01']))).toBe('2026-11-02');
    expect(lastEventDate(thread('b', [], { updatedAt: '2026-10-15T23:30:00Z' }))).toBe('2026-10-16');
  });

  it('le store en mémoire ferme les seuls Threads périmés, une seule fois', async () => {
    const store = new MemoryContextStore({
      threads: [
        thread('vieux', ['2026-10-01', '2026-10-16']),
        thread('frais', ['2026-10-17']),
        thread('sans-evenement', [], { updatedAt: '2026-10-10T09:00:00Z' }),
        thread('deja-ferme', ['2026-01-01'], { status: 'closed' }),
      ],
    });
    expect(await store.closeStaleThreads('2026-11-06')).toEqual(['sans-evenement', 'vieux']);
    expect((await store.openThreads()).map((t) => t.id)).toEqual(['frais']);
    expect(await store.closeStaleThreads('2026-11-06')).toEqual([]);
    expect(await store.closeStaleThreads('2026-11-07', 21)).toEqual(['frais']);
  });

  it('renvoie les Threads ouverts au format du contexte et les sujets de la veille seulement', async () => {
    const store = new MemoryContextStore({
      threads: [thread('t1', ['2026-11-05'])],
      topics: [
        { date: '2026-11-05', lang: 'fr', title: 'Budget au Sénat' },
        { date: '2026-11-04', lang: 'fr', title: 'Avant-veille' },
        { date: '2026-11-05', lang: 'es', title: 'Presupuestos' },
      ],
    });
    expect(await store.openThreads()).toEqual([{ id: 't1', slug: 't1', title: 'Thread t1', lang: 'fr', updatedAt: '2026-10-01T08:00:00+02:00' }]);
    expect(await store.yesterdayTopics('2026-11-06')).toEqual([
      { lang: 'fr', title: 'Budget au Sénat' },
      { lang: 'es', title: 'Presupuestos' },
    ]);
  });

  it('le store vide ne renvoie rien', async () => {
    const store = new EmptyContextStore();
    expect([await store.openThreads(), await store.yesterdayTopics(), await store.closeStaleThreads()]).toEqual([[], [], []]);
  });
});
```

`pipeline/test/context/run-context.test.ts` :

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContextSchema } from '@daily-brief/schema';
import { MemoryContextStore, type StoredThread } from '../../context/memory-store';
import { runContext } from '../../context/run-context';
import { selectStore } from '../../context/select-store';
import { EmptyContextStore, type ContextStore } from '../../context/store';

const DAY = '2026-11-06';
const NOW = new Date('2026-11-06T04:13:00Z');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const thread = (id: string, lang: 'fr' | 'en' | 'es', updatedAt: string, events: string[]): StoredThread => ({
  id,
  slug: id,
  title: `Thread ${id}`,
  lang,
  updatedAt,
  status: 'open',
  events,
});

function setup() {
  const outDir = mkdtempSync(join(tmpdir(), 'context-'));
  return { outDir, dayDir: join(outDir, DAY) };
}

describe('runContext', () => {
  it('ferme les Threads périmés (R12) puis écrit context.json trié et le rapport', async () => {
    const { outDir, dayDir } = setup();
    const store = new MemoryContextStore({
      threads: [
        thread('es-1', 'es', '2026-11-05T10:00:00Z', ['2026-11-05']),
        thread('fr-ancien', 'fr', '2026-10-01T10:00:00Z', ['2026-10-01']),
        thread('fr-b', 'fr', '2026-11-04T10:00:00Z', ['2026-11-04']),
        thread('fr-a', 'fr', '2026-11-05T09:00:00+01:00', ['2026-11-05']),
        thread('en-1', 'en', '2026-11-02T10:00:00Z', ['2026-11-02']),
      ],
      topics: [
        { date: '2026-11-05', lang: 'es', title: 'Presupuestos' },
        { date: '2026-11-05', lang: 'fr', title: 'Budget au Sénat' },
        { date: '2026-11-05', lang: 'fr', title: 'Retraites' },
      ],
    });
    const r = await runContext({ outDir, date: DAY, store, now: NOW });
    expect(r.exitCode).toBe(0);
    const ctx = ContextSchema.parse(read(join(dayDir, 'context.json')));
    expect(ctx.openThreads.map((t) => t.id)).toEqual(['fr-a', 'fr-b', 'en-1', 'es-1']);
    expect(ctx.yesterdayTopics.map((t) => t.title)).toEqual(['Budget au Sénat', 'Retraites', 'Presupuestos']);
    expect(read(join(dayDir, 'context-report.json'))).toEqual({
      date: DAY,
      generatedAt: '2026-11-06T04:13:00.000Z',
      exitCode: 0,
      store: 'mémoire',
      staleDays: 21,
      closedThreads: ['fr-ancien'],
      openThreads: 4,
      yesterdayTopics: 3,
      issues: [],
    });
    expect(store.threads.find((t) => t.id === 'fr-ancien')!.status).toBe('closed');
  });

  it('store vide : contexte vide écrit avec l’avertissement, code 0', async () => {
    const { outDir, dayDir } = setup();
    const { store, warning } = selectStore({});
    const r = await runContext({ outDir, date: DAY, store, warnings: [warning], now: NOW });
    expect(r.exitCode).toBe(0);
    expect(read(join(dayDir, 'context.json'))).toEqual({ date: DAY, openThreads: [], yesterdayTopics: [] });
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)' }]);
    expect(selectStore({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }).warning).toBe('store Supabase pas encore disponible (lot 4) : contexte vide');
  });

  it('retire les éléments invalides, en double ou fermés, avec un avertissement', async () => {
    const { outDir, dayDir } = setup();
    const store: ContextStore = {
      name: 'test',
      closeStaleThreads: async () => ['ferme'],
      openThreads: async () =>
        [
          { id: 'ok', slug: 'ok', title: 'OK', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' },
          { id: 'ok', slug: 'ok', title: 'OK', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' },
          { id: 'ferme', slug: 'f', title: 'Fermé', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' },
          { id: 'de', slug: 'de', title: 'Allemand', lang: 'de', updatedAt: '2026-11-05T10:00:00Z' },
        ] as never,
      yesterdayTopics: async () => [{ lang: 'fr', title: '  ' }, { lang: 'en', title: 'Midterms' }] as never,
    };
    const r = await runContext({ outDir, date: DAY, store, now: NOW });
    expect(r.exitCode).toBe(0);
    const ctx = read(join(dayDir, 'context.json'));
    expect(ctx.openThreads.map((t: { id: string }) => t.id)).toEqual(['ok']);
    expect(ctx.yesterdayTopics).toEqual([{ lang: 'en', title: 'Midterms' }]);
    expect(r.report.issues.map((i) => i.message)).toEqual([
      'Thread ok en double, ignoré',
      'Thread ferme fermé mais encore listé ouvert, ignoré',
      expect.stringMatching(/^Thread n° 4 invalide, ignoré : lang /),
      'sujet de la veille n° 1 invalide, ignoré',
    ]);
  });

  it('store en erreur ou muet : pas de context.json, ancien fichier supprimé, code 2, aucun secret', async () => {
    const { outDir, dayDir } = setup();
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, 'context.json'), '{"périmé":true}');
    const failing: ContextStore = {
      name: 'supabase',
      openThreads: async () => {
        throw new Error('JWT invalide : service-SECRET-KEY');
      },
      yesterdayTopics: async () => [],
      closeStaleThreads: async () => [],
    };
    const r = await runContext({ outDir, date: DAY, store: failing, secrets: ['service-SECRET-KEY'], now: NOW });
    expect(r.exitCode).toBe(2);
    expect(existsSync(join(dayDir, 'context.json'))).toBe(false);
    const report = readFileSync(join(dayDir, 'context-report.json'), 'utf8');
    expect(report).not.toContain('service-SECRET-KEY');
    expect(JSON.parse(report).issues).toEqual([{ level: 'error', message: 'store supabase : JWT invalide : ***' }]);

    const mute: ContextStore = { ...failing, openThreads: () => new Promise(() => {}) };
    const t0 = Date.now();
    const m = await runContext({ outDir, date: DAY, store: mute, timeoutMs: 30, now: NOW });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(m.exitCode).toBe(2);
    expect(m.report.issues[0].message).toBe('store supabase : Threads ouverts : délai dépassé (30 ms)');
  });

  it('refuse une date invalide sans rien écrire', async () => {
    const { outDir } = setup();
    const r = await runContext({ outDir, date: '../2026-13-45', store: new EmptyContextStore(), now: NOW });
    expect(r.exitCode).toBe(2);
    expect(r.report.issues).toEqual([{ level: 'error', message: 'date incorrecte : « ../2026-13-45 »' }]);
    expect(existsSync(join(outDir, '2026-13-45'))).toBe(false);
  });
});
```

`pipeline/test/context/cli.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../run-cli';

describe('CLI brief:context', () => {
  it('sans Supabase : contexte vide, avertissement, code 0', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      'brief:context 2026-11-06 (store vide)\n' +
        '[warning] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)\n' +
        'context.json : 0 Threads ouverts, 0 sujets de la veille, 0 Threads fermés (R12)\n',
    );
    expect(JSON.parse(readFileSync(join(r.cwd, 'out/2026-11-06/context.json'), 'utf8'))).toEqual({ date: '2026-11-06', openThreads: [], yesterdayTopics: [] });
  }, 30_000);

  it('sort avec le code 2 sur une date invalide', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-02-30']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] date incorrecte : « 2026-02-30 »');
  }, 30_000);
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/context`
Attendu : ÉCHEC. `memory-store.test.ts` et `run-context.test.ts` donnent « Cannot find module '../../context/memory-store' » ; les 2 tests de `cli.test.ts` échouent sur le code de sortie (1 au lieu de 0 ou 2).

- [ ] **Étape 3 : écrire l'interface, la règle R12 et les stores**

`pipeline/context/store.ts` :

```ts
import type { Context, OpenThread } from '@daily-brief/schema';

export type Topic = Context['yesterdayTopics'][number];

/**
 * Accès aux Threads et aux sujets publiés. Le store Supabase arrive au lot 4 ; ses réponses sont
 * revalidées par `runContext`, qui ne fait confiance à aucune donnée externe.
 */
export interface ContextStore {
  /** Nom affiché dans le rapport (« vide », « mémoire », « supabase »). */
  readonly name: string;
  /** Threads ouverts. */
  openThreads(): Promise<OpenThread[]>;
  /** Sujets publiés la veille de `date` (AAAA-MM-JJ), toutes langues. */
  yesterdayTopics(date: string): Promise<Topic[]>;
  /** R12 : ferme les Threads sans événement depuis `days` jours à la date `date` ; renvoie leurs id. */
  closeStaleThreads(date: string, days?: number): Promise<string[]>;
}

/** Store sans base : aucun Thread, aucun sujet, rien à fermer. */
export class EmptyContextStore implements ContextStore {
  readonly name = 'vide';

  async openThreads(): Promise<OpenThread[]> {
    return [];
  }

  async yesterdayTopics(): Promise<Topic[]> {
    return [];
  }

  async closeStaleThreads(): Promise<string[]> {
    return [];
  }
}
```

`pipeline/context/stale.ts` :

```ts
import { addDays, daysBetween } from '../lib/date';

/** R12 : un Thread sans événement depuis 21 jours est fermé. */
export const STALE_DAYS = 21;

/** Dernière date d'événement (AAAA-MM-JJ) qui rend un Thread périmé à la date `date` (pour une requête SQL au lot 4). */
export function staleCutoff(date: string, days: number = STALE_DAYS): string {
  return addDays(date, -days);
}

/** Vrai si le dernier événement date d'au moins `days` jours avant `date` (un événement futur ne l'est jamais). */
export function isStale(lastEventDate: string, date: string, days: number = STALE_DAYS): boolean {
  return daysBetween(lastEventDate, date) >= days;
}
```

`pipeline/context/memory-store.ts` :

```ts
import type { Lang, OpenThread } from '@daily-brief/schema';
import { addDays, parisToday } from '../lib/date';
import { isStale, STALE_DAYS } from './stale';
import type { ContextStore, Topic } from './store';

/** Thread tel que stocké : statut et dates (AAAA-MM-JJ) de ses événements. */
export type StoredThread = OpenThread & { status: 'open' | 'closed'; events: string[] };
export type StoredTopic = { date: string; lang: Lang; title: string };

/** Date du dernier événement ; à défaut, date de Paris de la dernière mise à jour. */
export function lastEventDate(t: StoredThread): string {
  return [...t.events].sort().at(-1) ?? parisToday(new Date(t.updatedAt));
}

/** Store en mémoire : référence de comportement pour le store Supabase (lot 4) et support des tests. */
export class MemoryContextStore implements ContextStore {
  readonly name = 'mémoire';
  readonly threads: StoredThread[];
  readonly topics: StoredTopic[];

  constructor(data: { threads?: StoredThread[]; topics?: StoredTopic[] } = {}) {
    this.threads = structuredClone(data.threads ?? []);
    this.topics = structuredClone(data.topics ?? []);
  }

  async openThreads(): Promise<OpenThread[]> {
    return this.threads.filter((t) => t.status === 'open').map(({ id, slug, title, lang, updatedAt }) => ({ id, slug, title, lang, updatedAt }));
  }

  async yesterdayTopics(date: string): Promise<Topic[]> {
    const yesterday = addDays(date, -1);
    return this.topics.filter((t) => t.date === yesterday).map(({ lang, title }) => ({ lang, title }));
  }

  async closeStaleThreads(date: string, days: number = STALE_DAYS): Promise<string[]> {
    const closed: string[] = [];
    for (const t of this.threads) {
      if (t.status === 'open' && isStale(lastEventDate(t), date, days)) {
        t.status = 'closed';
        closed.push(t.id);
      }
    }
    return closed.sort();
  }
}
```

`pipeline/context/select-store.ts` :

```ts
import { EmptyContextStore, type ContextStore } from './store';

/**
 * Store de `brief:context` d'après l'environnement. Sans SUPABASE_URL ni SUPABASE_SERVICE_ROLE_KEY :
 * store vide et avertissement. Le store Supabase remplace la seconde branche au lot 4.
 */
export function selectStore(env: Record<string, string | undefined>): { store: ContextStore; warning: string } {
  const configured = !!env.SUPABASE_URL?.trim() && !!env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return {
    store: new EmptyContextStore(),
    warning: configured
      ? 'store Supabase pas encore disponible (lot 4) : contexte vide'
      : 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)',
  };
}
```

- [ ] **Étape 4 : écrire `runContext` et le CLI**

`pipeline/context/run-context.ts` :

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ContextSchema, IsoDateSchema, LANGS, LangSchema, OpenThreadSchema, type Context, type OpenThread } from '@daily-brief/schema';
import { stripSecrets } from '../collect/redact';
import { STALE_DAYS } from './stale';
import type { ContextStore, Topic } from './store';

export type ContextIssue = { level: 'error' | 'warning'; message: string };

export type ContextReport = {
  date: string;
  generatedAt: string;
  exitCode: 0 | 2;
  store: string;
  staleDays: number;
  closedThreads: string[];
  openThreads: number;
  yesterdayTopics: number;
  issues: ContextIssue[];
};

export type RunContextOptions = {
  outDir: string;
  date: string;
  store: ContextStore;
  /** Avertissements préalables (choix du store). */
  warnings?: string[];
  /** Secrets à masquer dans les messages (clé Supabase). */
  secrets?: (string | undefined)[];
  /** Délai de chaque appel au store (30 s par défaut). */
  timeoutMs?: number;
  now?: Date;
};

const TopicSchema = z.object({ lang: LangSchema, title: z.string().trim().min(1) });
const ClosedSchema = z.array(z.string().min(1));

/** Appel au store borné dans le temps : une base muette ne bloque jamais la routine. */
async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms} ms)`)), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const langRank = (l: string) => (LANGS as readonly string[]).indexOf(l);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `brief:context` : ferme les Threads périmés (R12, 21 jours), lit les Threads ouverts et les sujets
 * de la veille, puis écrit `out/<date>/context.json` (ContextSchema) et `context-report.json`.
 * Chaque élément est revalidé : un élément invalide est retiré avec un avertissement. Une erreur ou
 * un délai dépassé du store : pas de context.json et code 2 (un contexte faux ferait dupliquer des
 * Threads). Les anciens fichiers sont supprimés d'abord ; le rapport est toujours écrit.
 */
export async function runContext(opts: RunContextOptions): Promise<{ exitCode: 0 | 2; report: ContextReport }> {
  const now = opts.now ?? new Date();
  const ms = opts.timeoutMs ?? 30_000;
  const clean = (m: string) => stripSecrets(m, opts.secrets ?? []);
  const report: ContextReport = {
    date: opts.date,
    generatedAt: now.toISOString(),
    exitCode: 2,
    store: opts.store.name,
    staleDays: STALE_DAYS,
    closedThreads: [],
    openThreads: 0,
    yesterdayTopics: 0,
    issues: (opts.warnings ?? []).map((m) => ({ level: 'warning' as const, message: clean(m) })),
  };
  const issue = (level: ContextIssue['level'], message: string) => report.issues.push({ level, message: clean(message) });
  if (!IsoDateSchema.safeParse(opts.date).success) {
    issue('error', `date incorrecte : « ${opts.date} »`);
    return { exitCode: 2, report };
  }
  const dayDir = join(opts.outDir, opts.date);
  const contextPath = join(dayDir, 'context.json');
  const reportPath = join(dayDir, 'context-report.json');
  mkdirSync(dayDir, { recursive: true });
  rmSync(contextPath, { force: true });
  rmSync(reportPath, { force: true });

  const finish = (context: Context | null) => {
    report.exitCode = context ? 0 : 2;
    if (context) writeFileSync(contextPath, JSON.stringify(context, null, 2) + '\n');
    writeFileSync(reportPath, clean(JSON.stringify(report, null, 2)) + '\n');
    return { exitCode: report.exitCode, report };
  };

  try {
    const closed = ClosedSchema.parse(await withTimeout('fermeture des Threads', ms, () => opts.store.closeStaleThreads(opts.date, STALE_DAYS)));
    report.closedThreads = [...new Set(closed)].sort();
    const rawThreads: unknown[] = await withTimeout('Threads ouverts', ms, () => opts.store.openThreads());
    const rawTopics: unknown[] = await withTimeout('sujets de la veille', ms, () => opts.store.yesterdayTopics(opts.date));

    const threads = new Map<string, OpenThread>();
    for (const [i, raw] of rawThreads.entries()) {
      const t = OpenThreadSchema.safeParse(raw);
      if (!t.success) issue('warning', `Thread n° ${i + 1} invalide, ignoré : ${t.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join(' ; ')}`);
      else if (report.closedThreads.includes(t.data.id)) issue('warning', `Thread ${t.data.id} fermé mais encore listé ouvert, ignoré`);
      else if (threads.has(t.data.id)) issue('warning', `Thread ${t.data.id} en double, ignoré`);
      else threads.set(t.data.id, t.data);
    }
    const topics: Topic[] = [];
    for (const [i, raw] of rawTopics.entries()) {
      const t = TopicSchema.safeParse(raw);
      if (t.success) topics.push(t.data);
      else issue('warning', `sujet de la veille n° ${i + 1} invalide, ignoré`);
    }

    const context = ContextSchema.parse({
      date: opts.date,
      openThreads: [...threads.values()].sort((a, b) => langRank(a.lang) - langRank(b.lang) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || cmp(a.id, b.id)),
      yesterdayTopics: topics.map((t, i) => ({ t, i })).sort((a, b) => langRank(a.t.lang) - langRank(b.t.lang) || a.i - b.i).map(({ t }) => t),
    });
    report.openThreads = context.openThreads.length;
    report.yesterdayTopics = context.yesterdayTopics.length;
    return finish(context);
  } catch (e) {
    issue('error', `store ${opts.store.name} : ${e instanceof Error ? e.message : String(e)}`);
    return finish(null);
  }
}
```

`pipeline/context/cli.ts` :

```ts
import { parseArgs } from 'node:util';
import { parisToday } from '../lib/date';
import { runContext } from './run-context';
import { selectStore } from './select-store';

try {
  try {
    process.loadEnvFile('.env');
  } catch (e) {
    // Pas de .env : variables d'environnement du processus seulement. Toute autre erreur est remontée.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const { store, warning } = selectStore(process.env);
  const { exitCode, report } = await runContext({
    outDir: values.out!,
    date,
    store,
    warnings: [warning],
    secrets: [process.env.SUPABASE_SERVICE_ROLE_KEY],
  });
  console.log(`brief:context ${date} (store ${report.store})`);
  for (const i of report.issues) console.log(`[${i.level}] ${i.message}`);
  if (exitCode === 0) {
    console.log(`context.json : ${report.openThreads} Threads ouverts, ${report.yesterdayTopics} sujets de la veille, ${report.closedThreads.length} Threads fermés (R12)`);
  } else console.log('Erreur : context.json non écrit.');
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:context : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
```

Dans `package.json` (racine), ajouter dans `"scripts"`, juste avant `"brief:collect"` :

```json
    "brief:context": "tsx pipeline/context/cli.ts",
```

Le bloc `"scripts"` devient :

```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "schema:emit": "tsx packages/schema/scripts/emit-json-schema.ts",
    "brief:context": "tsx pipeline/context/cli.ts",
    "brief:collect": "tsx pipeline/collect/cli.ts",
    "brief:verify": "tsx pipeline/verify/cli.ts",
    "brief:render": "tsx pipeline/render/cli.ts",
    "check:thenewsapi": "tsx pipeline/collect/check-thenewsapi.ts",
    "maps:preview": "tsx packages/maps/scripts/preview.ts"
  },
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run pipeline/test/context && npm run typecheck`
Attendu : `Tests  12 passed (12)` (5 + 5 + 2), typage propre.

Commande : `npm test`
Attendu : `Test Files  48 passed (48)`, `Tests  347 passed (347)`.

- [ ] **Étape 6 : essai sans Supabase**

Commande : `env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY npm run -s brief:context -- --date 2026-11-06 --out /tmp/context-essai; echo "context=$?"; cat /tmp/context-essai/2026-11-06/context.json`
Attendu :

```text
brief:context 2026-11-06 (store vide)
[warning] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)
context.json : 0 Threads ouverts, 0 sujets de la veille, 0 Threads fermés (R12)
context=0
{
  "date": "2026-11-06",
  "openThreads": [],
  "yesterdayTopics": []
}
```

Supprimer ensuite le dossier : `rm -rf /tmp/context-essai`.

- [ ] **Étape 7 : commit**

```bash
git add pipeline/context pipeline/test/context package.json
git commit -m "feat(context): commande brief:context et fermeture des Threads (R12)"
```

---

### Tâche 12 : vérification finale et documentation

**Fichiers :**
- Modifier : `README.md` (section « Développement »), `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md` (consignes issues du lot 3)

- [ ] **Étape 1 : lancer toute la suite et le typage**

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  48 passed (48)`, `Tests  347 passed (347)` (252 des lots 1 et 2, plus 95 du lot 3), et `tsc` sans sortie.

- [ ] **Étape 2 : vérifier que seuls les CLI écrivent dans la console**

Les modules de collecte ne journalisent rien : tout passe par les bilans et les rapports, déjà masqués. Seuls les trois CLI affichent ces rapports.

Commande : `grep -ln "console\." pipeline/collect/*.ts pipeline/context/*.ts`
Attendu :

```text
pipeline/collect/check-thenewsapi.ts
pipeline/collect/cli.ts
pipeline/context/cli.ts
```

- [ ] **Étape 3 : compléter le README**

Dans le bloc de commandes de la section « Développement » de `README.md`, ajouter juste avant la ligne `npm run brief:verify …` :

```bash
npm run brief:context -- --date AAAA-MM-JJ [--out out]
npm run brief:collect -- --date AAAA-MM-JJ [--out out]
npm run check:thenewsapi   # vérification §16 : TheNewsAPI est-elle en temps réel ?
```

Puis ajouter ces trois paragraphes juste avant celui qui commence par `` `brief:verify` contrôle `` :

```markdown
`brief:context` ferme les Threads sans événement depuis 21 jours (R12), puis écrit `out/<date>/context.json` (Threads ouverts et sujets de la veille) et `context-report.json`. Tant que le store Supabase n'existe pas (lot 4), il écrit un contexte vide avec un avertissement. Une erreur ou un délai dépassé du store donne le code 2, sans `context.json`.

`brief:collect` interroge, chacune indépendamment, la découverte principale (TheNewsAPI, ou Exa selon `primary` dans `pipeline/config/collect.json`), Exa, les flux de `pipeline/config/feeds.json` et, en secours, Webz.io. Il dédoublonne les articles, ne télécharge le texte intégral que pour les domaines `full` de la liste blanche (R1), puis écrit `out/<date>/raw.json` et `collect-report.json` : requêtes par source, budget TheNewsAPI, erreurs sans secret et textes lus par langue, avec `light: true` sous 15 textes (édition allégée, §12). Les clés `THENEWSAPI_KEY`, `EXA_API_KEY` et `WEBZ_TOKEN` viennent de l'environnement ou de `.env` ; sans clé, la source est ignorée avec un avertissement. Le plafond de 90 requêtes TheNewsAPI par jour est suivi dans `out/thenewsapi-usage.json`. Code de sortie : 0 si au moins un article est collecté, 2 sinon.

`check:thenewsapi` (vérification §16) appelle une fois `/v1/news/top` par langue avec `THENEWSAPI_KEY` et affiche l'âge de l'article le plus récent. Si une langue dépasse 2 h, il conseille de passer `"primary": "exa"` dans `pipeline/config/collect.json`. Code 0 : temps réel ; 1 : passer à Exa ; 2 : vérification impossible. Il consomme 3 requêtes, hors du budget de 90.
```

- [ ] **Étape 4 : ajouter les consignes issues du lot 3 à la feuille de route**

Dans `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md`, ajouter à la fin de la section 5 :

```markdown
### Consignes issues du lot 3

- **Lot 4 (Supabase)** : implémenter `ContextStore` (`pipeline/context/store.ts`) avec la clé service, sur le modèle de `MemoryContextStore`. Le dernier événement d'un Thread est `max(thread_events.date)`, sinon `updated_at` en date de Paris. Un Thread est fermé quand cette date est antérieure ou égale à `staleCutoff(date)` (`pipeline/context/stale.ts`). Brancher ce store dans `pipeline/context/select-store.ts`, à la place du store vide. `runContext` revalide déjà chaque ligne, borne chaque appel à 30 s et masque `SUPABASE_SERVICE_ROLE_KEY`.
- **Lot 6 (appli)** : le bandeau « édition allégée » se fonde sur `perLang.<lang>.light` de `collect-report.json` (moins de 15 textes lus), que la publication recopie dans `runs`.
- **Lot 7 (routine)** :
  - **Mise en place.** Lancer `npm run check:thenewsapi` dès que la clé existe. Code 1 : passer `"primary": "exa"` dans `pipeline/config/collect.json` et commiter.
  - **Codes de sortie.** `brief:collect` code 2 : pas de `raw.json`, notifier « Brief incomplet ». `brief:context` code 2 : rédiger sans rattacher ni créer de Thread ce jour-là, et le signaler.
  - **Rubriques.** Affiner `pipeline/editorial/rubriques.json` (catégories, mots-clés et requêtes Exa par langue).
```

- [ ] **Étape 5 : commit**

```bash
git add README.md docs/superpowers/plans/2026-11-06-phase-1-roadmap.md
git commit -m "docs: commandes du lot 3 (brief:context, brief:collect, check:thenewsapi)"
```

---

## Couverture du lot (auto-revue)

| Exigence | Tâche |
|---|---|
| §4.1 TheNewsAPI : `/v1/news/top` par langue, rubrique et `published_after`, `/v1/news/similar/{uuid}` pour grouper, 3 articles par requête | 4, 2 (rubriques), 8 (groupes) |
| §4.1 budget de 90 requêtes par jour (FR 25, EN 20, ES 20, similar 25), imposé en code et suivi entre relances | 2, 4, 9 |
| §4.1 Exa : `category: news`, `startPublishedDate`, `contents` seulement pour la liste blanche | 5 |
| §4.1 Webz.io News API Lite en secours seulement (TheNewsAPI absente, en échec ou sous le seuil) | 5, 9 |
| §4.1 RSS seulement pour les domaines de la liste blanche (`full` ou `feed`), test contre `whitelist.json` | 6 |
| §4.2 R1 : texte intégral seulement pour les domaines `full`, aucun canal de contournement, garde testée sans requête | 3, 5, 7, 8, 9 |
| §5 `brief:context` puis `brief:collect`, `out/<date>/raw.json` dédoublonné | 9, 11 |
| §6.1 et lot 1 : `RawCollectionSchema` et `ContextSchema` respectés, `lang` ISO 639-1, `tryNormalizeUrl` | 3, 9, 11 |
| §6.3 clés lues dans l'environnement ou `.env`, jamais affichées ; clé absente = source ignorée avec avertissement | 1, 9, 10, 11 |
| §12 sources indépendantes, édition allégée sous 15 textes (`light` du rapport), routine jamais bloquée | 1, 2, 7, 9 |
| §13 tests du dédoublonnage | 8 |
| §16 TheNewsAPI en temps réel sur `/news/top`, sinon Exa principal (`primary` de `collect.json`, honoré par la collecte) | 10, 9 |
| R12 fermeture des Threads sans événement depuis 21 jours, testée sur un store en mémoire | 11 |
| Lot 7 : `rubriques.json` par rubrique et par langue (à affiner) | 2 |
| Hors lot : store Supabase (lot 4, interface et référence prêtes), bandeau « édition allégée » (lot 6), newsletters Gmail (lot 7), mise en place des clés (lot 7, §14) | — |
