import type { z } from 'zod';
import { BriefSchema, EditionSchema, type Brief, type Edition } from './edition';

export type ParseResult<T> = { success: true; data: T } | { success: false; errors: string[] };

function run<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const r = schema.safeParse(input);
  if (r.success) return { success: true, data: r.data };
  return {
    success: false,
    errors: r.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(racine)'} : ${i.message}`),
  };
}

export const parseEdition = (input: unknown): ParseResult<Edition> => run(EditionSchema, input);
export const parseBrief = (input: unknown): ParseResult<Brief> => run(BriefSchema, input);
