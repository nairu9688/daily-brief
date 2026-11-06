export const LANGS = ['fr', 'en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

export const RUBRIC_KEYS = ['pol', 'int', 'eco', 'ent', 'dro', 'tec', 'env', 'cul', 'spo'] as const;
export type RubricKey = (typeof RUBRIC_KEYS)[number];

/** Libellés de la spec §3, identiques dans l'appli, le PDF et le JSON. */
export const RUBRIC_LABELS: Record<Lang, Record<RubricKey, string>> = {
  fr: {
    pol: 'Politique & société',
    int: 'International & géopolitique',
    eco: 'Économie',
    ent: 'Entreprises & management',
    dro: 'Droit & justice',
    tec: 'Tech & IA',
    env: 'Environnement & énergie',
    cul: 'Culture',
    spo: 'Sport',
  },
  en: {
    pol: 'Politics & society',
    int: 'World',
    eco: 'Economy',
    ent: 'Business',
    dro: 'Law',
    tec: 'Tech & AI',
    env: 'Environment',
    cul: 'Culture',
    spo: 'Sport',
  },
  es: {
    pol: 'Política y sociedad',
    int: 'Internacional',
    eco: 'Economía',
    ent: 'Empresas',
    dro: 'Derecho',
    tec: 'Tecnología',
    env: 'Medio ambiente',
    cul: 'Cultura',
    spo: 'Deporte',
  },
};
