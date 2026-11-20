import Link from 'next/link';
import { LoginForm } from './LoginForm';

const ERRORS: Record<string, string> = {
  refuse: 'Cette adresse n’est pas autorisée à se connecter. Le brief reste lisible sans connexion.',
  lien: 'Lien invalide ou expiré : demande-en un nouveau.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const erreur = (await searchParams).erreur;
  return (
    <main className="login" data-ed="fr">
      <div className="brand">
        <span className="logo" aria-hidden="true" />
        DAILY BRIEF
      </div>
      <h1>Connexion</h1>
      <p>Le brief se lit sans connexion. La connexion, réservée à l’adresse autorisée, ouvre les mots à cocher, l’envoi vers Anki, le suivi des Threads et la page Santé.</p>
      {erreur && ERRORS[erreur] && <p role="alert">{ERRORS[erreur]}</p>}
      <LoginForm />
      <p className="back-home">
        <Link href="/">← Retour au brief</Link>
      </p>
    </main>
  );
}
