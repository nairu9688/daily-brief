import Link from 'next/link';
import { AccountBlock } from './Account';
import { EditionTabs } from './EditionTabs';
import { TabBar } from './TabBar';

/**
 * Barre latérale du grand écran (≥ 1024 px en paysage ; masquée sur téléphone) : logo, navigation,
 * choix de l'édition et compte. Mise en page seulement inspirée de Pollar ; jetons et accents de design/.
 */
export function Sidebar() {
  return (
    <aside className="side">
      <Link href="/" className="brand side-brand">
        <span className="logo" aria-hidden="true" />
        DAILY BRIEF
      </Link>
      <TabBar variant="side" />
      <div className="side-sec">
        <p className="side-h mono">Édition</p>
        <EditionTabs variant="side" />
      </div>
      <div className="side-foot">
        <AccountBlock />
      </div>
    </aside>
  );
}
