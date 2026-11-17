import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSupabaseClient, objectPath, SupabaseDownError, SupabaseError } from '../../supabase/client';
import { MISSING_SUPABASE, supabaseConfig } from '../../supabase/config';
import { FAKE_KEY, FAKE_URL, fakeSupabase } from './fake-supabase';

const config = { url: FAKE_URL, serviceKey: FAKE_KEY };
const Any = z.unknown();
const PDF = new TextEncoder().encode('%PDF-1.7 test');

describe('supabaseConfig', () => {
  it('rogne les valeurs et ne garde que l’origine', () => {
    expect(supabaseConfig({ SUPABASE_URL: ' https://abc.supabase.co/ ', SUPABASE_SERVICE_ROLE_KEY: ' k ' })).toEqual({ ok: true, config: { url: 'https://abc.supabase.co', serviceKey: 'k' } });
  });

  it('signale une clé ou une URL absente', () => {
    expect(supabaseConfig({})).toEqual({ ok: false, error: MISSING_SUPABASE });
    expect(supabaseConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '  ' })).toEqual({ ok: false, error: MISSING_SUPABASE });
  });

  it('refuse http hors localhost, un chemin, une requête ou des identifiants', () => {
    const bad = (url: string) => supabaseConfig({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'k' });
    expect(bad('http://abc.supabase.co')).toEqual({ ok: false, error: 'SUPABASE_URL invalide : https obligatoire (http seulement pour localhost)' });
    expect(bad('ftp://abc.supabase.co').ok).toBe(false);
    expect(bad('pas une url')).toEqual({ ok: false, error: 'SUPABASE_URL invalide : URL attendue (https://<projet>.supabase.co)' });
    for (const url of ['https://abc.supabase.co/rest/v1', 'https://abc.supabase.co/?x=1', 'https://u:p@abc.supabase.co']) {
      expect(bad(url)).toEqual({ ok: false, error: 'SUPABASE_URL invalide : origine seule attendue, sans chemin, requête ni identifiants' });
    }
    expect(bad('http://127.0.0.1:54321')).toEqual({ ok: true, config: { url: 'http://127.0.0.1:54321', serviceKey: 'k' } });
  });
});

describe('objectPath', () => {
  it('encode chaque segment et refuse les chemins douteux', () => {
    expect(objectPath('pdf', '2026-11-06/daily-brief-2026-11-06.pdf')).toBe('pdf/2026-11-06/daily-brief-2026-11-06.pdf');
    for (const p of ['../x', 'a//b', 'a/./b', 'a b', 'a?b', '']) expect(() => objectPath('pdf', p)).toThrow('chemin de stockage refusé');
  });
});

describe('client Supabase', () => {
  it('rpc : POST JSON avec la clé dans apikey et authorization, réponse validée', async () => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ json: { ok: 1 } });
    const client = createSupabaseClient(config, fake.fetch);
    expect(await client.rpc('save_run', { p_date: '2026-11-06' }, z.object({ ok: z.number() }))).toEqual({ ok: 1 });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect([call.method, call.path, call.body]).toEqual(['POST', '/rest/v1/rpc/save_run', '{"p_date":"2026-11-06"}']);
    expect(call.headers).toMatchObject({ apikey: FAKE_KEY, authorization: `Bearer ${FAKE_KEY}`, 'content-type': 'application/json' });
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('rpc : refuse un nom de fonction douteux sans rien envoyer', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    await expect(client.rpc('x; drop table', {}, Any)).rejects.toThrow('nom de fonction refusé');
    await expect(client.rpc('../storage', {}, Any)).rejects.toThrow('nom de fonction refusé');
    expect(fake.calls).toEqual([]);
  });

  it('rpc : réponse non JSON ou d’une forme inattendue, sans fragment du corps', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    fake.intercept = () => ({ text: '<html>secret-interne</html>' });
    await expect(client.rpc('f', {}, Any)).rejects.toThrow(/^Supabase f : réponse non JSON$/);
    fake.intercept = () => ({ json: { a: 'secret-interne' } });
    await expect(client.rpc('f', {}, z.object({ a: z.number(), b: z.string() }))).rejects.toThrow(/^Supabase f : réponse inattendue \(2 champs invalides\)$/);
    expect(client.breaker.open).toBe(false);
  });

  it('une erreur SQL donne SupabaseError avec le code, sans compter pour le disjoncteur', async () => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ status: 400, json: { code: '22023', message: 'publish_edition : édition absente ou incomplète', details: 'x' } });
    const client = createSupabaseClient(config, fake.fetch);
    for (let i = 0; i < 5; i++) {
      const e = await client.rpc('publish_edition', {}, Any).catch((x: Error) => x) as Error;
      expect(e).toBeInstanceOf(SupabaseError);
      expect(e.message).toBe('Supabase publish_edition : HTTP 400 22023 — publish_edition : édition absente ou incomplète');
    }
    expect(client.breaker.open).toBe(false);
    expect(fake.calls).toHaveLength(5);
  });

  it('la clé de service ne paraît dans aucun message d’erreur', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    fake.intercept = () => ({ status: 400, json: { message: `clé ${FAKE_KEY} refusée (${encodeURIComponent(FAKE_KEY)})` } });
    const a = await client.rpc('f', {}, Any).catch((x: Error) => x) as Error;
    expect(a.message).toBe('Supabase f : HTTP 400 — clé *** refusée (***)');
    fake.intercept = () => ({ error: new Error(`connexion refusée avec ${FAKE_KEY}`) });
    const b = await client.rpc('f', {}, Any).catch((x: Error) => x) as Error;
    expect(b.message).toBe('Supabase f : connexion refusée avec ***');
  });

  it.each([401, 402, 403, 429])('un HTTP %i coupe Supabase : plus aucun appel ne part', async (status) => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ status, json: { message: 'non' } });
    const client = createSupabaseClient(config, fake.fetch);
    await expect(client.rpc('f', {}, Any)).rejects.toThrow(`Supabase f : HTTP ${status} — non`);
    await expect(client.rpc('g', {}, Any)).rejects.toThrow(new SupabaseDownError(`HTTP ${status}`));
    await expect(client.upload('pdf', 'a.pdf', PDF, 'application/pdf')).rejects.toThrow(`Supabase coupé (HTTP ${status})`);
    await expect(client.download('pdf', 'a.pdf')).rejects.toThrow(SupabaseDownError);
    await expect(client.remove('pdf', ['a.pdf'])).rejects.toThrow(SupabaseDownError);
    expect(fake.calls).toHaveLength(1);
  });

  it('une clé fausse est refusée par le service (401) et coupe le client', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient({ url: FAKE_URL, serviceKey: 'mauvaise-clé' }, fake.fetch);
    await expect(client.rpc('f', {}, Any)).rejects.toThrow('Supabase f : HTTP 401 — Invalid API key');
    expect(client.breaker.reason).toBe('HTTP 401');
  });

  it('un appel muet est interrompu au délai, et le délai coupe Supabase', async () => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ hang: true });
    const client = createSupabaseClient(config, fake.fetch);
    const e = await client.rpc('f', {}, Any, { timeoutMs: 20 }).catch((x: Error) => x) as Error;
    expect(e.name).toBe('TimeoutError');
    expect(e.message).toMatch(/^Supabase f : /);
    expect(client.breaker.reason).toBe('délai dépassé');
  });

  it('honore le signal de l’appelant et celui du client', async () => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ hang: true });
    const perCall = new AbortController();
    const p = createSupabaseClient(config, fake.fetch).rpc('f', {}, Any, { signal: perCall.signal });
    perCall.abort();
    await expect(p).rejects.toThrow(/^Supabase f : /);
    const global = new AbortController();
    const q = createSupabaseClient(config, fake.fetch, { signal: global.signal }).download('pdf', 'a.pdf');
    global.abort();
    await expect(q).rejects.toThrow(/^Supabase Storage \(lecture pdf\/a\.pdf\) : /);
  });

  it('trois erreurs serveur de suite coupent Supabase ; un succès remet le compte à zéro', async () => {
    const fake = fakeSupabase();
    let status = 500;
    fake.intercept = () => ({ status, json: {} });
    const client = createSupabaseClient(config, fake.fetch);
    await expect(client.rpc('f', {}, Any)).rejects.toThrow('HTTP 500');
    await expect(client.rpc('f', {}, Any)).rejects.toThrow('HTTP 500');
    status = 200;
    await client.rpc('f', {}, Any);
    status = 503;
    for (let i = 0; i < 3; i++) await expect(client.rpc('f', {}, Any)).rejects.toThrow('HTTP 503');
    expect(client.breaker.reason).toBe('source coupée après 3 échecs consécutifs');
    await expect(client.rpc('f', {}, Any)).rejects.toThrow(SupabaseDownError);
    expect(fake.calls).toHaveLength(6);
  });

  it('upload puis download : octets identiques, remplacement autorisé (x-upsert)', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    await client.upload('pdf', '2026-11-06/a.pdf', PDF, 'application/pdf');
    await client.upload('pdf', '2026-11-06/a.pdf', PDF, 'application/pdf');
    expect(fake.calls[0]).toMatchObject({ method: 'POST', path: '/storage/v1/object/pdf/2026-11-06/a.pdf', headers: { 'content-type': 'application/pdf', 'x-upsert': 'true' } });
    expect(fake.files.get('pdf/2026-11-06/a.pdf')!.contentType).toBe('application/pdf');
    expect(new Uint8Array((await client.download('pdf', '2026-11-06/a.pdf'))!)).toEqual(PDF);
  });

  it('download : null pour un fichier absent, sans compter pour le disjoncteur', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    for (let i = 0; i < 4; i++) expect(await client.download('audio', '2026-01-01/fr.mp3')).toBeNull();
    expect(client.breaker.open).toBe(false);
  });

  it('upload : refuse un fichier vide ou un chemin douteux sans rien envoyer', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    await expect(client.upload('pdf', 'a.pdf', new Uint8Array(), 'application/pdf')).rejects.toThrow('fichier vide');
    await expect(client.upload('pdf', '../a.pdf', PDF, 'application/pdf')).rejects.toThrow('chemin de stockage refusé');
    expect(fake.calls).toEqual([]);
  });

  it('remove : un seul DELETE avec la liste des chemins ; rien à envoyer pour une liste vide', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    await client.upload('audio', '2026-10-01/fr.mp3', PDF, 'audio/mpeg');
    await client.upload('audio', '2026-10-01/en.mp3', PDF, 'audio/mpeg');
    await client.remove('audio', []);
    await client.remove('audio', ['2026-10-01/fr.mp3', '2026-10-02/absent.mp3']);
    expect(fake.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/storage/v1/object/audio', body: '{"prefixes":["2026-10-01/fr.mp3","2026-10-02/absent.mp3"]}' });
    expect([...fake.files.keys()]).toEqual(['audio/2026-10-01/en.mp3']);
    expect(fake.calls).toHaveLength(3);
  });
});
