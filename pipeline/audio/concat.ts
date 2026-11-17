import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseMp3 } from './mp3';

const run = promisify(execFile);

/** Débit de sortie visé (spec §9) : 64 kb/s, mono. */
export const TARGET_BITRATE = '64k';
/** Délai d'un appel à ffmpeg. */
export const FFMPEG_TIMEOUT_MS = 120_000;

export type ConcatMethod = 'ffmpeg' | 'frames';

export type ConcatResult = {
  bytes: Buffer;
  /** Durée mesurée sur les trames du fichier produit. */
  seconds: number;
  method: ConcatMethod;
  /** Repli sur la concaténation des trames après un échec de ffmpeg (message court). */
  warnings: string[];
};

/**
 * Chemin de ffmpeg : `FFMPEG_PATH` s'il est défini, sinon `ffmpeg` s'il répond à `-version`
 * dans le PATH, sinon null (le conteneur de la routine peut ne pas l'avoir, spec §16).
 */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidate = env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const r = spawnSync(candidate, ['-hide_banner', '-version'], { stdio: 'ignore', timeout: 10_000 });
  return r.status === 0 ? candidate : null;
}

/**
 * Concaténation sans ffmpeg : étiquettes ID3 et trames Xing/Info retirées, trames audio mises
 * bout à bout. Les morceaux doivent avoir le même format (version, fréquence, mono) ; le débit
 * reste celui de la source (pas de réencodage possible sans encodeur).
 */
export function concatFrames(chunks: Uint8Array[]): ConcatResult {
  if (chunks.length === 0) throw new Error('aucun morceau à concaténer');
  const parsed = chunks.map((c, i) => {
    try {
      return parseMp3(c);
    } catch (e) {
      throw new Error(`morceau ${i + 1} : ${(e as Error).message}`);
    }
  });
  const first = parsed[0];
  parsed.forEach((p, i) => {
    if (p.version !== first.version || p.sampleRate !== first.sampleRate || p.mono !== first.mono) {
      throw new Error(`morceau ${i + 1} : format différent du premier (${p.sampleRate} Hz contre ${first.sampleRate} Hz)`);
    }
  });
  const bytes = Buffer.concat(parsed.flatMap((p) => p.frames));
  return { bytes, seconds: parsed.reduce((s, p) => s + p.seconds, 0), method: 'frames', warnings: [] };
}

/**
 * Concaténation par ffmpeg (démultiplexeur `concat`), réencodée en MP3 64 kb/s mono, sans
 * métadonnées ni étiquette ID3. La durée est relue sur les trames du fichier produit.
 */
export async function concatWithFfmpeg(chunks: Uint8Array[], ffmpeg: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ConcatResult> {
  if (chunks.length === 0) throw new Error('aucun morceau à concaténer');
  const dir = mkdtempSync(join(tmpdir(), 'brief-audio-'));
  try {
    const names = chunks.map((c, i) => {
      const name = `chunk-${String(i).padStart(3, '0')}.mp3`;
      writeFileSync(join(dir, name), c);
      return name;
    });
    writeFileSync(join(dir, 'list.txt'), names.map((n) => `file '${n}'\n`).join(''));
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-vn', '-map_metadata', '-1', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', TARGET_BITRATE, '-id3v2_version', '0', '-f', 'mp3', 'out.mp3'];
    await run(ffmpeg, args, { cwd: dir, timeout: opts.timeoutMs ?? FFMPEG_TIMEOUT_MS, signal: opts.signal, maxBuffer: 1024 * 1024 });
    const bytes = readFileSync(join(dir, 'out.mp3'));
    return { bytes, seconds: parseMp3(bytes).seconds, method: 'ffmpeg', warnings: [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Première ligne d'une erreur de ffmpeg, bornée (jamais la sortie complète). */
function ffmpegError(e: unknown): string {
  const err = e as { killed?: boolean; code?: unknown; stderr?: string; message?: string };
  if (err.killed) return 'délai dépassé';
  const line = (err.stderr || err.message || String(e)).split('\n').find((l) => l.trim()) ?? 'erreur inconnue';
  return line.trim().slice(0, 200);
}

/**
 * Concatène les morceaux MP3 : avec ffmpeg s'il est disponible (64 kb/s mono), sinon, ou si
 * ffmpeg échoue, par concaténation des trames (avec un avertissement dans le second cas).
 */
export async function concatMp3(chunks: Uint8Array[], ffmpeg: string | null, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ConcatResult> {
  if (ffmpeg) {
    try {
      return await concatWithFfmpeg(chunks, ffmpeg, opts);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      let r: ConcatResult;
      try {
        r = concatFrames(chunks);
      } catch (e2) {
        throw new Error(`${(e2 as Error).message} (ffmpeg : ${ffmpegError(e)})`);
      }
      return { ...r, warnings: [`ffmpeg en échec (${ffmpegError(e)}) : trames concaténées sans réencodage`] };
    }
  }
  return concatFrames(chunks);
}
