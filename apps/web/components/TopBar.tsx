import type { Lang } from '@daily-brief/schema';
import { headerDate, longDateFr, parisTime } from '@/lib/dates';
import { T } from '@/lib/i18n';
import { AccountMenu } from './Account';
import { EditionTabs } from './EditionTabs';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * En-tête : logo demi-disque à l'accent de l'édition, date, compte, onglets FR/EN/ES (téléphone : collant).
 * Grand écran : la barre latérale porte le logo, les onglets et le compte ; l'en-tête devient le titre
 * de la colonne centrale (date longue, édition, heure de génération).
 */
export function TopBar({ lang, date, generatedAt, basePath }: { lang: Lang; date: string; generatedAt?: string; basePath: string }) {
  return (
    <header className="topbar">
      <div className="brandrow">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          DAILY BRIEF
        </div>
        <div className="brandend">
          <div className="date mono">
            {headerDate(date)}
            {generatedAt ? ` · ${parisTime(generatedAt)}` : ''}
          </div>
          <AccountMenu />
        </div>
      </div>
      <div className="dayhead">
        <p className="dd">{capitalize(longDateFr(date))}</p>
        <p className="mono">
          {T[lang].label}
          {generatedAt ? ` · édition de ${parisTime(generatedAt)}` : ''}
        </p>
      </div>
      <EditionTabs lang={lang} basePath={basePath} />
    </header>
  );
}
