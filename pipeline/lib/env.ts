/**
 * Charge `.env` (s'il existe) dans `process.env`. Une variable listée dans `names` qui est définie mais vide
 * est d'abord retirée : `loadEnvFile` ne remplace jamais une variable déjà définie, même vide, et `.env`
 * ne pourrait pas la remplir. Seule l'absence du fichier (`ENOENT`) est ignorée ; toute autre erreur est remontée.
 */
export function loadEnv(names: readonly string[] = [], file = '.env'): void {
  for (const name of names) if (process.env[name] !== undefined && process.env[name]!.trim() === '') delete process.env[name];
  try {
    process.loadEnvFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
