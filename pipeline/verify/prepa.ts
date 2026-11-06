/** Lit `programme-ect.md` : renvoie alias en minuscules → matière canonique. */
export function parseProgrammeSubjects(md: string): Map<string, string> {
  const subjects = new Map<string, string>();
  let current: string | null = null;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = h[1].normalize('NFC');
      subjects.set(current.toLowerCase(), current);
      continue;
    }
    const a = line.match(/^Alias\s*:\s*(.+)$/i);
    if (a && current) for (const alias of a[1].split(',')) subjects.set(alias.trim().normalize('NFC').toLowerCase(), current);
  }
  return subjects;
}

/** R9 : chaque partie de « Anglais LV1 · CG » doit être une matière ou un alias connus. */
export function isKnownPrepaSubject(subject: string, subjects: Map<string, string>): boolean {
  const parts = subject.normalize('NFC').split('·').map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => subjects.has(p));
}
