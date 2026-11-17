import { RUBRIC_KEYS } from '@daily-brief/schema';
import { parisTime } from '@/lib/dates';
import type { EditionView } from '@/lib/data/types';
import { CHIP_LABELS, T, uniqueOutlets } from '@/lib/i18n';
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
 */
export function EditionScreen({ edition, basePath, stale }: { edition: EditionView; basePath: string; stale?: 'yesterday' | 'latest' }) {
  const t = T[edition.lang];
  const present = new Set(edition.sections.map((s) => s.key));
  const outlets = uniqueOutlets(edition.sections.flatMap((s) => [...s.stories.flatMap((x) => x.sources), ...s.briefs]));
  return (
    <>
      <TopBar lang={edition.lang} date={edition.date} generatedAt={edition.generatedAt} basePath={basePath} />
      <section className="edition" data-for={edition.lang} lang={edition.lang}>
        {stale && <Banner kind={stale} lang={edition.lang} date={edition.date} />}
        {edition.light && <Banner kind="light" lang={edition.lang} date={edition.date} />}
        <MorningBrief edition={edition} />
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
              <VocabCard kicker="Tirés des articles du jour" title={edition.vocab.title} titleLang={edition.lang} words={edition.vocab.words.map((w) => ({ ...w, lang: edition.lang }))} />
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
      </section>
    </>
  );
}
