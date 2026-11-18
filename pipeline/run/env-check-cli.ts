import { checkEnvFile } from './env-check';

const { exitCode, lines } = checkEnvFile(process.argv[2] ?? '.env');
for (const l of lines) console.log(l);
console.log(exitCode === 0 ? '.env prêt.' : '.env incomplet : le pipeline ne peut pas lire ni écrire Supabase.');
process.exit(exitCode);
