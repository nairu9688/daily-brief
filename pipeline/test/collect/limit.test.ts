import { describe, expect, it } from 'vitest';
import { mapLimit } from '../../collect/limit';

describe('mapLimit', () => {
  it('borne la concurrence et garde l’ordre', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });

  it('n’appelle rien sur une liste vide', async () => {
    let calls = 0;
    expect(await mapLimit([], 4, async () => ++calls)).toEqual([]);
    expect(calls).toBe(0);
  });
});
