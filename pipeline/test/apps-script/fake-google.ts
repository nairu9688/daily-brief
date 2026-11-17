import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { repoPath } from '../helpers';

export type FakeFile = { id: string; name: string; mimeType: string; bytes: Buffer; trashed: boolean };
export type FakeFolder = { id: string; name: string; trashed: boolean; folders: FakeFolder[]; files: FakeFile[] };

const iterator = <T>(items: T[]) => {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++] };
};

/** Les fonctions et constantes de `apps-script/Code.gs`, telles qu'Apps Script les verrait. */
export type CodeGs = {
  doPost(e: unknown): { text: string; mime: string };
  handle(payload: unknown, props: unknown): { ok: boolean; error?: string; ids?: Record<string, string> };
  validatePayload(payload: unknown): { ok: boolean; error?: string };
  folderNames(date: string): { year: string; month: string };
  safeEqual(a: unknown, b: unknown): boolean;
  tokenMatches(expected: unknown, received: unknown): boolean;
  isRealDate(date: unknown): boolean;
  MONTHS: string[];
};

/**
 * Évalue `apps-script/Code.gs` dans un contexte Node isolé, avec de faux services Google en
 * mémoire : DriveApp (arborescence de dossiers), PropertiesService, LockService, Utilities et
 * ContentService. Aucun appel à Google.
 */
export function loadCodeGs(properties: Record<string, string> = {}) {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  const root: FakeFolder = { id: 'root', name: 'Mon Drive', trashed: false, folders: [], files: [] };
  const byId = new Map<string, FakeFolder>([[root.id, root]]);
  const state = { locked: false, lockAvailable: true, failCreateFile: false, failMessage: 'Service Drive indisponible : jeton interne xyz', creations: [] as string[] };

  const folderApi = (f: FakeFolder): Record<string, unknown> => ({
    getId: () => f.id,
    getName: () => f.name,
    isTrashed: () => f.trashed,
    getFoldersByName: (name: string) => iterator(f.folders.filter((c) => c.name === name).map(folderApi)),
    createFolder: (name: string) => {
      const child: FakeFolder = { id: nextId('folder'), name, trashed: false, folders: [], files: [] };
      f.folders.push(child);
      byId.set(child.id, child);
      state.creations.push(`dossier ${name}`);
      return folderApi(child);
    },
    getFilesByName: (name: string) =>
      iterator(
        f.files
          .filter((x) => x.name === name && !x.trashed)
          .map((x) => ({
            getId: () => x.id,
            setTrashed: (v: boolean) => {
              x.trashed = v;
            },
          })),
      ),
    createFile: (blob: { name: string; mimeType: string; bytes: Buffer }) => {
      if (state.failCreateFile) throw new Error(state.failMessage);
      const file: FakeFile = { id: nextId('file'), name: blob.name, mimeType: blob.mimeType, bytes: blob.bytes, trashed: false };
      f.files.push(file);
      state.creations.push(`fichier ${blob.name}`);
      return { getId: () => file.id };
    },
  });

  const props = {
    getProperty: (k: string) => (k in properties ? properties[k] : null),
    setProperty: (k: string, v: string) => {
      properties[k] = v;
    },
  };

  const sandbox: Record<string, unknown> = {
    DriveApp: {
      getRootFolder: () => folderApi(root),
      getFolderById: (id: string) => {
        const f = byId.get(id);
        if (!f) throw new Error('dossier introuvable');
        return folderApi(f);
      },
    },
    PropertiesService: { getScriptProperties: () => props },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (!state.lockAvailable) return false;
          state.locked = true;
          return true;
        },
        releaseLock: () => {
          state.locked = false;
        },
      }),
    },
    Utilities: {
      base64Decode: (s: string) => {
        // Strict comme Utilities.base64Decode : une chaîne qui n'est pas du base64 canonique lève une erreur.
        const bytes = Buffer.from(s, 'base64');
        if (bytes.toString('base64') !== s) throw new Error('Caractères non valides');
        return bytes;
      },
      newBlob: (bytes: Buffer, mimeType: string, name: string) => ({ bytes, mimeType, name }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => {
        const out = { text, mime: 'text/plain', setMimeType: (m: string) => ((out.mime = m), out) };
        return out;
      },
    },
  };
  vm.runInNewContext(readFileSync(repoPath('apps-script/Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });

  /** Arborescence lisible : « Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf ». */
  const tree = (f: FakeFolder = root, prefix = ''): string[] => [
    ...f.files.map((x) => `${prefix}${x.name}${x.trashed ? ' (corbeille)' : ''}`),
    ...f.folders.flatMap((c) => (c.trashed ? [`${prefix}${c.name}/ (corbeille)`] : tree(c, `${prefix}${c.name}/`))),
  ];
  const post = (body: unknown) => JSON.parse((sandbox as unknown as CodeGs).doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);

  return { gs: sandbox as unknown as CodeGs, root, byId, properties, props, state, tree, post };
}
