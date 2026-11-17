import { describe, expect, it } from 'vitest';
import { selectStore, UnavailableContextStore } from '../../context/select-store';
import { EmptyContextStore } from '../../context/store';
import { SupabaseContextStore } from '../../context/supabase-store';
import { FAKE_KEY, FAKE_URL, fakeSupabase } from '../supabase/fake-supabase';

const ENV = { SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY };

describe('selectStore', () => {
  it('avec les deux variables : store Supabase, sans avertissement, qui appelle le projet avec la clé', async () => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ json: [] });
    const { store, warnings } = selectStore(ENV, { fetch: fake.fetch });
    expect(store).toBeInstanceOf(SupabaseContextStore);
    expect(store.name).toBe('supabase');
    expect(warnings).toEqual([]);
    expect(await store.openThreads()).toEqual([]);
    expect(fake.calls[0]).toMatchObject({ path: '/rest/v1/rpc/context_open_threads', headers: { apikey: FAKE_KEY } });
  });

  it('sans configuration : store indisponible dont chaque appel échoue, aucun appel réseau', async () => {
    const fake = fakeSupabase();
    for (const env of [{}, { SUPABASE_URL: FAKE_URL }, { SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY }, { SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: '   ' }]) {
      const { store, warnings } = selectStore(env, { fetch: fake.fetch });
      expect(store).toBeInstanceOf(UnavailableContextStore);
      expect(warnings).toEqual([]);
      const message = 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente (--allow-empty pour un contexte vide en développement local)';
      await expect(store.closeStaleThreads('2026-11-06')).rejects.toThrow(message);
      await expect(store.openThreads()).rejects.toThrow(message);
      await expect(store.yesterdayTopics('2026-11-06')).rejects.toThrow(message);
    }
    expect(fake.calls).toEqual([]);
  });

  it('--allow-empty : store vide et avertissement, seulement si la configuration est absente', () => {
    const fake = fakeSupabase();
    const empty = selectStore({}, { allowEmpty: true, fetch: fake.fetch });
    expect(empty.store).toBeInstanceOf(EmptyContextStore);
    expect(empty.warnings).toEqual(['SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)']);
    expect(selectStore(ENV, { allowEmpty: true, fetch: fake.fetch }).store).toBeInstanceOf(SupabaseContextStore);
  });

  it('une URL invalide est une erreur même avec --allow-empty, et la clé n’est envoyée nulle part', async () => {
    const fake = fakeSupabase();
    const { store } = selectStore({ SUPABASE_URL: 'http://projet.supabase.co', SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY }, { allowEmpty: true, fetch: fake.fetch });
    expect(store).toBeInstanceOf(UnavailableContextStore);
    await expect(store.openThreads()).rejects.toThrow('SUPABASE_URL invalide : https obligatoire (http seulement pour localhost)');
    expect(fake.calls).toEqual([]);
  });
});
