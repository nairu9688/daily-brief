import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parisToday } from '../lib/date';
import { formatIssues } from './issues';
import { runVerify } from './run-verify';

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
      : 'Erreur : au moins une édition est invalide (schéma ou fichier manquant).',
);
process.exit(exitCode);
