import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { TabBar } from '@/components/TabBar';
import { chosenLang, EDITION_COOKIE } from '@/lib/edition-choice';

/** Écrans de l'appli : accent de l'édition choisie et barre d'onglets en bas. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const lang = chosenLang((await cookies()).get(EDITION_COOKIE)?.value);
  return (
    <div className="app" data-ed={lang}>
      {children}
      <TabBar />
    </div>
  );
}
