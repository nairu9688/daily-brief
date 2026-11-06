import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parisToday } from '../lib/date';
import { formatIssues } from './issues';
import { runVerify } from './run-verify';

try {
  const { values } = parseArgs({
    options: {
      date: { type: 'string' },
      out: { type: 'string', default: 'out' },
    },
  });

  const date = values.date ?? parisToday();
  const { issues, exitCode } = runVerify({
    outDir: values.out!,
    date,
    whitelistPath: fileURLToPath(new URL('../config/whitelist.json', import.meta.url)),
    programmePath: fileURLToPath(new URL('../editorial/programme-ect.md', import.meta.url)),
  });

  console.log(`brief:verify ${date}`);
  console.log(formatIssues(issues));
  console.log(
    exitCode === 0
      ? 'OK : aucune violation.'
      : exitCode === 1
        ? 'Corrections appliquées dans *.verified.json : corrige les fichiers sources puis relance.'
        : 'Erreur : édition invalide ou absente, fichier d’entrée illisible ou date incorrecte. Corrige avant de publier.',
  );
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:verify : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
