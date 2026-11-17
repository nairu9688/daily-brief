import Link from 'next/link';
import { LANGS, type Lang } from '@daily-brief/schema';
import { headerDate, parisTime } from '@/lib/dates';
import { REGION, T } from '@/lib/i18n';

/**
 * En-tête collant : logo demi-disque à l'accent de l'édition, date, onglets FR/EN/ES. Les onglets sont
 * des liens `?ed=xx` : le proxy retient le choix dans le cookie `ed`, sans JavaScript.
 */
export function TopBar({ lang, date, generatedAt, basePath }: { lang: Lang; date: string; generatedAt?: string; basePath: string }) {
  return (
    <header className="topbar">
      <div className="brandrow">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          DAILY BRIEF
        </div>
        <div className="date mono">
          {headerDate(date)}
          {generatedAt ? ` · ${parisTime(generatedAt)}` : ''}
        </div>
      </div>
      <nav className="editions" aria-label="Éditions">
        {LANGS.map((l) => (
          <Link key={l} href={`${basePath}?ed=${l}`} data-ed={l} aria-current={l === lang ? 'page' : undefined} prefetch={false}>
            <b>{T[l].label}</b>
            <span className="mono">{REGION[l]}</span>
          </Link>
        ))}
      </nav>
    </header>
  );
}
