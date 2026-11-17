// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANARIES, NEEDLES, scanBundle } from '../../scripts/check-bundle';

describe('contrôle du code envoyé au navigateur', () => {
  it('trouve une valeur témoin ou un nom de variable serveur, et rien dans un fichier propre', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    mkdirSync(join(dir, 'chunks'));
    writeFileSync(join(dir, 'chunks/a.js'), 'const x = "propre";');
    writeFileSync(join(dir, 'chunks/b.js'), `const k = "${CANARIES.ALLOWED_EMAIL}"; // service_role, process.env.ALLOWED_EMAIL`);
    expect(scanBundle(dir)).toEqual([
      ['chunks/b.js', 'service_role'],
      ['chunks/b.js', 'ALLOWED_EMAIL'],
      ['chunks/b.js', CANARIES.ALLOWED_EMAIL],
    ]);
    expect(NEEDLES).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
