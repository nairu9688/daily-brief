import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import fixture from '@/lib/markets/fixture-spark.json';
import { parseSpark } from '@/lib/markets/parse';

const m = vi.hoisted(() => ({ quotes: null as unknown }));
vi.mock('@/lib/markets', () => ({ loadMarkets: async () => m.quotes }));

import { MarketsView, MarketsWidget } from '@/components/Markets';

describe('bloc « Marchés »', () => {
  it('montre chaque instrument, son cours, sa variation colorée et « Différé » avec l’heure de Paris', () => {
    const { container } = render(<MarketsView quotes={parseSpark(fixture)!} />);
    expect(screen.getByRole('heading', { name: 'Marchés' })).toBeTruthy();
    expect(container.querySelector('.mk-head span')!.textContent).toBe('Différé · 10:28');
    const cac = container.querySelector('li[data-symbol="^FCHI"]')!;
    expect(cac.textContent).toBe('CAC 407 990,64−1,11 %');
    expect(cac.querySelector('.mk-c')!.getAttribute('data-dir')).toBe('down');
    // S&P 500 : clôture de la veille, datée.
    expect(container.querySelector('li[data-symbol="^GSPC"]')!.getAttribute('title')).toBe('S&P 500 : cours de 19/11 22:59 (heure de Paris)');
    expect(container.querySelectorAll('li')).toHaveLength(9);
  });

  it('source en panne : rien, sans message', async () => {
    m.quotes = null;
    expect(await MarketsWidget()).toBeNull();
    m.quotes = parseSpark(fixture);
    expect(await MarketsWidget()).not.toBeNull();
  });
});
