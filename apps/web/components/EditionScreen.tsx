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
 * Vocab du jour, colophon. `today` sert au bandeau « brief de la veille » (absent de l'archive).
 */
export function EditionScreen({ edition, basePath, yesterdayOf }: { edition: EditionView; basePath: string; yesterdayOf?: string }) {
  const t = T[edition.lang];
  const present = new Set(edition.sections.map((s) => s.key));
  const outlets = uniqueOutlets(edition.sections.flatMap((s) => [...s.stories.flatMap((x) => x.sources), ...s.briefs]));
  return (
    <>
      <TopBar lang={edition.lang} date={edition.date} generatedAt={edition.generatedAt} basePath={basePath} />
      <section className="edition" data-for={edition.lang}>
        {yesterdayOf && <Banner kind="yesterday" lang={edition.lang} date={edition.date} />}
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
              <div className="rubhead">
                <h2>Vocab du jour</h2>
                <span className="mono">{edition.vocab.words.length} mots</span>
              </div>
              <VocabCard kicker="Tirés des articles du jour" title={edition.vocab.title} words={edition.vocab.words} />
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
