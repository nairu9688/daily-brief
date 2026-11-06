# Lot 1 — Fondations, schéma et contrôle éditorial : plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :** poser le monorepo, le schéma de données des éditions (§6.1) et le contrôle éditorial `npm run brief:verify`. Ce contrôle applique automatiquement R1 à R12 et ne bloque jamais une édition (§7).

**Architecture :** un monorepo npm workspaces. `packages/schema` est la source unique des types : Zod 4 → types TS par `z.infer`, JSON Schema émis. `pipeline/lib` contient les utilitaires partagés avec les lots suivants (URL, date de Paris, liste blanche). `pipeline/verify` a un module pur par règle, un orchestrateur `verifyEdition` (édition → copie corrigée + liste de problèmes) et un exécuteur `runVerify` qui lit et écrit `out/<date>/`.

**Pile :** Node 22, TypeScript 5 (strict), tsx, Vitest 3, Zod 4.

**Feuille de route :** `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md`. **Spec :** `docs/specs/2026-11-06-daily-brief-design.md`, §5, §6.1, §7 et §13.

---

## Contexte pour l'exécutant

- Le dépôt contient déjà le kit : `docs/specs/`, `design/`, `fixtures/brief-2026-11-06.json`, `fixtures/threads-2026-11-06.json` et `reference/`. **Ne modifie pas** `fixtures/brief-2026-11-06.json` : c'est le contenu réel des maquettes.
- La fixture est une enveloppe `{ date, issue, editions: [fr, en, es] }`. Le pipeline, lui, manipule une `Edition` par fichier : `out/<date>/fr.json`, etc.
- Les textes sources des articles ne sont pas dans la fixture. Les tests R5 et R6 utilisent des extraits **reconstitués** dans `fixtures/sources/` (tâche 6).
- Sémantique du contrôle : chaque violation corrige l'édition (élément retiré, sujet rétrogradé en brève) et produit un problème `fixed`. Un objectif non atteint produit un `warning`. Un schéma invalide produit une `error`. Code de sortie du CLI : 0 si propre, 1 si des corrections ont été appliquées, 2 en cas d'erreur.
- Toutes les commandes se lancent depuis la racine du dépôt.

## Structure des fichiers créés

```
package.json                    workspaces, scripts test / typecheck / schema:emit / brief:verify
tsconfig.json                   TypeScript strict, résolution « Bundler », sans émission
vitest.config.ts                tests de packages/* et pipeline/test
.gitignore
packages/schema/
  package.json                  @daily-brief/schema, exporte src/index.ts
  src/rubrics.ts                langues, clés et libellés des 9 rubriques (§3)
  src/edition.ts                schémas Zod Edition / Brief et types (§6.1)
  src/raw.ts                    schémas RawCollection (sortie collecte) et Context (Threads ouverts)
  src/parse.ts                  parseEdition / parseBrief → erreurs lisibles
  src/index.ts
  scripts/emit-json-schema.ts   écrit packages/schema/edition.schema.json
  test/edition.test.ts, test/raw.test.ts
pipeline/
  package.json                  @daily-brief/pipeline
  config/whitelist.json         R1 + pays des médias (R2)
  editorial/programme-ect.md    matières reconnues pour R9
  lib/url.ts                    normalizeUrl, hostOf, outletKey
  lib/date.ts                   parisToday
  lib/whitelist.ts              loadWhitelist, lookupDomain, canReadFull
  verify/normalize.ts           normalisation de texte pour R5
  verify/quotes.ts              R5
  verify/numbers.ts             R6
  verify/divergences.ts         R7
  verify/perimeter.ts           R2
  verify/prepa.ts               R9
  verify/visuals.ts             R11
  verify/threads.ts             R12
  verify/vocab.ts               R10
  verify/sources.ts             index des textes lus (raw.json + newsletters)
  verify/diversity.ts           R3
  verify/issues.ts              type Issue, code de sortie, affichage
  verify/verify-edition.ts      orchestrateur R1–R12 sur une édition
  verify/run-verify.ts          lecture/écriture de out/<date>/
  verify/cli.ts                 npm run brief:verify
  test/helpers.ts, test/lib/*.test.ts, test/verify/*.test.ts
fixtures/sources/               textes sources reconstitués pour R5/R6
```

---

### Tâche 1 : squelette du monorepo

**Fichiers :**
- Créer : `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `packages/schema/package.json`, `pipeline/package.json`

- [ ] **Étape 1 : écrire `package.json`**

```json
{
  "name": "daily-brief",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "workspaces": ["packages/*", "pipeline"],
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "schema:emit": "tsx packages/schema/scripts/emit-json-schema.ts",
    "brief:verify": "tsx pipeline/verify/cli.ts"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Étape 2 : écrire `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["packages/*/src", "packages/*/scripts", "packages/*/test", "pipeline/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Étape 3 : écrire `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'pipeline/test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Étape 4 : écrire `.gitignore`**

```gitignore
node_modules/
out/
.env
.env.*
.next/
*.log
.DS_Store
```

- [ ] **Étape 5 : écrire les deux `package.json` de workspace**

`packages/schema/package.json` :

```json
{
  "name": "@daily-brief/schema",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^4.0.0" }
}
```

`pipeline/package.json` :

```json
{
  "name": "@daily-brief/pipeline",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": { "@daily-brief/schema": "*" }
}
```

- [ ] **Étape 6 : installer et vérifier**

Commande : `npm install && npm ls zod vitest @daily-brief/schema`
Attendu : `zod@4.x`, `vitest@3.x` et le lien `@daily-brief/schema -> ./packages/schema` sont listés, sans erreur. `package-lock.json` est créé.

- [ ] **Étape 7 : commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore packages/schema/package.json pipeline/package.json
git commit -m "chore: monorepo npm workspaces (TypeScript, Vitest, tsx)"
```

---

### Tâche 2 : schéma des éditions (`packages/schema`)

**Fichiers :**
- Créer : `packages/schema/src/rubrics.ts`, `packages/schema/src/edition.ts`, `packages/schema/src/parse.ts`, `packages/schema/src/index.ts`
- Test : `packages/schema/test/edition.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBrief, parseEdition, type Brief, type Edition } from '../src';

const fixture: Brief = JSON.parse(
  readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'),
);
const edition = (lang: 'fr' | 'en' | 'es'): Edition => structuredClone(fixture.editions.find((e) => e.lang === lang)!);

describe('schéma Edition', () => {
  it('valide la fixture réelle du 06/11/2026', () => {
    const r = parseBrief(fixture);
    if (!r.success) throw new Error(r.errors.join('\n'));
    expect(r.data.editions).toHaveLength(3);
  });

  it('exige exactement 5 infos dans le Morning Brief', () => {
    const e = edition('fr');
    e.morningBrief.pop();
    const r = parseEdition(e);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.join()).toMatch(/exactement 5/);
  });

  it('refuse une grille de 3 chiffres', () => {
    const e = edition('fr');
    e.sections[0].stories[0].stats.pop();
    expect(parseEdition(e).success).toBe(false);
  });

  it('accepte une grille vide', () => {
    const e = edition('fr');
    e.sections[0].stories[0].stats = [];
    expect(parseEdition(e).success).toBe(true);
  });

  it('refuse un vocabulaire pour FR et un vocabulaire de 5 mots pour EN', () => {
    const fr = edition('fr');
    fr.vocab = structuredClone(edition('en').vocab);
    expect(parseEdition(fr).success).toBe(false);
    const en = edition('en');
    en.vocab!.items.pop();
    expect(parseEdition(en).success).toBe(false);
  });

  it('refuse une projection inconnue et un code pays non alpha-3', () => {
    const e = edition('fr');
    const v = e.sections[0].stories[0].visual;
    if (v.type !== 'map') throw new Error('la fixture doit commencer par une carte');
    v.map.focus = ['FR'];
    expect(parseEdition(e).success).toBe(false);
    v.map.focus = ['FRA'];
    (v.map as { projection: string }).projection = 'mercator';
    expect(parseEdition(e).success).toBe(false);
  });

  it('refuse un sujet sans source et un id de sujet en double', () => {
    const e = edition('fr');
    e.sections[0].stories[0].sources = [];
    expect(parseEdition(e).success).toBe(false);
    const d = edition('fr');
    d.sections[1].stories[0].id = d.sections[0].stories[0].id;
    expect(parseEdition(d).success).toBe(false);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run packages/schema/test/edition.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../src"`.

- [ ] **Étape 3 : écrire `rubrics.ts` (libellés du §3)**

```ts
export const LANGS = ['fr', 'en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

export const RUBRIC_KEYS = ['pol', 'int', 'eco', 'ent', 'dro', 'tec', 'env', 'cul', 'spo'] as const;
export type RubricKey = (typeof RUBRIC_KEYS)[number];

/** Libellés de la spec §3, identiques dans l'appli, le PDF et le JSON. */
export const RUBRIC_LABELS: Record<Lang, Record<RubricKey, string>> = {
  fr: {
    pol: 'Politique & société',
    int: 'International & géopolitique',
    eco: 'Économie',
    ent: 'Entreprises & management',
    dro: 'Droit & justice',
    tec: 'Tech & IA',
    env: 'Environnement & énergie',
    cul: 'Culture',
    spo: 'Sport',
  },
  en: {
    pol: 'Politics & society',
    int: 'World',
    eco: 'Economy',
    ent: 'Business',
    dro: 'Law',
    tec: 'Tech & AI',
    env: 'Environment',
    cul: 'Culture',
    spo: 'Sport',
  },
  es: {
    pol: 'Política y sociedad',
    int: 'Internacional',
    eco: 'Economía',
    ent: 'Empresas',
    dro: 'Derecho',
    tec: 'Tecnología',
    env: 'Medio ambiente',
    cul: 'Cultura',
    spo: 'Deporte',
  },
};
```

- [ ] **Étape 4 : écrire `edition.ts` (§6.1)**

Choix à respecter : `stats` contient 0 ou 4 éléments ; `morningBrief` exactement 5 ; `vocab` vaut `null` en FR et compte 6 mots en EN et ES ; les codes pays sont en ISO alpha-3 ; un sujet a au moins une source. `PexelsPhoto` n'est pas détaillé dans la spec : il est défini ici et sera rempli au lot 2.

```ts
import { z } from 'zod';
import { LANGS, RUBRIC_KEYS } from './rubrics';

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date AAAA-MM-JJ attendue');
const Url = z.string().url();
const Iso3 = z.string().regex(/^[A-Z]{3}$/, 'code ISO 3166 alpha-3 attendu');

export const LangSchema = z.enum(LANGS);
export const RubricKeySchema = z.enum(RUBRIC_KEYS);

export const SourceRefSchema = z.object({
  outlet: z.string().min(1),
  title: z.string().min(1),
  url: Url,
  lang: z.string().min(2),
  readFull: z.boolean(),
  publishedAt: z.string().optional(),
});

export const PlaceSchema = z.object({
  name: z.string().min(1),
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  label: z.string().optional(),
  value: z.number().optional(),
  primary: z.boolean().optional(),
});

export const MapSpecSchema = z.object({
  projection: z.enum(['conic-france', 'conic-europe', 'conic-spain', 'albers-usa', 'world']),
  focus: z.array(Iso3).optional(),
  highlight: z.array(Iso3).optional(),
  arc: z.tuple([z.string(), z.string()]).optional(),
  bubbles: z.boolean().optional(),
  places: z.array(PlaceSchema),
});

export const PexelsPhotoSchema = z.object({
  id: z.number(),
  src: Url,
  width: z.number(),
  height: z.number(),
  photographer: z.string().min(1),
  photographerUrl: Url,
  pexelsUrl: Url,
  alt: z.string().optional(),
});

export const VisualSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('map'), caption: z.string().min(1), map: MapSpecSchema }),
  z.object({ type: z.literal('photo'), query: z.string().min(1), pexels: PexelsPhotoSchema.optional() }),
]);

export const StatSchema = z.object({ value: z.string().min(1), label: z.string().min(1), sourceUrl: Url });

export const QuoteSchema = z.object({
  text: z.string().min(1),
  speaker: z.string().min(1),
  translation: z.string().min(1).nullable(),
  sourceUrl: Url,
});

const DivergenceSide = z.object({ value: z.string().min(1), by: z.string().min(1) });
export const DivergenceSchema = z.object({ metric: z.string().min(1), a: DivergenceSide, b: DivergenceSide });

export const StoryThreadSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  subtitle: z.string(),
});

export const PrepaSchema = z.object({ subject: z.string().min(1), text: z.string().min(1) });

export const StorySchema = z.object({
  id: z.string().min(1),
  kicker: z.string().min(1),
  date: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  visual: VisualSchema,
  stats: z.array(StatSchema).refine((a) => a.length === 0 || a.length === 4, 'stats : 0 ou 4 chiffres'),
  quote: QuoteSchema.nullable(),
  divergences: z.array(DivergenceSchema),
  thread: StoryThreadSchema.nullable(),
  prepa: PrepaSchema.nullable(),
  sources: z.array(SourceRefSchema).min(1, 'au moins une source'),
});

export const SectionSchema = z.object({
  key: RubricKeySchema,
  title: z.string().min(1),
  stories: z.array(StorySchema),
  briefs: z.array(SourceRefSchema),
});

export const MorningBriefItemSchema = z.object({
  lead: z.string().min(1),
  text: z.string().min(1),
  rubric: z.string().min(1),
  storyId: z.string().optional(),
});

export const VocabItemSchema = z.object({
  term: z.string().min(1),
  pos: z.string().min(1),
  translation: z.string().min(1),
  example: z.string().min(1),
  sourceUrl: Url.optional(),
});

export const VocabSchema = z.object({ title: z.string().min(1), items: z.array(VocabItemSchema) });

export const EditionSchema = z
  .object({
    date: IsoDateSchema,
    lang: LangSchema,
    region: z.string().min(1),
    headline: z.string().min(1),
    morningBrief: z.array(MorningBriefItemSchema).length(5, 'morningBrief : exactement 5 infos (R8)'),
    audioScript: z.string().min(1),
    sections: z.array(SectionSchema),
    vocab: VocabSchema.nullable(),
  })
  .superRefine((ed, ctx) => {
    if (ed.lang === 'fr' && ed.vocab !== null) {
      ctx.addIssue({ code: 'custom', path: ['vocab'], message: 'vocab doit être null pour l’édition FR' });
    }
    if (ed.lang !== 'fr' && (ed.vocab === null || ed.vocab.items.length !== 6)) {
      ctx.addIssue({ code: 'custom', path: ['vocab'], message: 'vocab : exactement 6 mots pour EN et ES (R10)' });
    }
    const keys = ed.sections.map((s) => s.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'rubrique en double' });
    }
    const ids = ed.sections.flatMap((s) => s.stories.map((st) => st.id));
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'id de sujet en double' });
    }
  });

export const BriefSchema = z
  .object({ date: IsoDateSchema, issue: z.string().min(1), editions: z.array(EditionSchema).length(3) })
  .superRefine((b, ctx) => {
    const langs = b.editions.map((e) => e.lang).sort().join(',');
    if (langs !== 'en,es,fr') ctx.addIssue({ code: 'custom', path: ['editions'], message: 'éditions fr, en et es attendues' });
    if (b.editions.some((e) => e.date !== b.date)) ctx.addIssue({ code: 'custom', path: ['editions'], message: 'date d’édition incohérente' });
  });

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type MapSpec = z.infer<typeof MapSpecSchema>;
export type PexelsPhoto = z.infer<typeof PexelsPhotoSchema>;
export type Visual = z.infer<typeof VisualSchema>;
export type Stat = z.infer<typeof StatSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type Divergence = z.infer<typeof DivergenceSchema>;
export type StoryThread = z.infer<typeof StoryThreadSchema>;
export type Prepa = z.infer<typeof PrepaSchema>;
export type Story = z.infer<typeof StorySchema>;
export type Section = z.infer<typeof SectionSchema>;
export type MorningBriefItem = z.infer<typeof MorningBriefItemSchema>;
export type Vocab = z.infer<typeof VocabSchema>;
export type Edition = z.infer<typeof EditionSchema>;
export type Brief = z.infer<typeof BriefSchema>;
```

- [ ] **Étape 5 : écrire `parse.ts` et `index.ts`**

```ts
import type { z } from 'zod';
import { BriefSchema, EditionSchema, type Brief, type Edition } from './edition';

export type ParseResult<T> = { success: true; data: T } | { success: false; errors: string[] };

function run<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const r = schema.safeParse(input);
  if (r.success) return { success: true, data: r.data };
  return {
    success: false,
    errors: r.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(racine)'} : ${i.message}`),
  };
}

export const parseEdition = (input: unknown): ParseResult<Edition> => run(EditionSchema, input);
export const parseBrief = (input: unknown): ParseResult<Brief> => run(BriefSchema, input);
```

`packages/schema/src/index.ts` (la ligne `./raw` sera ajoutée à la tâche 3) :

```ts
export * from './rubrics';
export * from './edition';
export * from './parse';
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run packages/schema/test/edition.test.ts`
Attendu : 7 tests réussis. Si « valide la fixture réelle » échoue, le message liste les chemins fautifs : corrige le schéma, jamais la fixture.

- [ ] **Étape 7 : commit**

```bash
git add packages/schema
git commit -m "feat(schema): types et validateurs Zod des éditions (spec §6.1)"
```

---

### Tâche 3 : schémas de collecte et de contexte, émission du JSON Schema

**Fichiers :**
- Créer : `packages/schema/src/raw.ts`, `packages/schema/scripts/emit-json-schema.ts`, `packages/schema/edition.schema.json` (généré)
- Modifier : `packages/schema/src/index.ts`
- Test : `packages/schema/test/raw.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { ContextSchema, RawCollectionSchema } from '../src';

describe('schémas de collecte et de contexte', () => {
  it('valide une collecte minimale', () => {
    const raw = {
      date: '2026-11-06',
      collectedAt: '2026-11-06T04:20:00Z',
      errors: [{ source: 'webz', message: 'quota' }],
      articles: [
        { id: 'a1', url: 'https://www.pbs.org/x', outlet: 'PBS', title: 'T', description: null, lang: 'en', publishedAt: null, origin: 'thenewsapi', text: 'corps', groupId: 'g1' },
      ],
    };
    expect(RawCollectionSchema.safeParse(raw).success).toBe(true);
    expect(RawCollectionSchema.safeParse({ ...raw, articles: [{ ...raw.articles[0], origin: 'google' }] }).success).toBe(false);
  });

  it('valide un contexte et refuse une langue inconnue', () => {
    const ctx = {
      date: '2026-11-06',
      openThreads: [{ id: 't1', slug: 'midterms-2026', title: 'Midterms 2026', lang: 'en', updatedAt: '2026-11-05' }],
      yesterdayTopics: [{ lang: 'fr', title: 'Grève' }],
    };
    expect(ContextSchema.safeParse(ctx).success).toBe(true);
    expect(ContextSchema.safeParse({ ...ctx, openThreads: [{ ...ctx.openThreads[0], lang: 'de' }] }).success).toBe(false);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run packages/schema/test/raw.test.ts`
Attendu : ÉCHEC, `TypeError: Cannot read properties of undefined (reading 'safeParse')`, car `raw.ts` n'existe pas encore.

- [ ] **Étape 3 : écrire `raw.ts`**

```ts
import { z } from 'zod';
import { IsoDateSchema, LangSchema } from './edition';

/** Un article collecté (lot 3). `text` n'est rempli que pour les domaines au statut `full` (R1). */
export const RawArticleSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  outlet: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  lang: z.string().min(2),
  publishedAt: z.string().nullable(),
  origin: z.enum(['thenewsapi', 'exa', 'webz', 'rss', 'newsletter']),
  text: z.string().nullable(),
  groupId: z.string().optional(),
});

export const RawCollectionSchema = z.object({
  date: IsoDateSchema,
  collectedAt: z.string(),
  articles: z.array(RawArticleSchema),
  errors: z.array(z.object({ source: z.string(), message: z.string() })),
});

export const OpenThreadSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  lang: LangSchema,
  updatedAt: z.string(),
});

/** Sortie de `brief:context` : Threads ouverts et sujets de la veille. */
export const ContextSchema = z.object({
  date: IsoDateSchema,
  openThreads: z.array(OpenThreadSchema),
  yesterdayTopics: z.array(z.object({ lang: LangSchema, title: z.string() })),
});

export type RawArticle = z.infer<typeof RawArticleSchema>;
export type RawCollection = z.infer<typeof RawCollectionSchema>;
export type OpenThread = z.infer<typeof OpenThreadSchema>;
export type Context = z.infer<typeof ContextSchema>;
```

- [ ] **Étape 4 : exporter `raw.ts`**

Remplacer `packages/schema/src/index.ts` par :

```ts
export * from './rubrics';
export * from './edition';
export * from './raw';
export * from './parse';
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run packages/schema`
Attendu : 9 tests réussis.

- [ ] **Étape 6 : écrire le script d'émission du JSON Schema**

Les `superRefine` (vocab selon la langue, unicité des ids) ne sont pas exprimables en JSON Schema. `unrepresentable: 'any'` les ignore, et `brief:verify` les vérifie de toute façon.

```ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { EditionSchema } from '../src/edition';

const target = fileURLToPath(new URL('../edition.schema.json', import.meta.url));
const schema = z.toJSONSchema(EditionSchema, { unrepresentable: 'any' });
writeFileSync(target, JSON.stringify(schema, null, 2) + '\n');
console.log(`JSON Schema écrit dans ${target}`);
```

- [ ] **Étape 7 : générer le fichier**

Commande : `npm run schema:emit && head -5 packages/schema/edition.schema.json`
Attendu : `JSON Schema écrit dans …/edition.schema.json`, puis un fichier qui commence par `"$schema": "https://json-schema.org/draft/2020-12/schema"`.

- [ ] **Étape 8 : commit**

```bash
git add packages/schema
git commit -m "feat(schema): RawCollection, Context et JSON Schema des éditions"
```

---

### Tâche 4 : utilitaires d'URL et date de Paris

**Fichiers :**
- Créer : `pipeline/lib/url.ts`, `pipeline/lib/date.ts`
- Test : `pipeline/test/lib/url.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { parisToday } from '../../lib/date';
import { hostOf, normalizeUrl, outletKey } from '../../lib/url';

describe('normalizeUrl', () => {
  it('retire www, fragment, paramètres de suivi et / final', () => {
    expect(normalizeUrl('https://WWW.Example.com/a/b/?utm_source=x&id=3#top')).toBe('https://example.com/a/b/?id=3');
    expect(normalizeUrl('https://www.cbsnews.com/news/x/')).toBe('https://cbsnews.com/news/x');
  });
});

describe('outletKey', () => {
  it('ramène les sous-domaines au domaine enregistrable', () => {
    expect(outletKey('https://fr.euronews.com/2026/x')).toBe('euronews.com');
    expect(outletKey('https://www.euronews.com/x')).toBe('euronews.com');
    expect(outletKey('https://news.bbc.co.uk/x')).toBe('bbc.co.uk');
    expect(outletKey('https://www.exteriores.gob.es/x')).toBe('exteriores.gob.es');
    expect(hostOf('https://www.npr.org/x')).toBe('npr.org');
  });
});

describe('parisToday', () => {
  it('donne la date de Paris, pas celle d’UTC', () => {
    expect(parisToday(new Date('2026-11-05T23:30:00Z'))).toBe('2026-11-06');
    expect(parisToday(new Date('2026-11-06T04:13:00Z'))).toBe('2026-11-06');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/lib/url.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../lib/date"`.

- [ ] **Étape 3 : écrire `url.ts`**

```ts
const TRACKING = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid)$/;

/** Forme canonique d'une URL : sans fragment, sans `www.`, sans paramètres de suivi, sans `/` final. */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  const s = u.toString();
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

export function hostOf(raw: string): string {
  return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
}

/** Clé « média » d'une URL : domaine enregistrable (fr.euronews.com → euronews.com, news.bbc.co.uk → bbc.co.uk). */
export function outletKey(raw: string): string {
  const parts = hostOf(raw).split('.');
  const n = parts.length;
  const secondLevel = ['co', 'com', 'gob', 'gov', 'org', 'ac', 'net'];
  if (n >= 3 && parts[n - 1].length === 2 && secondLevel.includes(parts[n - 2])) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}
```

- [ ] **Étape 4 : écrire `date.ts`**

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
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run pipeline/test/lib/url.test.ts`
Attendu : 3 tests réussis.

- [ ] **Étape 6 : commit**

```bash
git add pipeline/lib pipeline/test/lib/url.test.ts
git commit -m "feat(pipeline): normalisation d'URL, clé média et date de Paris"
```

---

### Tâche 5 : liste blanche (R1) et aides de test

**Fichiers :**
- Créer : `pipeline/config/whitelist.json`, `pipeline/lib/whitelist.ts`, `pipeline/test/helpers.ts`
- Test : `pipeline/test/lib/whitelist.test.ts`

La liste reprend le tableau du §4.2 : `full` = texte intégral lisible, `feed` = flux lisible mais articles à vérifier (pas de texte intégral), `meta` = bloqué. `euronews.com` couvre `fr.`, `es.`, `en.` et `www.`. Les médias de la fixture absents du §4.2 sont ajoutés en `meta` avec leur pays, pour R2. Infobae est noté `AR` (voir la feuille de route, point 1).

- [ ] **Étape 1 : écrire les aides de test**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Brief, Edition, Lang } from '@daily-brief/schema';

export const repoPath = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

export const WHITELIST_PATH = repoPath('pipeline/config/whitelist.json');
export const PROGRAMME_PATH = repoPath('pipeline/editorial/programme-ect.md');

export function fixtureBrief(): Brief {
  return JSON.parse(readFileSync(repoPath('fixtures/brief-2026-11-06.json'), 'utf8'));
}

export function fixtureEdition(lang: Lang): Edition {
  return structuredClone(fixtureBrief().editions.find((e) => e.lang === lang)!);
}

export function sourceText(file: string): string {
  return readFileSync(repoPath(`fixtures/sources/${file}`), 'utf8');
}

/** Articles `{ url, text }` construits à partir de fixtures/sources/index.json. */
export function fixtureArticles(): { url: string; text: string }[] {
  const index: { url: string; file: string }[] = JSON.parse(readFileSync(repoPath('fixtures/sources/index.json'), 'utf8'));
  return index.map((e) => ({ url: e.url, text: sourceText(e.file) }));
}
```

- [ ] **Étape 2 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { canReadFull, loadWhitelist, lookupDomain } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);

describe('liste blanche (R1)', () => {
  it('autorise le texte intégral des domaines « full », sous-domaines compris', () => {
    expect(canReadFull(wl, 'https://fr.euronews.com/2026/11/06/x')).toBe(true);
    expect(canReadFull(wl, 'https://www.sudradio.fr/societe/x')).toBe(true);
    expect(canReadFull(wl, 'https://www.pbs.org/newshour/x')).toBe(true);
  });

  it('refuse les domaines « feed », « meta » et inconnus', () => {
    expect(canReadFull(wl, 'https://www.npr.org/x')).toBe(false);
    expect(canReadFull(wl, 'https://news.sky.com/story/x')).toBe(false);
    expect(canReadFull(wl, 'https://www.lemonde.fr/x')).toBe(false);
    expect(canReadFull(wl, 'https://www.bbc.co.uk/news/x')).toBe(false);
    expect(canReadFull(wl, 'https://inconnu.example/x')).toBe(false);
  });

  it('choisit l’entrée la plus spécifique', () => {
    expect(lookupDomain(wl, 'https://news.sky.com/x')?.status).toBe('feed');
    expect(lookupDomain(wl, 'https://www.infobae.com/x')?.country).toBe('AR');
  });
});
```

- [ ] **Étape 3 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/lib/whitelist.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../lib/whitelist"`.

- [ ] **Étape 4 : écrire `whitelist.json`**

```json
{
  "checkedAt": "2026-11-06",
  "note": "R1 : seul le statut full autorise l'usage du texte intégral. Revérifier chaque mois. country = pays du média (INT = international), utilisé par R2.",
  "domains": [
    { "domain": "euronews.com", "country": "INT", "status": "full" },
    { "domain": "aljazeera.com", "country": "INT", "status": "full" },
    { "domain": "sudradio.fr", "country": "FR", "status": "full" },
    { "domain": "cbsnews.com", "country": "US", "status": "full" },
    { "domain": "pbs.org", "country": "US", "status": "full" },
    { "domain": "eldiario.es", "country": "ES", "status": "full" },
    { "domain": "elsaltodiario.com", "country": "ES", "status": "full" },
    { "domain": "alicanteplaza.es", "country": "ES", "status": "full" },
    { "domain": "democrata.es", "country": "ES", "status": "full" },
    { "domain": "infobae.com", "country": "AR", "status": "full" },

    { "domain": "npr.org", "country": "US", "status": "feed" },
    { "domain": "thehill.com", "country": "US", "status": "feed" },
    { "domain": "news.sky.com", "country": "GB", "status": "feed" },

    { "domain": "lemonde.fr", "country": "FR", "status": "meta" },
    { "domain": "lefigaro.fr", "country": "FR", "status": "meta" },
    { "domain": "lesechos.fr", "country": "FR", "status": "meta" },
    { "domain": "liberation.fr", "country": "FR", "status": "meta" },
    { "domain": "lepoint.fr", "country": "FR", "status": "meta" },
    { "domain": "latribune.fr", "country": "FR", "status": "meta" },
    { "domain": "20minutes.fr", "country": "FR", "status": "meta" },
    { "domain": "ouest-france.fr", "country": "FR", "status": "meta" },
    { "domain": "la-croix.com", "country": "FR", "status": "meta" },
    { "domain": "courrierinternational.com", "country": "FR", "status": "meta" },
    { "domain": "rfi.fr", "country": "FR", "status": "meta" },
    { "domain": "franceinfo.fr", "country": "FR", "status": "meta" },
    { "domain": "france24.com", "country": "FR", "status": "meta" },
    { "domain": "bbc.co.uk", "country": "GB", "status": "meta" },
    { "domain": "bbc.com", "country": "GB", "status": "meta" },
    { "domain": "theguardian.com", "country": "GB", "status": "meta" },
    { "domain": "independent.co.uk", "country": "GB", "status": "meta" },
    { "domain": "inews.co.uk", "country": "GB", "status": "meta" },
    { "domain": "standard.co.uk", "country": "GB", "status": "meta" },
    { "domain": "metro.co.uk", "country": "GB", "status": "meta" },
    { "domain": "apnews.com", "country": "US", "status": "meta" },
    { "domain": "politico.eu", "country": "INT", "status": "meta" },
    { "domain": "elpais.com", "country": "ES", "status": "meta" },
    { "domain": "elmundo.es", "country": "ES", "status": "meta" },
    { "domain": "rtve.es", "country": "ES", "status": "meta" },
    { "domain": "europapress.es", "country": "ES", "status": "meta" },
    { "domain": "20minutos.es", "country": "ES", "status": "meta" },
    { "domain": "elconfidencial.com", "country": "ES", "status": "meta" },
    { "domain": "dw.com", "country": "INT", "status": "meta" },
    { "domain": "news.google.com", "country": "INT", "status": "meta" },
    { "domain": "theconversation.com", "country": "INT", "status": "meta" },

    { "domain": "xataka.com", "country": "ES", "status": "meta" },
    { "domain": "vozpopuli.com", "country": "ES", "status": "meta" },
    { "domain": "articulo14.es", "country": "ES", "status": "meta" },
    { "domain": "rtvc.es", "country": "ES", "status": "meta" },
    { "domain": "yorkshireeveningpost.co.uk", "country": "GB", "status": "meta" }
  ]
}
```

- [ ] **Étape 5 : écrire `whitelist.ts`**

```ts
import { readFileSync } from 'node:fs';
import { hostOf } from './url';

/** full = texte intégral lisible (R1) ; feed = flux lisible, articles à vérifier ; meta = métadonnées seulement. */
export type DomainStatus = 'full' | 'feed' | 'meta';
export type WhitelistEntry = { domain: string; country: string; status: DomainStatus };
export type Whitelist = { checkedAt: string; domains: WhitelistEntry[] };

export function loadWhitelist(path: string): Whitelist {
  return JSON.parse(readFileSync(path, 'utf8')) as Whitelist;
}

/** Entrée la plus spécifique qui couvre l'hôte de l'URL (le domaine lui-même ou un sous-domaine). */
export function lookupDomain(wl: Whitelist, url: string): WhitelistEntry | undefined {
  const h = hostOf(url);
  return wl.domains
    .filter((e) => h === e.domain || h.endsWith('.' + e.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0];
}

export function canReadFull(wl: Whitelist, url: string): boolean {
  return lookupDomain(wl, url)?.status === 'full';
}
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run pipeline/test/lib/whitelist.test.ts`
Attendu : 3 tests réussis.

- [ ] **Étape 7 : commit**

```bash
git add pipeline/config/whitelist.json pipeline/lib/whitelist.ts pipeline/test/helpers.ts pipeline/test/lib/whitelist.test.ts
git commit -m "feat(pipeline): liste blanche R1 avec statut et pays des médias"
```

---

### Tâche 6 : citations (R5), dont le cas PBS / J.D. Vance

**Fichiers :**
- Créer : `fixtures/sources/README.md`, `fixtures/sources/index.json`, `fixtures/sources/sudradio-grogne-sociale.txt`, `fixtures/sources/pbs-vance.txt`, `pipeline/verify/normalize.ts`, `pipeline/verify/quotes.ts`
- Test : `pipeline/test/verify/quotes.test.ts`

Règle implémentée : la citation normalisée doit être une sous-chaîne d'un passage **entre guillemets** de la source. Si elle n'existe qu'hors guillemets, c'est une paraphrase et elle est rejetée. Le nom de famille de l'orateur doit figurer dans le même paragraphe, à moins de 160 caractères du passage. La normalisation (§7, R5) unifie les espaces, les apostrophes et les guillemets typographiques, et ignore la casse.

- [ ] **Étape 1 : écrire les textes sources reconstitués**

`fixtures/sources/README.md` :

```markdown
# Textes sources de test (R5, R6)

Ces extraits sont **reconstitués** à partir de la fixture du 06/11/2026 pour tester les contrôles de citations et de chiffres. Ce ne sont pas les articles originaux. Si les textes réels sont disponibles, remplace le contenu des fichiers sans changer leur nom : les tests doivent rester verts.

- `sudradio-grogne-sociale.txt` : la dépêche AFP reprise par Sud Radio (sujet `2026-11-06-fr-1`). Elle utilise volontairement des apostrophes et guillemets droits, pour tester la normalisation face aux guillemets typographiques de la fixture.
- `pbs-vance.txt` : article PBS où un journaliste **paraphrase** J.D. Vance. La paraphrase présentée comme une citation doit être rejetée (§13 de la spec).

`index.json` associe chaque URL à son fichier, au format `{ url, file }`.
```

`fixtures/sources/index.json` :

```json
[
  {
    "url": "https://www.sudradio.fr/societe/la-grogne-sociale-monte-dun-cran-greve-et-manifestations-partout-en-france",
    "file": "sudradio-grogne-sociale.txt"
  },
  {
    "url": "https://www.pbs.org/newshour/politics/republicans-regroup-after-midterm-losses",
    "file": "pbs-vance.txt"
  }
]
```

`fixtures/sources/sudradio-grogne-sociale.txt` :

```text
La grogne sociale monte d'un cran : grève et manifestations partout en France

Salariés, fonctionnaires, retraités et jeunes ont défilé jeudi dans 193 cortèges à travers la France, selon le ministère de l'Intérieur, qui a recensé 575 000 manifestants, dont 65 000 à Paris. La CGT revendique 1,6 million de participants.

« La question qui est posée aujourd'hui, c'est pas "est-ce qu'on va gagner" mais "combien va-t-on gagner ?" », a lancé Sophie Binet, secrétaire générale de la CGT, en tête du cortège parisien.

Le Premier ministre Sébastien Lecornu a annoncé qu'il réunirait syndicats et patronat lundi 9 novembre pour une conférence sur les salaires et le pouvoir d'achat.
```

`fixtures/sources/pbs-vance.txt` :

```text
Republicans regroup after midterm losses

Republicans spent Wednesday absorbing the scale of their defeat in the House and Senate. Vice President JD Vance told reporters in Columbus that the party would need to listen more closely to working families and rebuild its coalition before 2028.

Senate Republican leader John Thune struck a similar tone. "We had a tough night, no question about it," Thune said, adding that the party would study the results district by district.
```

- [ ] **Étape 2 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeForMatch } from '../../verify/normalize';
import { checkQuote, speakerSurname } from '../../verify/quotes';
import { fixtureEdition, sourceText } from '../helpers';

const sudradio = sourceText('sudradio-grogne-sociale.txt');
const pbs = sourceText('pbs-vance.txt');

describe('normalizeForMatch', () => {
  it('unifie apostrophes, guillemets, espaces insécables et espace avant ponctuation', () => {
    expect(normalizeForMatch('c’est pas “gagner ?”')).toBe(normalizeForMatch('c\'est pas "gagner?"'));
    expect(normalizeForMatch('575 000')).toBe('575 000');
  });
});

describe('speakerSurname', () => {
  it('extrait le nom de famille', () => {
    expect(speakerSurname('Sophie Binet · CGT')).toBe('Binet');
    expect(speakerSurname('J.D. Vance')).toBe('Vance');
    expect(speakerSurname('Aurora Gómez · Tu Nube Seca Mi Río (Espagne)')).toBe('Gómez');
  });
});

describe('checkQuote (R5)', () => {
  it('accepte la citation de Sophie Binet telle qu’écrite dans la fixture', () => {
    const quote = fixtureEdition('fr').sections[0].stories[0].quote!;
    expect(checkQuote(quote, sudradio)).toEqual({ ok: true });
  });

  it('rejette la paraphrase PBS attribuée à J.D. Vance', () => {
    const r = checkQuote(
      { text: 'the party would need to listen more closely to working families', speaker: 'J.D. Vance' },
      pbs,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/paraphrase/);
  });

  it('rejette une vraie citation attribuée au mauvais orateur', () => {
    const r = checkQuote({ text: 'We had a tough night, no question about it', speaker: 'J.D. Vance' }, pbs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Vance/);
  });

  it('accepte la même citation avec le bon orateur', () => {
    expect(checkQuote({ text: 'We had a tough night, no question about it', speaker: 'John Thune · Senate' }, pbs)).toEqual({ ok: true });
  });

  it('rejette une citation retouchée et une source sans texte', () => {
    const touched = checkQuote({ text: 'La question posée aujourd’hui, c’est combien va-t-on gagner', speaker: 'Sophie Binet' }, sudradio);
    expect(touched.ok).toBe(false);
    expect(checkQuote({ text: 'x', speaker: 'y' }, undefined)).toEqual({ ok: false, reason: 'texte source indisponible' });
  });
});
```

- [ ] **Étape 3 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/quotes.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/normalize"`.

- [ ] **Étape 4 : écrire `normalize.ts`**

```ts
const QUOTE_CHARS = /[«»“”„‟"‹›]/g;
const APOSTROPHES = /[’‘ʼ`´]/g;
const DASHES = /[‐-―−]/g;
const SPACES = /\s+/g;

/**
 * Forme de comparaison pour R5 : NFKC (espaces insécables → espace), apostrophes et tirets unifiés,
 * guillemets supprimés, espaces fusionnées, pas d'espace avant la ponctuation, minuscules.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(APOSTROPHES, "'")
    .replace(QUOTE_CHARS, ' ')
    .replace(/…/g, '...')
    .replace(DASHES, '-')
    .replace(SPACES, ' ')
    .replace(/ ([?!:;.,])/g, '$1')
    .trim()
    .toLowerCase();
}
```

- [ ] **Étape 5 : écrire `quotes.ts`**

```ts
import type { Quote } from '@daily-brief/schema';
import { normalizeForMatch } from './normalize';

export type CheckResult = { ok: true } | { ok: false; reason: string };

type Span = { start: number; end: number; inner: string };

const SPAN_PATTERNS = [/«([^«»]+)»/g, /“([^“”]+)”/g, /"([^"]+)"/g, /„([^„“”]+)[“”]/g];
const SPEAKER_WINDOW = 160;

/** Passages entre guillemets du texte source (« », “ ”, " ", „ “). */
export function quotedSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const re of SPAN_PATTERNS) {
    for (const m of text.matchAll(re)) spans.push({ start: m.index!, end: m.index! + m[0].length, inner: m[1] });
  }
  return spans;
}

/** Nom de famille de l'orateur : « Sophie Binet · CGT » → « Binet », « J.D. Vance » → « Vance ». */
export function speakerSurname(speaker: string): string {
  const name = speaker.split('·')[0].replace(/\(.*?\)/g, '').trim();
  const words = name.split(/\s+/).filter((w) => w.length >= 2);
  return words[words.length - 1] ?? name;
}

/** Le nom doit figurer dans le même paragraphe que la citation, à moins de 160 caractères. */
function speakerNear(text: string, span: Span, surname: string): boolean {
  const paraStart = text.lastIndexOf('\n', span.start) + 1;
  const nextBreak = text.indexOf('\n', span.end);
  const paraEnd = nextBreak === -1 ? text.length : nextBreak;
  const from = Math.max(paraStart, span.start - SPEAKER_WINDOW);
  const to = Math.min(paraEnd, span.end + SPEAKER_WINDOW);
  return normalizeForMatch(text.slice(from, to)).includes(normalizeForMatch(surname));
}

/** R5 : citation mot pour mot, entre guillemets dans la source, orateur nommé à côté. */
export function checkQuote(quote: Pick<Quote, 'text' | 'speaker'>, sourceText: string | undefined): CheckResult {
  if (!sourceText) return { ok: false, reason: 'texte source indisponible' };
  const target = normalizeForMatch(quote.text);
  const matching = quotedSpans(sourceText).filter((s) => normalizeForMatch(s.inner).includes(target));
  if (matching.length === 0) {
    return normalizeForMatch(sourceText).includes(target)
      ? { ok: false, reason: 'paraphrase : le passage existe dans la source, mais hors guillemets' }
      : { ok: false, reason: 'citation introuvable mot pour mot dans la source' };
  }
  const surname = speakerSurname(quote.speaker);
  if (!matching.some((s) => speakerNear(sourceText, s, surname))) {
    return { ok: false, reason: `orateur « ${surname} » non nommé à côté de la citation` };
  }
  return { ok: true };
}
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/quotes.test.ts`
Attendu : 7 tests réussis.

- [ ] **Étape 7 : commit**

```bash
git add fixtures/sources pipeline/verify/normalize.ts pipeline/verify/quotes.ts pipeline/test/verify/quotes.test.ts
git commit -m "feat(verify): R5 citations mot pour mot entre guillemets, orateur nommé"
```

---

### Tâche 7 : chiffres clés (R6)

**Fichiers :**
- Créer : `pipeline/verify/numbers.ts`
- Test : `pipeline/test/verify/numbers.test.ts`

Règle implémentée : chaque nombre de la valeur doit apparaître dans la source. Les séparateurs sont tolérés : espace, espace fine, point, virgule, apostrophe. Le nombre ne doit pas être collé à d'autres chiffres (`3 %` ne valide pas `13 %`). Si la valeur porte une unité, l'unité doit suivre le nombre ; les alias couvrent `%`, `Md`, `M`, `m` et `k`, et les autres unités sont comparées sur leurs 3 premières lettres (`nov.` valide `novembre`).

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { checkStat } from '../../verify/numbers';
import { fixtureEdition, sourceText } from '../helpers';

const ok = (value: string, text: string) => checkStat({ value }, text).ok;

describe('checkStat (R6)', () => {
  it('valide les quatre chiffres du sujet fr-1 contre la dépêche Sud Radio', () => {
    const text = sourceText('sudradio-grogne-sociale.txt');
    for (const stat of fixtureEdition('fr').sections[0].stories[0].stats) {
      expect(checkStat(stat, text), stat.value).toEqual({ ok: true });
    }
  });

  it.each([
    ['575 000', 'on compte 575 000 manifestants'],
    ['575 000', 'on compte 575,000 people'],
    ['65 000', 'dont 65.000 à Paris'],
    ['1,6 million', 'about 1.6 million marchers'],
    ['9 nov.', 'lundi 9 novembre'],
    ['+0,7 %', 'une hausse de 0,7 % sur le mois'],
    ['52 %', 'soit 52% des voix'],
    ['−20 %', 'une baisse de 20 pour cent'],
    ['70+', 'au moins 70 personnes évacuées'],
    ['285 mm', 'jusqu’à 285 mm à Conca'],
    ['+1,50 m', 'le Vidourle est monté de 1,50 mètre'],
    ['320 km/h', 'à 320 km/h en pointe'],
    ['176 Md€', '176 milliards d’euros'],
    ['14,6 M', '14,6 millones de pasajeros'],
    ['24.000', 'unos 24 000 empleos'],
    ['2.ª', 'la 2.ª dimisión'],
  ])('trouve « %s » dans « %s »', (value, text) => {
    expect(ok(value, text)).toBe(true);
  });

  it.each([
    ['193', 'des cortèges dans tout le pays'],
    ['3 %', 'une hausse de 13 % du chiffre'],
    ['65 000', 'dont 650 000 au total'],
    ['9 nov.', 'lundi 9 décembre'],
  ])('rejette « %s » absent de « %s »', (value, text) => {
    expect(ok(value, text)).toBe(false);
  });

  it('rejette tout chiffre sans texte source', () => {
    expect(checkStat({ value: '43' }, undefined)).toEqual({ ok: false, reason: 'texte source indisponible' });
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/numbers.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/numbers"`.

- [ ] **Étape 3 : écrire `numbers.ts`**

```ts
import type { Stat } from '@daily-brief/schema';
import { normalizeForMatch } from './normalize';
import type { CheckResult } from './quotes';

const NUMBER = /\d+(?:[\s.,']\d+)*/g;
const SEP = "[\\s.,']?";
const GAP = '[\\s-]*';

const UNIT_ALIASES: Record<string, string> = {
  '%': '(?:%|pour ?cent|per ?cent|por ?ciento)',
  md: '(?:mds?|milliards?|mrds?|bn|billions?|mil millones)',
  mds: '(?:mds?|milliards?|mrds?|bn|billions?|mil millones)',
  bn: '(?:bn|billions?|milliards?|mds?|mil millones)',
  m: '(?:m\\b|mètres?|metros?|meters?|metres?|millions?|millones|mn|mio)',
  k: '(?:k\\b|000|mille|thousand|mil\\b)',
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function unitPattern(unit: string): string {
  const key = unit.toLowerCase();
  return UNIT_ALIASES[key] ?? escapeRegex(key.slice(0, 3));
}

/**
 * Motifs de recherche d'une valeur de chiffre clé (R6) : un motif par nombre,
 * tolérant aux séparateurs (espace, espace fine, point, virgule) et suivi de son unité éventuelle.
 * Renvoie null si la valeur ne contient aucun chiffre.
 */
export function statPatterns(value: string): RegExp[] | null {
  const v = value.normalize('NFKC');
  const patterns: RegExp[] = [];
  for (const m of v.matchAll(NUMBER)) {
    const groups = m[0].split(/[\s.,']/);
    let p = '(?<!\\d)' + groups.join(SEP) + '(?!\\d)';
    const rest = v.slice(m.index! + m[0].length);
    const unit = rest.match(/^[\s-]*(%|[A-Za-zÀ-ÖØ-öø-ÿ]+)/);
    if (unit) p += GAP + unitPattern(unit[1]);
    patterns.push(new RegExp(p, 'iu'));
  }
  return patterns.length ? patterns : null;
}

/** R6 : la valeur figure dans le texte de sa source, aux variantes de format près. */
export function checkStat(stat: Pick<Stat, 'value'>, sourceText: string | undefined): CheckResult {
  if (!sourceText) return { ok: false, reason: 'texte source indisponible' };
  const text = sourceText.normalize('NFKC');
  const patterns = statPatterns(stat.value);
  if (!patterns) {
    return normalizeForMatch(text).includes(normalizeForMatch(stat.value))
      ? { ok: true }
      : { ok: false, reason: `« ${stat.value} » absent de la source` };
  }
  const missing = patterns.find((re) => !re.test(text));
  return missing ? { ok: false, reason: `« ${stat.value} » absent de la source` } : { ok: true };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/numbers.test.ts`
Attendu : 22 tests réussis.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/verify/numbers.ts pipeline/test/verify/numbers.test.ts
git commit -m "feat(verify): R6 chiffres présents dans la source, formats tolérés"
```

---

### Tâche 8 : divergences (R7)

**Fichiers :**
- Créer : `pipeline/verify/divergences.ts`
- Test : `pipeline/test/verify/divergences.test.ts`

Règle implémentée : les deux côtés ont des sources différentes et des valeurs différentes, et sont tous deux chiffrés ou tous deux non chiffrés. Une fois retirés les nombres, les ordres de grandeur, les jours et les mois, il doit rester exactement les mêmes mots : c'est le même périmètre. Ainsi « 130 rames hors Eurostar » et « 160 rames avec Eurostar » sont refusés.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { checkDivergence } from '../../verify/divergences';
import { fixtureBrief } from '../helpers';

const div = (a: string, b: string, byA = 'Autorités', byB = 'CGT') => ({
  metric: 'Mesure',
  a: { value: a, by: byA },
  b: { value: b, by: byB },
});

describe('checkDivergence (R7)', () => {
  it('accepte toutes les divergences de la fixture', () => {
    const all = fixtureBrief().editions.flatMap((e) => e.sections.flatMap((s) => s.stories.flatMap((st) => st.divergences)));
    expect(all.length).toBeGreaterThan(0);
    for (const d of all) expect(checkDivergence(d), d.metric).toEqual({ ok: true });
  });

  it('rejette le contre-exemple des rames avec et hors Eurostar', () => {
    const r = checkDivergence(div('130 rames hors Eurostar', '160 rames avec Eurostar', 'SNCF', 'Alstom'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/périmètres différents/);
  });

  it('rejette valeurs identiques, source identique et valeurs non comparables', () => {
    expect(checkDivergence(div('575 000', '575 000')).ok).toBe(false);
    expect(checkDivergence(div('575 000', '1,6 million', 'CGT', 'cgt')).ok).toBe(false);
    expect(checkDivergence(div('575 000', 'beaucoup')).ok).toBe(false);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/divergences.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/divergences"`.

- [ ] **Étape 3 : écrire `divergences.ts`**

```ts
import type { Divergence } from '@daily-brief/schema';
import { normalizeForMatch } from './normalize';
import type { CheckResult } from './quotes';

/** Mots qui ne changent pas le périmètre d'une mesure : ordres de grandeur, jours et mois (FR, EN, ES). */
const NEUTRAL = new Set(
  (
    'million millions milliard milliards millón millones mil billion billions bn md mds m k ' +
    'de del of the le la les el los ' +
    'lun mar mer jeu ven sam dim lundi mardi mercredi jeudi vendredi samedi dimanche ' +
    'janv janvier févr février fév mars avr avril mai juin juil juillet août sept septembre oct octobre nov novembre déc décembre ' +
    'mon tue wed thu fri sat sun monday tuesday wednesday thursday friday saturday sunday ' +
    'jan january feb february march apr april may june jul july aug august sep september october november dec december ' +
    'mié jue vie sáb lunes martes miércoles jueves viernes sábado domingo ' +
    'ene enero febrero marzo abr abril mayo junio julio ago agosto septiembre octubre noviembre dic diciembre'
  ).split(' '),
);

const hasDigit = (s: string) => /\d/.test(s);

/** Ce qui reste d'une valeur une fois retirés les nombres et les mots neutres : son « périmètre ». */
export function scopeWords(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .split(/[^\p{L}]+/u)
    .filter((w) => w && !NEUTRAL.has(w))
    .join(' ');
}

/** R7 : même mesure, même périmètre, deux sources distinctes, deux valeurs différentes. */
export function checkDivergence(d: Divergence): CheckResult {
  if (normalizeForMatch(d.a.by) === normalizeForMatch(d.b.by)) return { ok: false, reason: 'même source des deux côtés' };
  if (normalizeForMatch(d.a.value) === normalizeForMatch(d.b.value)) return { ok: false, reason: 'valeurs identiques' };
  if (hasDigit(d.a.value) !== hasDigit(d.b.value)) return { ok: false, reason: 'valeurs non comparables' };
  const sa = scopeWords(d.a.value);
  const sb = scopeWords(d.b.value);
  if (sa !== sb) return { ok: false, reason: `périmètres différents (« ${sa} » / « ${sb} »)` };
  return { ok: true };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/divergences.test.ts`
Attendu : 3 tests réussis.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/verify/divergences.ts pipeline/test/verify/divergences.test.ts
git commit -m "feat(verify): R7 divergences sur la même mesure et le même périmètre"
```

---

### Tâche 9 : périmètre des éditions (R2)

**Fichiers :**
- Créer : `pipeline/verify/perimeter.ts`
- Test : `pipeline/test/verify/perimeter.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { loadWhitelist } from '../../lib/whitelist';
import { checkPerimeter } from '../../verify/perimeter';
import { WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);
const src = (url: string, lang: string) => ({ outlet: 'X', title: 't', url, lang, readFull: false });

describe('checkPerimeter (R2)', () => {
  it('laisse tout passer en FR', () => {
    expect(checkPerimeter('fr', src('https://www.cbsnews.com/x', 'en'), wl)).toBeNull();
  });

  it('exige la langue de l’édition en EN et ES', () => {
    expect(checkPerimeter('en', src('https://fr.euronews.com/x', 'fr'), wl)).toHaveProperty('remove');
    expect(checkPerimeter('es', src('https://fr.euronews.com/x', 'fr'), wl)).toHaveProperty('remove');
    expect(checkPerimeter('en', src('https://www.cbsnews.com/x', 'en'), wl)).toBeNull();
  });

  it('retire un média non espagnol de l’édition ES', () => {
    expect(checkPerimeter('es', src('https://www.infobae.com/x', 'es'), wl)).toHaveProperty('remove');
    expect(checkPerimeter('es', src('https://www.eldiario.es/x', 'es'), wl)).toBeNull();
    expect(checkPerimeter('es', src('https://www.exteriores.gob.es/x', 'es'), wl)).toBeNull();
  });

  it('signale un média au pays inconnu sans le retirer', () => {
    expect(checkPerimeter('es', src('https://nouveau-media.com/x', 'es'), wl)).toHaveProperty('warn');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/perimeter.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/perimeter"`.

- [ ] **Étape 3 : écrire `perimeter.ts`**

```ts
import type { Lang, SourceRef } from '@daily-brief/schema';
import { hostOf } from '../lib/url';
import { lookupDomain, type Whitelist } from '../lib/whitelist';

export type PerimeterResult = { remove: string } | { warn: string } | null;

/**
 * R2 : l'édition FR accepte toute source ; EN exige des sources en anglais ;
 * ES exige des sources en espagnol publiées par des médias espagnols.
 */
export function checkPerimeter(lang: Lang, src: SourceRef, wl: Whitelist): PerimeterResult {
  if (lang === 'fr') return null;
  if (src.lang !== lang) return { remove: `${src.outlet} : langue « ${src.lang} » hors édition ${lang.toUpperCase()}` };
  if (lang === 'es') {
    const country = lookupDomain(wl, src.url)?.country ?? (hostOf(src.url).endsWith('.es') ? 'ES' : undefined);
    if (country === undefined) return { warn: `${src.outlet} : pays du média inconnu, à ajouter à whitelist.json` };
    if (country !== 'ES') return { remove: `${src.outlet} : média non espagnol (${country})` };
  }
  return null;
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/perimeter.test.ts`
Attendu : 4 tests réussis.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/verify/perimeter.ts pipeline/test/verify/perimeter.test.ts
git commit -m "feat(verify): R2 langue et nationalité des médias par édition"
```

---

### Tâche 10 : liens prépa (R9) et programme ECT

**Fichiers :**
- Créer : `pipeline/editorial/programme-ect.md`, `pipeline/verify/prepa.ts`
- Test : `pipeline/test/verify/prepa.test.ts`

Le contrôle automatique vérifie seulement que la matière existe. Le « vrai rapport » avec le programme relève de la rédaction (lot 7, `PROMPT.md`), qui s'appuie sur les chapitres que Naïm ajoute dans ce fichier.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isKnownPrepaSubject, parseProgrammeSubjects } from '../../verify/prepa';
import { fixtureBrief, PROGRAMME_PATH } from '../helpers';

const subjects = parseProgrammeSubjects(readFileSync(PROGRAMME_PATH, 'utf8'));

describe('matières prépa (R9)', () => {
  it('lit titres et alias', () => {
    expect(subjects.get('cg')).toBe('Culture générale');
    expect(subjects.get('éco')).toBe('Éco-droit');
    expect(subjects.get('anglais lv1')).toBe('Anglais LV1');
  });

  it('reconnaît toutes les matières de la fixture', () => {
    const all = fixtureBrief().editions.flatMap((e) =>
      e.sections.flatMap((s) => s.stories.flatMap((st) => (st.prepa ? [st.prepa.subject] : []))),
    );
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(isKnownPrepaSubject(s, subjects), s).toBe(true);
  });

  it('refuse une matière hors programme', () => {
    expect(isKnownPrepaSubject('Physique', subjects)).toBe(false);
    expect(isKnownPrepaSubject('Anglais LV1 · Physique', subjects)).toBe(false);
    expect(isKnownPrepaSubject(' · ', subjects)).toBe(false);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/prepa.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/prepa"`.

- [ ] **Étape 3 : écrire `programme-ect.md`**

```markdown
# Programme ECT — référence des liens prépa (R9)

`brief:verify` lit ce fichier. Chaque titre `##` est une matière reconnue. La ligne `Alias :` qui suit liste les autres libellés acceptés dans `prepa.subject`, séparés par des virgules. Un lien qui touche deux matières s'écrit avec « · », par exemple `Anglais LV1 · CG`.

Naïm : sous chaque matière, liste tes chapitres de première année. Claude s'en sert pour juger s'il existe un vrai rapport avec l'actualité (R9). Une matière sans chapitre reste reconnue.

## Éco-droit
Alias : Économie, Éco, Droit, Économie-droit

## Management
Alias : Management des organisations

## Culture générale
Alias : CG

## Anglais LV1
Alias : Anglais, LV1

## Espagnol LV2
Alias : Espagnol, LV2
```

- [ ] **Étape 4 : écrire `prepa.ts`**

```ts
/** Lit `programme-ect.md` : renvoie alias en minuscules → matière canonique. */
export function parseProgrammeSubjects(md: string): Map<string, string> {
  const subjects = new Map<string, string>();
  let current: string | null = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = h[1];
      subjects.set(current.toLowerCase(), current);
      continue;
    }
    const a = line.match(/^Alias\s*:\s*(.+)$/i);
    if (a && current) for (const alias of a[1].split(',')) subjects.set(alias.trim().toLowerCase(), current);
  }
  return subjects;
}

/** R9 : chaque partie de « Anglais LV1 · CG » doit être une matière ou un alias connus. */
export function isKnownPrepaSubject(subject: string, subjects: Map<string, string>): boolean {
  const parts = subject.split('·').map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => subjects.has(p));
}
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/prepa.test.ts`
Attendu : 3 tests réussis.

- [ ] **Étape 6 : commit**

```bash
git add pipeline/editorial/programme-ect.md pipeline/verify/prepa.ts pipeline/test/verify/prepa.test.ts
git commit -m "feat(verify): R9 matières du programme ECT"
```

---

### Tâche 11 : visuels (R11)

**Fichiers :**
- Créer : `pipeline/verify/visuals.ts`
- Test : `pipeline/test/verify/visuals.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { arcProblem, photoQueryProblem } from '../../verify/visuals';
import { fixtureEdition } from '../helpers';

describe('photoQueryProblem (R11)', () => {
  it('accepte une requête d’objets ou de lieux', () => {
    expect(photoQueryProblem('high-speed train', ['Sophie Binet · CGT'])).toBeNull();
    expect(photoQueryProblem('car factory', [])).toBeNull();
  });

  it('refuse un nom propre, un nom de personne citée et une requête trop longue', () => {
    expect(photoQueryProblem('Emmanuel Macron', [])).toMatch(/majuscule/);
    expect(photoQueryProblem('binet protest', ['Sophie Binet · CGT'])).toMatch(/binet/);
    expect(photoQueryProblem('a b c d e f', [])).toMatch(/5 mots/);
  });
});

describe('arcProblem', () => {
  it('vérifie que l’arc relie deux lieux de la carte', () => {
    const v = fixtureEdition('fr').sections[1].stories[1].visual;
    if (v.type !== 'map') throw new Error('carte attendue');
    expect(arcProblem(v.map)).toBeNull();
    expect(arcProblem({ ...v.map, arc: ['Madrid', 'Lviv'] })).toMatch(/Lviv/);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/visuals.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/visuals"`.

- [ ] **Étape 3 : écrire `visuals.ts`**

```ts
import type { MapSpec, RubricKey } from '@daily-brief/schema';

/** Requêtes Pexels de repli quand celle de Claude viole R11 : objets ou lieux, jamais de personne. */
export const DEFAULT_PHOTO_QUERY: Record<RubricKey, string> = {
  pol: 'parliament building',
  int: 'world map',
  eco: 'city skyline',
  ent: 'office building',
  dro: 'courthouse',
  tec: 'computer chip',
  env: 'forest',
  cul: 'theater stage',
  spo: 'stadium',
};

/** R11 : la requête ne doit contenir ni nom propre ni nom de personne cité dans l'édition. */
export function photoQueryProblem(query: string, people: string[]): string | null {
  if (/\p{Lu}/u.test(query)) return 'majuscule dans la requête : nom propre suspect';
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 5) return 'requête de plus de 5 mots';
  const names = new Set(
    people.flatMap((p) => p.toLowerCase().split(/[\s·().,]+/)).filter((w) => w.length >= 3),
  );
  const hit = words.find((w) => names.has(w));
  return hit ? `nom de personne dans la requête : ${hit}` : null;
}

/** Les extrémités de l'arc doivent être des lieux de la carte. */
export function arcProblem(map: MapSpec): string | null {
  if (!map.arc) return null;
  const names = new Set(map.places.map((p) => p.name));
  const missing = map.arc.filter((n) => !names.has(n));
  return missing.length ? `arc vers un lieu absent : ${missing.join(', ')}` : null;
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/visuals.test.ts`
Attendu : 3 tests réussis.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/verify/visuals.ts pipeline/test/verify/visuals.test.ts
git commit -m "feat(verify): R11 requêtes photo sans personne, arcs de carte cohérents"
```

---

### Tâche 12 : Threads (R12)

**Fichiers :**
- Créer : `pipeline/verify/threads.ts`
- Test : `pipeline/test/verify/threads.test.ts`

La fermeture des Threads inactifs depuis 21 jours n'est pas faite ici : elle relève de `brief:context` (lot 3), qui écrit la liste des Threads ouverts lue par ce contrôle.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { resolveThread } from '../../verify/threads';

const open = [{ id: 't-1', slug: 'midterms-2026', title: 'Midterms 2026', lang: 'en' as const, updatedAt: '2026-11-05' }];

describe('resolveThread (R12)', () => {
  it('garde un id ouvert et retire un id inconnu', () => {
    expect(resolveThread({ id: 't-1', title: 'Midterms 2026', subtitle: '' }, 'en', open).fix).toBeUndefined();
    const r = resolveThread({ id: 't-9', title: 'X', subtitle: '' }, 'en', open);
    expect(r.thread.id).toBeUndefined();
    expect(r.fix).toMatch(/t-9/);
  });

  it('rattache un titre identique au Thread ouvert de la même langue', () => {
    expect(resolveThread({ title: 'midterms 2026', subtitle: '' }, 'en', open).thread.id).toBe('t-1');
    expect(resolveThread({ title: 'Midterms 2026', subtitle: '' }, 'fr', open).thread.id).toBeUndefined();
  });

  it('laisse un nouveau Thread sans id', () => {
    expect(resolveThread({ title: 'Nouvelle affaire', subtitle: '' }, 'en', open)).toEqual({
      thread: { title: 'Nouvelle affaire', subtitle: '' },
    });
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/threads.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/threads"`.

- [ ] **Étape 3 : écrire `threads.ts`**

```ts
import type { Lang, OpenThread, StoryThread } from '@daily-brief/schema';
import { normalizeForMatch } from './normalize';

export type ThreadResult = { thread: StoryThread; fix?: string };

/**
 * R12 : un id doit désigner un Thread ouvert ; sans id, un titre identique à un Thread ouvert
 * de la même langue y est rattaché ; sinon le sujet crée un nouveau Thread (id absent).
 */
export function resolveThread(thread: StoryThread, lang: Lang, open: OpenThread[]): ThreadResult {
  if (thread.id) {
    if (open.some((t) => t.id === thread.id)) return { thread };
    const { id, ...rest } = thread;
    return { thread: rest, fix: `Thread ${id} inconnu ou fermé : traité comme nouveau Thread` };
  }
  const match = open.find((t) => t.lang === lang && normalizeForMatch(t.title) === normalizeForMatch(thread.title));
  if (match) return { thread: { ...thread, id: match.id }, fix: `rattaché au Thread ouvert « ${match.title} »` };
  return { thread };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/threads.test.ts`
Attendu : 3 tests réussis.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/verify/threads.ts pipeline/test/verify/threads.test.ts
git commit -m "feat(verify): R12 rattachement aux Threads ouverts"
```

---

### Tâche 13 : vocabulaire (R10)

**Fichiers :**
- Créer : `pipeline/verify/vocab.ts`
- Test : `pipeline/test/verify/vocab.test.ts`

Le nombre de mots (6) est garanti par le schéma. Ce module ajoute seulement un avertissement quand le mot n'apparaît pas dans sa phrase exemple.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { vocabWarnings } from '../../verify/vocab';
import { fixtureEdition } from '../helpers';

describe('vocabWarnings (R10)', () => {
  it('ne signale rien sur les vocabulaires de la fixture', () => {
    expect(vocabWarnings(fixtureEdition('en').vocab!)).toEqual([]);
    expect(vocabWarnings(fixtureEdition('es').vocab!)).toEqual([]);
  });

  it('signale un mot absent de sa phrase exemple', () => {
    const vocab = { title: 'T', items: [{ term: 'landslide', pos: 'n.', translation: 'raz-de-marée', example: 'Democrats won big.' }] };
    expect(vocabWarnings(vocab)).toEqual(['« landslide » absent de sa phrase exemple']);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/vocab.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/vocab"`.

- [ ] **Étape 3 : écrire `vocab.ts`**

```ts
import type { Vocab } from '@daily-brief/schema';

const stem = (w: string) => w.slice(0, Math.max(4, Math.ceil(w.length * 0.6)));

/**
 * R10 (avertissement) : au moins un mot porteur de la locution (4 lettres ou plus)
 * apparaît dans la phrase exemple, au radical près (« flip » → « flipped », « listas electorales » → « listas »).
 */
export function vocabWarnings(vocab: Vocab): string[] {
  return vocab.items.flatMap((item) => {
    const example = item.example.toLowerCase();
    const words = item.term.toLowerCase().split(/[^\p{L}-]+/u).filter((w) => w.length >= 4);
    const found = words.length === 0 || words.some((w) => example.includes(stem(w)));
    return found ? [] : [`« ${item.term} » absent de sa phrase exemple`];
  });
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/vocab.test.ts`
Attendu : 2 tests réussis.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/verify/vocab.ts pipeline/test/verify/vocab.test.ts
git commit -m "feat(verify): R10 avertissement mot absent de l'exemple"
```

---

### Tâche 14 : index des textes lus

**Fichiers :**
- Créer : `pipeline/verify/sources.ts`
- Test : `pipeline/test/verify/sources.test.ts`

Les textes du jour viennent de `raw.json` (articles en texte intégral, uniquement pour les domaines `full`) et de `newsletters/*.md`. Une URL citée dans une newsletter compte comme lue (R1). Le texte de la newsletter sert alors de texte source pour R5 et R6.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSourceTexts, loadSourceTexts } from '../../verify/sources';

describe('textes sources', () => {
  it('indexe les articles par URL normalisée et ignore ceux sans texte', () => {
    const t = buildSourceTexts(
      [
        { url: 'https://www.pbs.org/a/?utm_source=x', text: 'texte PBS' },
        { url: 'https://www.npr.org/b', text: null },
      ],
      [],
    );
    expect(t.textFor('https://pbs.org/a')).toBe('texte PBS');
    expect(t.textFor('https://www.npr.org/b')).toBeUndefined();
  });

  it('compte comme lue une URL citée dans une newsletter', () => {
    const t = buildSourceTexts([], ['Lire : https://www.lemonde.fr/politique/article/x.html. Fin.']);
    expect(t.inNewsletter('https://lemonde.fr/politique/article/x.html')).toBe(true);
    expect(t.textFor('https://www.lemonde.fr/politique/article/x.html')).toMatch(/Lire/);
    expect(t.inNewsletter('https://www.lemonde.fr/autre')).toBe(false);
  });

  it('charge raw.json et newsletters/*.md, et tolère leur absence', () => {
    const day = mkdtempSync(join(tmpdir(), 'day-'));
    expect(loadSourceTexts(day).textFor('https://x.fr/a')).toBeUndefined();
    mkdirSync(join(day, 'newsletters'));
    writeFileSync(join(day, 'newsletters', 'matin.md'), 'Voir https://x.fr/a');
    writeFileSync(
      join(day, 'raw.json'),
      JSON.stringify({
        date: '2026-11-06',
        collectedAt: '2026-11-06T04:20:00Z',
        errors: [],
        articles: [{ id: '1', url: 'https://y.fr/b', outlet: 'Y', title: 'T', description: null, lang: 'fr', publishedAt: null, origin: 'rss', text: 'texte Y' }],
      }),
    );
    const t = loadSourceTexts(day);
    expect(t.inNewsletter('https://x.fr/a')).toBe(true);
    expect(t.textFor('https://y.fr/b')).toBe('texte Y');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/sources.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/sources"`.

- [ ] **Étape 3 : écrire `sources.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RawCollectionSchema } from '@daily-brief/schema';
import { normalizeUrl } from '../lib/url';

/** Textes lus du jour, indexés par URL : articles en texte intégral (R1) et newsletters. */
export interface SourceTexts {
  textFor(url: string): string | undefined;
  /** Vrai si l'URL est citée dans une newsletter du jour : son texte compte alors comme lu (R1). */
  inNewsletter(url: string): boolean;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>()\[\]"']+/g;

function safeNormalize(url: string): string | null {
  try {
    return normalizeUrl(url.replace(/[.,;:]+$/, ''));
  } catch {
    return null;
  }
}

export function buildSourceTexts(articles: { url: string; text: string | null }[], newsletters: string[]): SourceTexts {
  const byUrl = new Map<string, string[]>();
  const add = (url: string | null, text: string) => {
    if (!url) return;
    byUrl.set(url, [...(byUrl.get(url) ?? []), text]);
  };
  for (const a of articles) if (a.text) add(safeNormalize(a.url), a.text);
  const newsletterUrls = new Set<string>();
  for (const nl of newsletters) {
    for (const m of nl.matchAll(URL_IN_TEXT)) {
      const u = safeNormalize(m[0]);
      if (u && !newsletterUrls.has(u)) {
        newsletterUrls.add(u);
        add(u, nl);
      }
    }
  }
  return {
    textFor: (url) => {
      const texts = byUrl.get(safeNormalize(url) ?? '');
      return texts ? texts.join('\n\n') : undefined;
    },
    inNewsletter: (url) => newsletterUrls.has(safeNormalize(url) ?? ''),
  };
}

/** Charge `raw.json` et `newsletters/*.md` d'un dossier du jour ; les fichiers absents comptent pour vide. */
export function loadSourceTexts(dayDir: string): SourceTexts {
  const rawPath = join(dayDir, 'raw.json');
  const articles = existsSync(rawPath)
    ? RawCollectionSchema.parse(JSON.parse(readFileSync(rawPath, 'utf8'))).articles
    : [];
  const nlDir = join(dayDir, 'newsletters');
  const newsletters = existsSync(nlDir)
    ? readdirSync(nlDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => readFileSync(join(nlDir, f), 'utf8'))
    : [];
  return buildSourceTexts(articles, newsletters);
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/sources.test.ts`
Attendu : 3 tests réussis.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/verify/sources.ts pipeline/test/verify/sources.test.ts
git commit -m "feat(verify): index des textes lus (collecte et newsletters)"
```

---

### Tâche 15 : orchestrateur `verifyEdition` (R1–R12, diversité R3, Morning Brief R8)

**Fichiers :**
- Créer : `pipeline/verify/issues.ts`, `pipeline/verify/diversity.ts`, `pipeline/verify/verify-edition.ts`
- Test : `pipeline/test/verify/verify-edition.test.ts`

Ordre des contrôles pour chaque sujet : R2 (sources hors périmètre retirées ; sujet retiré s'il n'en reste aucune), R1 (`readFull` repassé à faux hors liste blanche et hors newsletter), R4 (rétrogradé en brève s'il ne reste aucune source lue), R5, R6 (toute la grille retirée si un chiffre échoue, puisqu'il en faut 0 ou 4), R7, R9, R11, R12, puis l'avertissement R3. Au niveau de l'édition : libellés officiels des rubriques, retrait des rubriques vides, `storyId` du Morning Brief qui ne désigne plus rien (R8), équilibre du Morning Brief (R8), part de chaque média (R3) et vocabulaire (R10).

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadWhitelist } from '../../lib/whitelist';
import { parseProgrammeSubjects } from '../../verify/prepa';
import { buildSourceTexts } from '../../verify/sources';
import { verifyEdition, type VerifyContext } from '../../verify/verify-edition';
import { fixtureArticles, fixtureEdition, PROGRAMME_PATH, WHITELIST_PATH } from '../helpers';

const ctx: VerifyContext = {
  texts: buildSourceTexts(fixtureArticles(), []),
  whitelist: loadWhitelist(WHITELIST_PATH),
  prepaSubjects: parseProgrammeSubjects(readFileSync(PROGRAMME_PATH, 'utf8')),
  openThreads: [],
};

describe('verifyEdition', () => {
  it('renvoie une erreur de schéma sans édition', () => {
    const e = fixtureEdition('fr');
    e.morningBrief = [];
    const r = verifyEdition(e, ctx);
    expect(r.edition).toBeNull();
    expect(r.issues[0]).toMatchObject({ rule: 'SCHEMA', level: 'error' });
  });

  it('garde la citation et les chiffres vérifiés du sujet fr-1', () => {
    const r = verifyEdition(fixtureEdition('fr'), ctx);
    const story = r.edition!.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-1')!;
    expect(story.quote?.speaker).toBe('Sophie Binet · CGT');
    expect(story.stats).toHaveLength(4);
    expect(story.divergences).toHaveLength(2);
  });

  it('retire citation et chiffres invérifiables, sans retirer le sujet', () => {
    const r = verifyEdition(fixtureEdition('fr'), ctx);
    const fr3 = r.edition!.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-3')!;
    expect(fr3.quote).toBeNull();
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R5', storyId: '2026-11-06-fr-3', level: 'fixed' }));
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R6', storyId: '2026-11-06-fr-2', level: 'fixed' }));
  });

  it('rétrograde en brève un sujet dont la seule source lue est hors liste blanche (R1 puis R4)', () => {
    const e = fixtureEdition('fr');
    const eco = e.sections.find((s) => s.key === 'eco')!;
    eco.stories[0].sources = [{ outlet: 'Le Monde', title: 'Titre Le Monde', url: 'https://www.lemonde.fr/eco/x', lang: 'fr', readFull: true }];
    const r = verifyEdition(e, ctx);
    const out = r.edition!.sections.find((s) => s.key === 'eco')!;
    expect(out.stories).toHaveLength(0);
    expect(out.briefs).toContainEqual(expect.objectContaining({ url: 'https://www.lemonde.fr/eco/x', readFull: false }));
    expect(r.issues.map((i) => i.rule)).toEqual(expect.arrayContaining(['R1', 'R4']));
  });

  it('retire les brèves Infobae de l’édition ES (R2)', () => {
    const r = verifyEdition(fixtureEdition('es'), ctx);
    const urls = r.edition!.sections.flatMap((s) => [...s.briefs, ...s.stories.flatMap((st) => st.sources)]).map((s) => s.url);
    expect(urls.some((u) => u.includes('infobae.com'))).toBe(false);
    expect(r.issues.filter((i) => i.rule === 'R2' && i.level === 'fixed').length).toBeGreaterThan(0);
  });

  it('remplace une requête photo qui nomme une personne (R11)', () => {
    const e = fixtureEdition('fr');
    const eco = e.sections.find((s) => s.key === 'eco')!;
    eco.stories[0].visual = { type: 'photo', query: 'binet speech' };
    const r = verifyEdition(e, ctx);
    const v = r.edition!.sections.find((s) => s.key === 'eco')!.stories[0].visual;
    expect(v).toEqual({ type: 'photo', query: 'city skyline' });
  });

  it('remet les libellés officiels des rubriques et retire les rubriques vides', () => {
    const e = fixtureEdition('fr');
    e.sections[0].title = 'Politique';
    e.sections.find((s) => s.key === 'dro')!.briefs = [];
    const r = verifyEdition(e, ctx);
    expect(r.edition!.sections[0].title).toBe('Politique & société');
    expect(r.edition!.sections.some((s) => s.key === 'dro')).toBe(false);
  });

  it('ne modifie pas l’objet reçu', () => {
    const e = fixtureEdition('fr');
    const before = JSON.stringify(e);
    verifyEdition(e, ctx);
    expect(JSON.stringify(e)).toBe(before);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/verify-edition.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/verify-edition"`.

- [ ] **Étape 3 : écrire `issues.ts`**

```ts
import type { Lang } from '@daily-brief/schema';

export type Rule = 'SCHEMA' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12';

/**
 * error   : l'édition ne peut pas être contrôlée (schéma invalide, fichier manquant) ;
 * fixed   : une violation a été corrigée automatiquement (élément retiré, sujet rétrogradé) ;
 * warning : signalement sans correction (objectif non atteint, à améliorer à la rédaction).
 */
export type Issue = { rule: Rule; level: 'error' | 'fixed' | 'warning'; lang?: Lang; storyId?: string; message: string };

/** 0 = propre (avertissements seulement), 1 = corrections appliquées, 2 = au moins une erreur. */
export function exitCodeFor(issues: Issue[]): 0 | 1 | 2 {
  if (issues.some((i) => i.level === 'error')) return 2;
  if (issues.some((i) => i.level === 'fixed')) return 1;
  return 0;
}

export function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return 'Aucun problème.';
  return issues
    .map((i) => `[${i.level}] ${i.rule}${i.lang ? ' ' + i.lang.toUpperCase() : ''}${i.storyId ? ' ' + i.storyId : ''} : ${i.message}`)
    .join('\n');
}
```

- [ ] **Étape 4 : écrire `diversity.ts`**

```ts
import type { Edition, SourceRef, Story } from '@daily-brief/schema';
import { outletKey } from '../lib/url';

export const MAX_OUTLET_SHARE = 0.3;

export function storyOutletCount(story: Story): number {
  return new Set(story.sources.map((s) => outletKey(s.url))).size;
}

/** Part de chaque média (domaine enregistrable) dans toutes les sources de l'édition, sujets et brèves. */
export function outletShares(ed: Edition): { outlet: string; share: number }[] {
  const all: SourceRef[] = ed.sections.flatMap((s) => [...s.stories.flatMap((st) => st.sources), ...s.briefs]);
  const counts = new Map<string, number>();
  for (const s of all) counts.set(outletKey(s.url), (counts.get(outletKey(s.url)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([outlet, n]) => ({ outlet, share: n / all.length }))
    .sort((a, b) => b.share - a.share);
}
```

- [ ] **Étape 5 : écrire `verify-edition.ts`**

```ts
import {
  parseEdition,
  RUBRIC_LABELS,
  type Edition,
  type OpenThread,
  type Section,
  type SourceRef,
  type Story,
} from '@daily-brief/schema';
import { normalizeUrl } from '../lib/url';
import { canReadFull, type Whitelist } from '../lib/whitelist';
import { checkDivergence } from './divergences';
import { MAX_OUTLET_SHARE, outletShares, storyOutletCount } from './diversity';
import type { Issue, Rule } from './issues';
import { checkStat } from './numbers';
import { checkPerimeter } from './perimeter';
import { isKnownPrepaSubject } from './prepa';
import { checkQuote } from './quotes';
import type { SourceTexts } from './sources';
import { resolveThread } from './threads';
import { arcProblem, DEFAULT_PHOTO_QUERY, photoQueryProblem } from './visuals';
import { vocabWarnings } from './vocab';

export type VerifyContext = {
  texts: SourceTexts;
  whitelist: Whitelist;
  prepaSubjects: Map<string, string>;
  openThreads: OpenThread[];
};

export type VerifyResult = { edition: Edition | null; issues: Issue[] };

const sameUrl = (a: string, b: string) => normalizeUrl(a) === normalizeUrl(b);

/**
 * Contrôle une édition et renvoie une copie corrigée qui respecte R1–R12.
 * Ne bloque jamais l'édition : seul un schéma invalide renvoie `edition: null`.
 */
export function verifyEdition(input: unknown, ctx: VerifyContext): VerifyResult {
  const parsed = parseEdition(input);
  if (!parsed.success) {
    return { edition: null, issues: parsed.errors.map((message) => ({ rule: 'SCHEMA', level: 'error', message })) };
  }
  const ed = structuredClone(parsed.data);
  const issues: Issue[] = [];
  const fix = (rule: Rule, message: string, storyId?: string) =>
    issues.push({ rule, level: 'fixed', lang: ed.lang, storyId, message });
  const warn = (rule: Rule, message: string, storyId?: string) =>
    issues.push({ rule, level: 'warning', lang: ed.lang, storyId, message });

  const people = ed.sections.flatMap((s) => s.stories.flatMap((st) => (st.quote ? [st.quote.speaker] : [])));

  const keepSource = (src: SourceRef, storyId?: string): boolean => {
    const p = checkPerimeter(ed.lang, src, ctx.whitelist);
    if (p && 'remove' in p) {
      fix('R2', `source retirée : ${p.remove}`, storyId);
      return false;
    }
    if (p && 'warn' in p) warn('R2', p.warn, storyId);
    return true;
  };

  const enforceReadFull = (src: SourceRef, storyId?: string): SourceRef => {
    if (src.readFull && !canReadFull(ctx.whitelist, src.url) && !ctx.texts.inNewsletter(src.url)) {
      fix('R1', `${src.outlet} : domaine hors liste blanche, passé en « titre + lien »`, storyId);
      return { ...src, readFull: false };
    }
    return src;
  };

  /** Renvoie le sujet corrigé, ou une brève s'il est rétrogradé, ou null s'il est retiré. */
  const verifyStory = (input: Story, section: Section): Story | SourceRef | null => {
    const story = structuredClone(input);
    const id = story.id;

    story.sources = story.sources.filter((s) => keepSource(s, id)).map((s) => enforceReadFull(s, id));
    if (story.sources.length === 0) {
      fix('R2', 'sujet retiré : plus aucune source dans le périmètre', id);
      return null;
    }
    if (!story.sources.some((s) => s.readFull)) {
      fix('R4', 'aucune source lue en entier : sujet rétrogradé en brève', id);
      return { ...story.sources[0], readFull: false };
    }

    if (story.quote) {
      const q = story.quote;
      const src = story.sources.find((s) => sameUrl(s.url, q.sourceUrl));
      const verdict = checkQuote(q, ctx.texts.textFor(q.sourceUrl));
      if (!src) {
        fix('R5', 'citation retirée : sa source n’est pas dans les sources du sujet', id);
        story.quote = null;
      } else if (!verdict.ok) {
        fix('R5', `citation retirée : ${verdict.reason}`, id);
        story.quote = null;
      } else if (src.lang !== ed.lang && !q.translation) {
        fix('R5', `citation retirée : en « ${src.lang} » sans traduction`, id);
        story.quote = null;
      } else if (src.lang === ed.lang && q.translation) {
        warn('R5', 'traduction fournie pour une citation déjà dans la langue de l’édition', id);
      }
    }

    if (story.stats.length) {
      const failures = story.stats
        .map((s) => ({ s, r: checkStat(s, ctx.texts.textFor(s.sourceUrl)) }))
        .filter((x) => !x.r.ok);
      if (failures.length) {
        const reasons = [...new Set(failures.map((f) => (f.r.ok ? '' : f.r.reason)))].join(' ; ');
        fix('R6', `grille de chiffres retirée : ${reasons}`, id);
        story.stats = [];
      }
    }

    story.divergences = story.divergences.filter((d) => {
      const r = checkDivergence(d);
      if (!r.ok) fix('R7', `divergence « ${d.metric} » retirée : ${r.reason}`, id);
      return r.ok;
    });

    if (story.prepa && !isKnownPrepaSubject(story.prepa.subject, ctx.prepaSubjects)) {
      fix('R9', `lien prépa retiré : matière « ${story.prepa.subject} » absente de programme-ect.md`, id);
      story.prepa = null;
    }

    if (story.visual.type === 'photo') {
      const problem = photoQueryProblem(story.visual.query, people);
      if (problem) {
        fix('R11', `requête photo remplacée (${problem})`, id);
        story.visual = { type: 'photo', query: DEFAULT_PHOTO_QUERY[section.key] };
      }
    } else {
      const problem = arcProblem(story.visual.map);
      if (problem) {
        fix('R11', `arc retiré : ${problem}`, id);
        delete story.visual.map.arc;
      }
    }

    if (story.thread) {
      const r = resolveThread(story.thread, ed.lang, ctx.openThreads);
      story.thread = r.thread;
      if (r.fix) fix('R12', r.fix, id);
    }

    if (storyOutletCount(story) < 2) warn('R3', 'un seul média pour ce sujet (objectif : au moins deux)', id);
    return story;
  };

  for (const section of ed.sections) {
    section.title = RUBRIC_LABELS[ed.lang][section.key];
    const stories: Story[] = [];
    const briefs: SourceRef[] = section.briefs.filter((b) => keepSource(b)).map((b) => enforceReadFull(b));
    for (const st of section.stories) {
      const out = verifyStory(st, section);
      if (out === null) continue;
      if ('summary' in out) stories.push(out);
      else briefs.push(out);
    }
    section.stories = stories;
    section.briefs = briefs;
  }
  ed.sections = ed.sections.filter((s) => s.stories.length + s.briefs.length > 0);

  const storyIds = new Set(ed.sections.flatMap((s) => s.stories.map((st) => st.id)));
  for (const item of ed.morningBrief) {
    if (item.storyId && !storyIds.has(item.storyId)) {
      fix('R8', `Morning Brief : storyId ${item.storyId} ne désigne plus un sujet`);
      delete item.storyId;
    }
  }
  const perRubric = new Map<string, number>();
  for (const item of ed.morningBrief) perRubric.set(item.rubric, (perRubric.get(item.rubric) ?? 0) + 1);
  for (const [rubric, n] of perRubric) {
    if (n > 2) warn('R8', `Morning Brief déséquilibré : ${n} infos « ${rubric} »`);
  }

  for (const { outlet, share } of outletShares(ed)) {
    if (share > MAX_OUTLET_SHARE) warn('R3', `${outlet} pèse ${Math.round(share * 100)} % des sources (plafond 30 %)`);
  }

  if (ed.vocab) for (const w of vocabWarnings(ed.vocab)) warn('R10', w);

  return { edition: ed, issues };
}
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/verify-edition.test.ts`
Attendu : 8 tests réussis.

- [ ] **Étape 7 : commit**

```bash
git add pipeline/verify/issues.ts pipeline/verify/diversity.ts pipeline/verify/verify-edition.ts pipeline/test/verify/verify-edition.test.ts
git commit -m "feat(verify): orchestrateur R1-R12, l'édition n'est jamais bloquée"
```

---

### Tâche 16 : exécuteur `runVerify` et CLI `npm run brief:verify`

**Fichiers :**
- Créer : `pipeline/verify/run-verify.ts`, `pipeline/verify/cli.ts`
- Test : `pipeline/test/verify/run-verify.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditionSchema } from '@daily-brief/schema';
import { runVerify } from '../../verify/run-verify';
import { fixtureArticles, fixtureBrief, PROGRAMME_PATH, WHITELIST_PATH } from '../helpers';

function setupDay(withEs = true) {
  const outDir = mkdtempSync(join(tmpdir(), 'brief-'));
  const dayDir = join(outDir, '2026-11-06');
  mkdirSync(dayDir, { recursive: true });
  for (const e of fixtureBrief().editions) {
    if (e.lang === 'es' && !withEs) continue;
    writeFileSync(join(dayDir, `${e.lang}.json`), JSON.stringify(e));
  }
  const articles = fixtureArticles().map((a, i) => ({
    id: `a${i}`, url: a.url, outlet: 'X', title: 'T', description: null, lang: 'fr',
    publishedAt: null, origin: 'thenewsapi', text: a.text,
  }));
  writeFileSync(join(dayDir, 'raw.json'), JSON.stringify({ date: '2026-11-06', collectedAt: '2026-11-06T04:20:00Z', articles, errors: [] }));
  return { outDir, dayDir };
}

const opts = (outDir: string) => ({ outDir, date: '2026-11-06', whitelistPath: WHITELIST_PATH, programmePath: PROGRAMME_PATH });

describe('runVerify', () => {
  it('écrit trois éditions vérifiées valides et le rapport', () => {
    const { outDir, dayDir } = setupDay();
    const r = runVerify(opts(outDir));
    expect(r.exitCode).toBe(1);
    for (const lang of ['fr', 'en', 'es']) {
      const ed = JSON.parse(readFileSync(join(dayDir, `${lang}.verified.json`), 'utf8'));
      expect(EditionSchema.safeParse(ed).success).toBe(true);
    }
    const report = JSON.parse(readFileSync(join(dayDir, 'verify-report.json'), 'utf8'));
    expect(report.exitCode).toBe(1);
    expect(report.issues.length).toBe(r.issues.length);
  });

  it('sort en erreur si une édition manque', () => {
    const { outDir } = setupDay(false);
    const r = runVerify(opts(outDir));
    expect(r.exitCode).toBe(2);
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'es', level: 'error' }));
  });

  it('est idempotent : un second passage sur les fichiers vérifiés ne corrige plus rien', () => {
    const { outDir, dayDir } = setupDay();
    runVerify(opts(outDir));
    for (const lang of ['fr', 'en', 'es']) {
      writeFileSync(join(dayDir, `${lang}.json`), readFileSync(join(dayDir, `${lang}.verified.json`)));
    }
    const second = runVerify(opts(outDir));
    expect(second.issues.filter((i) => i.level === 'fixed')).toEqual([]);
    expect(second.exitCode).toBe(0);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/verify/run-verify.test.ts`
Attendu : ÉCHEC, `Failed to resolve import "../../verify/run-verify"`.

- [ ] **Étape 3 : écrire `run-verify.ts`**

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContextSchema, LANGS, type OpenThread } from '@daily-brief/schema';
import { loadWhitelist } from '../lib/whitelist';
import { exitCodeFor, type Issue } from './issues';
import { parseProgrammeSubjects } from './prepa';
import { loadSourceTexts } from './sources';
import { verifyEdition } from './verify-edition';

export type RunVerifyOptions = {
  outDir: string;
  date: string;
  whitelistPath: string;
  programmePath: string;
};

export type RunVerifyResult = { issues: Issue[]; exitCode: 0 | 1 | 2; written: string[] };

/**
 * Contrôle `out/<date>/{fr,en,es}.json` et écrit `{lang}.verified.json` et `verify-report.json`.
 * Le contexte (`context.json`), la collecte (`raw.json`) et les newsletters sont facultatifs.
 */
export function runVerify(opts: RunVerifyOptions): RunVerifyResult {
  const dayDir = join(opts.outDir, opts.date);
  const contextPath = join(dayDir, 'context.json');
  const openThreads: OpenThread[] = existsSync(contextPath)
    ? ContextSchema.parse(JSON.parse(readFileSync(contextPath, 'utf8'))).openThreads
    : [];
  const ctx = {
    texts: loadSourceTexts(dayDir),
    whitelist: loadWhitelist(opts.whitelistPath),
    prepaSubjects: parseProgrammeSubjects(readFileSync(opts.programmePath, 'utf8')),
    openThreads,
  };

  const issues: Issue[] = [];
  const written: string[] = [];
  for (const lang of LANGS) {
    const path = join(dayDir, `${lang}.json`);
    if (!existsSync(path)) {
      issues.push({ rule: 'SCHEMA', level: 'error', lang, message: `${lang}.json manquant` });
      continue;
    }
    let input: unknown;
    try {
      input = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      issues.push({ rule: 'SCHEMA', level: 'error', lang, message: `JSON illisible : ${(e as Error).message}` });
      continue;
    }
    const r = verifyEdition(input, ctx);
    issues.push(...r.issues.map((i) => ({ ...i, lang })));
    if (r.edition) {
      const out = join(dayDir, `${lang}.verified.json`);
      writeFileSync(out, JSON.stringify(r.edition, null, 2) + '\n');
      written.push(out);
    }
  }
  const exitCode = exitCodeFor(issues);
  const report = join(dayDir, 'verify-report.json');
  writeFileSync(report, JSON.stringify({ date: opts.date, generatedAt: new Date().toISOString(), exitCode, issues }, null, 2) + '\n');
  written.push(report);
  return { issues, exitCode, written };
}
```

- [ ] **Étape 4 : écrire `cli.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parisToday } from '../lib/date';
import { formatIssues } from './issues';
import { runVerify } from './run-verify';

const { values } = parseArgs({
  options: {
    date: { type: 'string' },
    out: { type: 'string', default: 'out' },
  },
});

const date = values.date ?? parisToday();
const { issues, exitCode } = runVerify({
  outDir: values.out!,
  date,
  whitelistPath: fileURLToPath(new URL('../config/whitelist.json', import.meta.url)),
  programmePath: fileURLToPath(new URL('../editorial/programme-ect.md', import.meta.url)),
});

console.log(`brief:verify ${date}`);
console.log(formatIssues(issues));
console.log(
  exitCode === 0
    ? 'OK : aucune violation.'
    : exitCode === 1
      ? 'Corrections appliquées dans *.verified.json : corrige les fichiers sources puis relance.'
      : 'Erreur : au moins une édition est invalide (schéma ou fichier manquant).',
);
process.exit(exitCode);
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run pipeline/test/verify/run-verify.test.ts`
Attendu : 3 tests réussis.

- [ ] **Étape 6 : essai manuel du CLI sur la fixture**

```bash
mkdir -p out/2026-11-06 && node -e "const b=require('./fixtures/brief-2026-11-06.json');for(const e of b.editions)require('fs').writeFileSync('out/2026-11-06/'+e.lang+'.json',JSON.stringify(e,null,2))"
```

```bash
npm run brief:verify -- --date 2026-11-06; echo "exit=$?"
```

Attendu : une liste de problèmes `[fixed]` et `[warning]`, puis `exit=1`. Sans `raw.json`, toutes les citations et grilles de chiffres sont retirées pour « texte source indisponible ». On doit voir en particulier :
- `[fixed] R2 ES : source retirée : Euronews : langue « fr » hors édition ES` (vraie anomalie de la fixture : brève Euronews en français dans l'édition ES) ;
- deux lignes `[fixed] R2 ES : source retirée : Infobae : média non espagnol (AR)` ;
- `[warning] R8 EN : Morning Brief déséquilibré : 3 infos « Politics »`.

Les fichiers `out/2026-11-06/{fr,en,es}.verified.json` et `verify-report.json` existent. Ensuite, supprimer le dossier d'essai : `rm -rf out` (il est ignoré par git de toute façon).

- [ ] **Étape 7 : commit**

```bash
git add pipeline/verify/run-verify.ts pipeline/verify/cli.ts pipeline/test/verify/run-verify.test.ts
git commit -m "feat(verify): CLI brief:verify (fichiers .verified.json et rapport)"
```

---

### Tâche 17 : vérification finale et README

**Fichiers :**
- Modifier : `README.md` (ajouter une section en fin de fichier)

- [ ] **Étape 1 : lancer toute la suite et le typage**

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  15 passed (15)`, `Tests  76 passed (76)`, puis `tsc` sans sortie.

- [ ] **Étape 2 : ajouter la section « Développement » à la fin de `README.md`**

````markdown

## Développement

Prérequis : Node 22.

```bash
npm install
npm test               # tests unitaires (Vitest)
npm run typecheck      # TypeScript strict
npm run schema:emit    # régénère packages/schema/edition.schema.json
npm run brief:verify -- --date AAAA-MM-JJ [--out out]
```

`brief:verify` contrôle `out/<date>/{fr,en,es}.json` selon les règles R1 à R12 de la spec. Il écrit `{lang}.verified.json` (toujours conforme) et `verify-report.json`. Code de sortie : 0 si propre, 1 si des corrections ont été appliquées, 2 si une édition est invalide.

Plans d'implémentation : `docs/superpowers/plans/`.
````

- [ ] **Étape 3 : commit**

```bash
git add README.md
git commit -m "docs: commandes de développement du lot 1"
```

---

## Couverture du lot (auto-revue)

| Exigence | Tâche |
|---|---|
| §5 structure `packages/schema`, `pipeline/verify`, `pipeline/config` | 1, 2, 5, 15 |
| §6.1 types et JSON Schema, validation de la fixture | 2, 3 |
| R1 liste blanche, newsletters | 5, 14, 15 |
| R2 périmètre | 9, 15 |
| R3 diversité (avertissements) | 15 |
| R4 rétrogradation en brève, libellé « Résumé IA » | 15 (le libellé est affiché par le rendu, lots 2 et 6) |
| R5 citations, dont la paraphrase PBS / Vance | 6, 15 |
| R6 chiffres | 7, 15 |
| R7 divergences, dont le contre-exemple Eurostar | 8, 15 |
| R8 Morning Brief à 5 infos et équilibré | 2 (schéma), 15 |
| R9 lien prépa | 10, 15 |
| R10 vocabulaire | 2 (schéma), 13 |
| R11 visuels | 11, 15 |
| R12 Threads | 12, 15 (fermeture à 21 jours : lot 3) |
| §7 « ne bloque jamais l'édition » | 15, 16 |
| §13 tests unitaires du lot | 2 à 16 |
