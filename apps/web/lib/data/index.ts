import 'server-only';
import { cache } from 'react';
import { LANGS, type Lang } from '@daily-brief/schema';
import { parisToday } from '@/lib/dates';
import { fixtureMode, fixtureToday } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';
import { FixtureDataSource } from './fixture';
import { CachedSupabaseDataSource } from './cached';
import type { DataSource } from './types';

/** FIXTURE_LIGHT=es,en : éditions allégées du mode fixture (tests du bandeau). */
const fixtureLight = (): Lang[] => (process.env.FIXTURE_LIGHT ?? '').split(',').filter((l): l is Lang => (LANGS as readonly string[]).includes(l));

/** Source de données de la requête : fixtures/ si FIXTURE=1, sinon Supabase avec la session (éditions en cache, voir ./cached). */
export const getDataSource = cache(async (): Promise<DataSource> => {
  if (fixtureMode()) return new FixtureDataSource({ today: fixtureToday(), light: fixtureLight() });
  return new CachedSupabaseDataSource(await createSupabase(), () => parisToday());
});
