'use client';
import Link from 'next/link';
import { useShell } from './AppShell';

const UserIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="10" cy="7" r="3.2" />
    <path d="M3.8 16.5c1.2-2.7 3.5-4 6.2-4s5 1.3 6.2 4" />
  </svg>
);

/** Liens du compte : connecté, l'adresse, Santé et « Se déconnecter » (POST) ; sinon « Se connecter ». */
function AccountLinks() {
  const { user } = useShell();
  if (!user) {
    return (
      <>
        <Link className="acct-in" href="/login">
          Se connecter
        </Link>
        <p className="acct-note">Pour cocher le Vocab, l’envoyer à Anki et suivre des Threads.</p>
      </>
    );
  }
  return (
    <>
      <p className="acct-mail mono" title={user.email}>
        {user.email}
      </p>
      <Link className="acct-link" href="/sante">
        Santé →
      </Link>
      <form action="/auth/signout" method="post">
        <button type="submit" className="acct-out">
          Se déconnecter
        </button>
      </form>
    </>
  );
}

/** Téléphone : petit menu « Compte » dans l'en-tête (élément <details>, sans JavaScript). */
export function AccountMenu() {
  const { user } = useShell();
  return (
    <details className="acct">
      <summary aria-label={user ? 'Compte' : 'Compte : se connecter'} data-in={user ? '' : undefined}>
        <UserIcon />
      </summary>
      <div className="acct-pop">
        <AccountLinks />
      </div>
    </details>
  );
}

/** Grand écran : bloc du compte en bas de la barre latérale. */
export function AccountBlock() {
  return (
    <div className="acct-block">
      <AccountLinks />
    </div>
  );
}
