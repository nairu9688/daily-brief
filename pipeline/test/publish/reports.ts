import { DAY } from './day';

/** Rapports des étapes précédentes, à la forme écrite par `brief:context`, `brief:collect` et `brief:verify`. */
export function stepReports(date: string = DAY): Record<string, string> {
  const context = {
    date,
    generatedAt: `${date}T04:13:05.000Z`,
    exitCode: 0,
    store: 'supabase',
    staleDays: 21,
    closedThreads: ['t-1'],
    openThreads: 5,
    yesterdayTopics: 9,
    issues: [{ level: 'warning', message: 'Thread t-9 : événement daté du 2026-12-25, à plus de 7 jours dans le futur' }],
  };
  const collect = {
    date,
    generatedAt: `${date}T04:18:40.000Z`,
    exitCode: 0,
    degraded: true,
    primary: 'thenewsapi',
    articles: 212,
    groups: 131,
    perLang: { fr: { articles: 90, fullTexts: 31, light: false }, en: { articles: 70, fullTexts: 22, light: false }, es: { articles: 52, fullTexts: 9, light: true } },
    sources: {},
    issues: [
      { level: 'error', source: 'webz', message: 'webz : HTTP 429 (https://api.webz.io/newsApiLite?token=***) — source coupée' },
      { level: 'warning', source: 'rss', message: 'democrata.es : HTTP 403' },
    ],
  };
  const verify = {
    date,
    generatedAt: `${date}T04:31:00.000Z`,
    exitCode: 1,
    editions: [
      { lang: 'fr', written: true },
      { lang: 'en', written: true },
      { lang: 'es', written: true },
    ],
    issues: [
      { rule: 'R5', level: 'fixed', lang: 'en', storyId: 'en-8', message: 'citation retirée' },
      { rule: 'R3', level: 'warning', lang: 'fr', message: 'un seul média' },
    ],
  };
  return {
    'context-report.json': JSON.stringify(context, null, 2),
    'collect-report.json': JSON.stringify(collect, null, 2),
    'verify-report.json': JSON.stringify(verify, null, 2),
  };
}
