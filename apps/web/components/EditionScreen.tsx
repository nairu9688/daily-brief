import type { ReactNode } from 'react';
import { RUBRIC_KEYS } from '@daily-brief/schema';
import { parisTime } from '@/lib/dates';
import type { EditionView } from '@/lib/data/types';
import { CHIP_LABELS, T, uniqueOutlets } from '@/lib/i18n';
import { EditionAccent } from './AppShell';
import { Banner } from './Banner';
import { Briefs } from './Briefs';
import { MorningBrief } from './MorningBrief';
import { RubricFilter } from './RubricFilter';
import { StoryCard } from './StoryCard';
import { TopBar } from './TopBar';
import { VocabCard } from './VocabCard';

/**
 * Écran d'une édition (spec §8.3) : en-tête, bandeaux, Morning Brief, puces, rubriques et « En bref »,
 * Vocab du jour, colophon. `stale` : bandeau « brief de la veille » ou « dernier brief » quand l'édition
 * affichée n'est pas celle du jour (absent de l'archive). `lang` sur la section : lecteurs d'écran et césure.
 * `editable` : utilisateur autorisé connecté (cases et Anki) ; faux pour un visiteur (lecture seule).
 * `markets` : bloc des marchés (Brief du jour seulement), dans la colonne de droite.
 *
 * L'écran porte son propre `data-ed` (accent juste dès le rendu serveur) et <EditionAccent> met la coquille
 * (barre latérale, barre d'onglets) à la même édition. Téléphone : une colonne, dans l'ordre du DOM
 * (bandeaux, Morning Brief, marchés, rubriques). Grand écran : `.rail` (Morning Brief, marchés) à droite.
 */
export function EditionScreen({ edition, basePath, stale, editable, markets }: { edition: EditionView; basePath: string; stale?: 'yesterday' | 'latest'; editable: boolean; markets?: ReactNode }) {
  const t = T[edition.lang];
  const present = new Set(edition.sections.map((s) => s.key));
  const outlets = uniqueOutlets(edition.sections.flatMap((s) => [...s.stories.flatMap((x) => x.sources), ...s.briefs]));
  return (
    <div className="ed-screen" data-ed={edition.lang}>
      <EditionAccent lang={edition.lang} />
      <TopBar lang={edition.lang} date={edition.date} generatedAt={edition.generatedAt} basePath={basePath} />
      <section className="edition" data-for={edition.lang} lang={edition.lang}>
        {(stale || edition.light) && (
          <div className="ed-banners">
            {stale && <Banner kind={stale} lang={edition.lang} date={edition.date} />}
            {edition.light && <Banner kind="light" lang={edition.lang} date={edition.date} />}
          </div>
        )}
        <div className="rail">
          <MorningBrief edition={edition} />
          {markets}
        </div>
        <div className="ed-main">
          <RubricFilter chips={RUBRIC_KEYS.map((key) => ({ key, label: CHIP_LABELS[edition.lang][key], present: present.has(key) }))} allLabel={t.all} emptyLabel={t.empty}>
            {edition.sections.map((s) => (
              <div className="rub" data-rub={s.key} key={s.key}>
                <div className="rubhead">
                  <h2>{s.title}</h2>
                  <span className="mono">{t.subjects(s.stories.length + s.briefs.length)}</span>
                </div>
                {s.stories.map((st) => (
                  <StoryCard story={st} lang={edition.lang} key={st.id} />
                ))}
                <Briefs briefs={s.briefs} lang={edition.lang} />
              </div>
            ))}
            {edition.vocab && (
              <div className="rub" data-rub="vocab">
                {/* Libellés de l'interface, en français dans toutes les éditions (maquette) */}
                <div className="rubhead" lang="fr">
                  <h2>Vocab du jour</h2>
                  <span className="mono">{edition.vocab.words.length} mots</span>
                </div>
                <VocabCard kicker="Tirés des articles du jour" title={edition.vocab.title} titleLang={edition.lang} words={edition.vocab.words.map((w) => ({ ...w, lang: edition.lang }))} editable={editable} />
              </div>
            )}
          </RubricFilter>
          <p className="colophon mono">
            Édition générée à {parisTime(edition.generatedAt)} · {outlets.length} médias
            {edition.hasPdf && (
              <>
                {' · '}
                <a href={`/pdf/${edition.date}`}>PDF du jour</a>
              </>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
