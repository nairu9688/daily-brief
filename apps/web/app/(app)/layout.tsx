import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { Sidebar } from '@/components/Sidebar';
import { TabBar } from '@/components/TabBar';
import { currentUser } from '@/lib/auth';
import { chosenLang, EDITION_COOKIE } from '@/lib/edition-choice';

/**
 * Écrans de l'appli : coquille à l'accent de l'édition (état client, voir AppShell), barre latérale
 * (grand écran), contenu, barre d'onglets en bas (téléphone).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const lang = chosenLang((await cookies()).get(EDITION_COOKIE)?.value);
  const user = await currentUser();
  return (
    <AppShell initialLang={lang} user={user ? { email: user.email } : null}>
      <Sidebar />
      <main className="main">{children}</main>
      <TabBar />
    </AppShell>
  );
}
