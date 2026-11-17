import type { Lang } from '@daily-brief/schema';
import { shortDate } from '@/lib/dates';
import { T } from '@/lib/i18n';

/** Bandeaux de l'édition (spec §12) : « édition allégée » et « brief de la veille ». */
export function Banner({ kind, lang, date }: { kind: 'light' | 'yesterday'; lang: Lang; date: string }) {
  const t = T[lang];
  return (
    <p className="banner" role="status" data-kind={kind}>
      <b className="mono">{kind === 'light' ? 'Édition allégée' : 'Brief de la veille'}</b>
      {kind === 'light' ? t.light : t.yesterday(shortDate(date, lang))}
    </p>
  );
}
