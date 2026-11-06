import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { EditionSchema } from '../src/edition';

const target = fileURLToPath(new URL('../edition.schema.json', import.meta.url));
const schema = z.toJSONSchema(EditionSchema, { unrepresentable: 'any' });
writeFileSync(target, JSON.stringify(schema, null, 2) + '\n');
console.log(`JSON Schema écrit dans ${target}`);
