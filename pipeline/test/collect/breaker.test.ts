import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Breaker, describeError, recordFailure } from '../../collect/breaker';
import { HttpError } from '../../collect/http';
import { emptyRun } from '../../collect/types';

describe('disjoncteur', () => {
  it('se coupe sur 401, 402, 403, 429 et délai dépassé, pas sur 500 ni sur une réponse illisible', () => {
    for (const s of [401, 402, 403, 429]) expect(new Breaker().trip(new HttpError(s, 'https://a'))).toBe(true);
    const timeout = new Error('t');
    timeout.name = 'TimeoutError';
    expect(new Breaker().trip(timeout)).toBe(true);
    const b = new Breaker();
    expect(b.trip(new HttpError(500, 'https://a'))).toBe(false);
    expect(b.trip(new Error('JSON invalide'))).toBe(false);
    expect(b.open).toBe(false);
  });

  it('recordFailure note l’erreur et la coupure dans le bilan', () => {
    const run = emptyRun();
    const b = new Breaker();
    expect(recordFailure(run, b, 'top fr/pol', new HttpError(500, 'https://api/top?api_token=S'))).toBe(false);
    expect(recordFailure(run, b, 'top fr/eco', new HttpError(429, 'https://api/top?api_token=S'))).toBe(true);
    expect(run.stoppedBy).toBe('HTTP 429');
    expect(run.errors).toEqual(['top fr/pol : HTTP 500 (https://api/top?api_token=***)', 'top fr/eco : HTTP 429 (https://api/top?api_token=***) — source coupée']);
  });
});

describe('disjoncteur : échecs consécutifs et messages', () => {
  it('se coupe après 3 échecs non fatals consécutifs, un succès remet le compte à zéro', () => {
    const run = emptyRun();
    const b = new Breaker();
    const fail = () => recordFailure(run, b, 'x', new HttpError(500, 'https://a'));
    expect([fail(), fail()]).toEqual([false, false]);
    b.success();
    expect([fail(), fail()]).toEqual([false, false]);
    expect(fail()).toBe(true);
    expect(run.stoppedBy).toBe('source coupée après 3 échecs consécutifs');
    expect(run.errors.filter((e) => e.includes('source coupée'))).toHaveLength(1);
  });

  it('résume une réponse non JSON ou inattendue sans fragment du corps', () => {
    expect(describeError(new SyntaxError('Unexpected token < in JSON at position 0 <html>SECRET'))).toBe('réponse non JSON');
    const zodErr = z.object({ a: z.string(), b: z.string() }).safeParse({}).error!;
    expect(describeError(zodErr)).toBe('réponse inattendue (2 champs invalides)');
  });
});
