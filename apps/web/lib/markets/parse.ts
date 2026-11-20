import { z } from 'zod';

/**
 * Marchés (bloc « Marchés » du Brief) : cours différés de Yahoo Finance, point d'accès `v7/finance/spark`
 * (gratuit, sans clé, un seul appel pour tous les instruments). Choix et évaluation : docs/setup-web.md, § 6.
 * Ce module est pur (analyse et formatage) ; la lecture réseau est dans ./index.ts (serveur seulement).
 */

export type Instrument = { symbol: string; label: string; digits: number };

/** Ordre d'affichage : Europe, États-Unis, matières premières, change, crypto. */
export const INSTRUMENTS: readonly Instrument[] = [
  { symbol: '^FCHI', label: 'CAC 40', digits: 2 },
  { symbol: '^STOXX50E', label: 'Euro Stoxx 50', digits: 2 },
  { symbol: '^IBEX', label: 'IBEX 35', digits: 2 },
  { symbol: '^FTSE', label: 'FTSE 100', digits: 2 },
  { symbol: '^GSPC', label: 'S&P 500', digits: 2 },
  { symbol: '^IXIC', label: 'Nasdaq', digits: 2 },
  { symbol: 'BZ=F', label: 'Brent', digits: 2 },
  { symbol: 'EURUSD=X', label: 'EUR/USD', digits: 4 },
  { symbol: 'BTC-USD', label: 'Bitcoin', digits: 0 },
];

export const SPARK_URL = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${INSTRUMENTS.map((i) => encodeURIComponent(i.symbol)).join(',')}&range=1d&interval=1d`;

/** Au moins autant d'instruments lisibles, sinon le bloc est masqué (réponse tronquée ou format changé). */
export const MIN_QUOTES = 4;

export type Quote = {
  symbol: string;
  label: string;
  digits: number;
  price: number;
  /** Variation du jour en %, par rapport à la clôture précédente. */
  change: number;
  /** Heure du cours (ISO, UTC). */
  time: string;
};

const finite = z.number().refine(Number.isFinite);

const MetaSchema = z.object({
  symbol: z.string().max(20),
  regularMarketPrice: finite.refine((n) => n > 0),
  regularMarketChangePercent: finite.optional(),
  chartPreviousClose: finite.refine((n) => n > 0).optional(),
  regularMarketTime: z.number().int().positive(),
});

const SparkSchema = z.object({
  spark: z.object({
    result: z
      .array(z.object({ symbol: z.string().max(20), response: z.array(z.object({ meta: z.unknown() })).max(5) }))
      .max(50),
  }),
});

/**
 * Réponse de `spark` → cours, dans l'ordre de INSTRUMENTS. Un instrument illisible est ignoré ; une
 * variation absurde (plus de 50 % en un jour) aussi. null si la réponse n'a pas la forme attendue ou
 * compte moins de MIN_QUOTES cours lisibles.
 */
export function parseSpark(json: unknown): Quote[] | null {
  const parsed = SparkSchema.safeParse(json);
  if (!parsed.success) return null;
  const metas = new Map<string, z.infer<typeof MetaSchema>>();
  for (const r of parsed.data.spark.result) {
    const meta = MetaSchema.safeParse(r.response[0]?.meta);
    if (meta.success && meta.data.symbol === r.symbol) metas.set(r.symbol, meta.data);
  }
  const quotes: Quote[] = [];
  for (const ins of INSTRUMENTS) {
    const m = metas.get(ins.symbol);
    if (!m) continue;
    const change = m.regularMarketChangePercent ?? (m.chartPreviousClose ? (m.regularMarketPrice / m.chartPreviousClose - 1) * 100 : NaN);
    if (!Number.isFinite(change) || Math.abs(change) > 50) continue;
    quotes.push({ ...ins, price: m.regularMarketPrice, change, time: new Date(m.regularMarketTime * 1000).toISOString() });
  }
  return quotes.length >= MIN_QUOTES ? quotes : null;
}

const nf = (digits: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** « 7 990,64 » (espaces fines insécables de fr-FR remplacées par des espaces insécables, plus sûres). */
export const formatPrice = (q: Pick<Quote, 'price' | 'digits'>) => nf(q.digits).format(q.price).replace(/ /g, ' ');

/** « +0,42 % », « −1,12 % » (vrai signe moins), « 0,00 % ». */
export function formatChange(change: number): string {
  const rounded = Math.round(change * 100) / 100;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${nf(2).format(Math.abs(rounded))} %`;
}

export const direction = (change: number): 'up' | 'down' | 'flat' => (Math.round(change * 100) === 0 ? 'flat' : change > 0 ? 'up' : 'down');
