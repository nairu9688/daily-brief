import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { IsoDateSchema } from '@daily-brief/schema';
import { parisToday } from '../lib/date';
import { buildNotification } from './notify';

try {
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' }, 'dry-run': { type: 'boolean', default: false } } });
  const date = values.date ?? parisToday();
  if (!IsoDateSchema.safeParse(date).success) {
    console.log(`Brief incomplet : date incorrecte (« ${date} »)`);
    process.exit(2);
  }
  const n = buildNotification(join(values.out!, date), date, { dryRun: values['dry-run'] });
  console.log(n.message);
  process.exit(n.ready ? 0 : 2);
} catch (e) {
  console.error(`brief:notify : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
