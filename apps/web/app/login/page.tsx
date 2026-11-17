import { LoginForm } from './LoginForm';

const ERRORS: Record<string, string> = {
  refuse: 'Cette adresse n’est pas autorisée à lire le brief.',
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
      <p>Un lien de connexion est envoyé à l’adresse autorisée. Le brief est privé.</p>
      {erreur && ERRORS[erreur] && <p role="alert">{ERRORS[erreur]}</p>}
      <LoginForm />
    </main>
  );
}
