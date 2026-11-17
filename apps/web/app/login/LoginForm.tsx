'use client';
import { useActionState } from 'react';
import { sendLink, verifyCode, type LoginState } from './actions';

export function LoginForm() {
  const [state, send, sending] = useActionState(sendLink, { step: 'email' } as LoginState);
  const [codeState, verify, verifying] = useActionState(verifyCode, { step: 'code' } as LoginState);
  return (
    <>
      <form action={send}>
        <label htmlFor="email">Adresse e-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
        <button type="submit" disabled={sending}>
          Recevoir le lien
        </button>
      </form>
      {state.message && <p role="status">{state.message}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {state.step === 'code' && (
        <form action={verify}>
          <input type="hidden" name="email" value={state.email ?? ''} />
          <label htmlFor="code">Code reçu</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,12}" required />
          <button type="submit" disabled={verifying}>
            Se connecter
          </button>
          {codeState.error && <p role="alert">{codeState.error}</p>}
        </form>
      )}
    </>
  );
}
