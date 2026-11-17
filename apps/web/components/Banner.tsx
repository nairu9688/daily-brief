import type { Lang } from '@daily-brief/schema';
import { shortDate } from '@/lib/dates';
import { T } from '@/lib/i18n';

export type BannerKind = 'light' | 'yesterday' | 'latest';

/**
 * Bandeaux de l'édition (spec §12) : « édition allégée », « brief de la veille » (l'édition affichée
 * date de la veille) et « dernier brief » (plus ancienne), dans la langue de l'édition.
 */
export function Banner({ kind, lang, date }: { kind: BannerKind; lang: Lang; date: string }) {
  const t = T[lang];
  const label = kind === 'light' ? t.lightLabel : kind === 'yesterday' ? t.yesterdayLabel : t.latestLabel;
  const text = kind === 'light' ? t.light : kind === 'yesterday' ? t.yesterday(shortDate(date, lang)) : t.latest(shortDate(date, lang));
  return (
    <p className="banner" role="status" data-kind={kind}>
      <b className="mono">{label}</b>
      {text}
    </p>
  );
}
