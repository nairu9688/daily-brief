import type { Lang } from '@daily-brief/schema';

export type Rule = 'SCHEMA' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12';

/**
 * error   : l'édition ne peut pas être contrôlée (schéma invalide, fichier manquant) ;
 * fixed   : une violation a été corrigée automatiquement (élément retiré, sujet rétrogradé) ;
 * warning : signalement sans correction (objectif non atteint, à améliorer à la rédaction).
 */
export type Issue = { rule: Rule; level: 'error' | 'fixed' | 'warning'; lang?: Lang; storyId?: string; message: string };

/** 0 = propre (avertissements seulement), 1 = corrections appliquées, 2 = au moins une erreur. */
export function exitCodeFor(issues: Issue[]): 0 | 1 | 2 {
  if (issues.some((i) => i.level === 'error')) return 2;
  if (issues.some((i) => i.level === 'fixed')) return 1;
  return 0;
}

export function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return 'Aucun problème.';
  return issues
    .map((i) => `[${i.level}] ${i.rule}${i.lang ? ' ' + i.lang.toUpperCase() : ''}${i.storyId ? ' ' + i.storyId : ''} : ${i.message}`)
    .join('\n');
}
