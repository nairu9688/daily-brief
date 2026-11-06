import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { EditionSchema } from '../src/edition';

it('edition.schema.json committé est à jour', () => {
  const committed = JSON.parse(readFileSync(new URL('../edition.schema.json', import.meta.url), 'utf8'));
  const fresh = JSON.parse(JSON.stringify(z.toJSONSchema(EditionSchema, { unrepresentable: 'any' })));
  expect(committed).toEqual(fresh);
});
