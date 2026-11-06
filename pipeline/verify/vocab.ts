import type { Vocab } from '@daily-brief/schema';

const stem = (w: string) => w.slice(0, Math.max(4, Math.ceil(w.length * 0.6)));

/**
 * R10 (avertissement) : au moins un mot porteur de la locution (4 lettres ou plus)
 * apparaît dans la phrase exemple, au radical près (« flip » → « flipped », « listas electorales » → « listas »).
 */
export function vocabWarnings(vocab: Vocab): string[] {
  return vocab.items.flatMap((item) => {
    const example = item.example.toLowerCase();
    const words = item.term.toLowerCase().split(/[^\p{L}-]+/u).filter((w) => w.length >= 4);
    const found = words.length === 0 || words.some((w) => example.includes(stem(w)));
    return found ? [] : [`« ${item.term} » absent de sa phrase exemple`];
  });
}
