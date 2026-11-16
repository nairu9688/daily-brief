import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { redactText as collectRedactText, stripSecrets as collectStripSecrets } from '../../collect/redact';
import { loadEnv } from '../../lib/env';
import { writeAtomic } from '../../lib/fs';
import { redactText, stripSecrets } from '../../lib/redact';
import { cmp, langRank } from '../../lib/sort';

const tmp = () => mkdtempSync(join(tmpdir(), 'lib-'));

describe('loadEnv', () => {
  afterEach(() => {
    delete process.env.LOADENV_TEST_EMPTY;
    delete process.env.LOADENV_TEST_SET;
  });

  it('retire une variable listée définie mais vide pour que .env la remplisse, sans écraser une variable renseignée', () => {
    const file = join(tmp(), '.env');
    writeFileSync(file, 'LOADENV_TEST_EMPTY=depuis-env\nLOADENV_TEST_SET=du-fichier\n');
    process.env.LOADENV_TEST_EMPTY = '  ';
    process.env.LOADENV_TEST_SET = 'du-processus';
    loadEnv(['LOADENV_TEST_EMPTY', 'LOADENV_TEST_SET'], file);
    expect(process.env.LOADENV_TEST_EMPTY).toBe('depuis-env');
    expect(process.env.LOADENV_TEST_SET).toBe('du-processus');
  });

  it('ignore l’absence de fichier mais remonte toute autre erreur', () => {
    const dir = tmp();
    expect(() => loadEnv([], join(dir, 'absent.env'))).not.toThrow();
    mkdirSync(join(dir, 'dossier.env'));
    expect(() => loadEnv([], join(dir, 'dossier.env'))).toThrow();
  });
});

describe('writeAtomic', () => {
  it('écrit via un fichier temporaire renommé', () => {
    const p = join(tmp(), 'a.json');
    writeAtomic(p, 'un');
    writeAtomic(p, 'deux');
    expect(readFileSync(p, 'utf8')).toBe('deux');
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });

  it('remonte l’erreur et ne laisse aucun fichier temporaire simple', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'cible'));
    expect(() => writeAtomic(join(dir, 'cible'), 'x')).toThrow();
    expect(existsSync(join(dir, 'cible.tmp'))).toBe(false);
  });
});

describe('utilitaires partagés', () => {
  it('collect/redact réexporte lib/redact', () => {
    expect(collectStripSecrets).toBe(stripSecrets);
    expect(collectRedactText).toBe(redactText);
    expect(redactText('https://a/x?api_token=abc&b=1', [])).toBe('https://a/x?api_token=***&b=1');
  });

  it('cmp et langRank : ordre binaire, FR < EN < ES < autres', () => {
    expect(['b', 'a', 'B'].sort(cmp)).toEqual(['B', 'a', 'b']);
    expect(['es', 'xx', 'fr', 'en'].sort((a, b) => langRank(a) - langRank(b))).toEqual(['fr', 'en', 'es', 'xx']);
  });
});
