import type { Vocab } from '@daily-brief/schema';

const stem = (w: string) => w.slice(0, Math.max(4, Math.ceil(w.length * 0.6)));

/**
 * R10 (avertissement) : au moins un mot porteur de la locution (4 lettres ou plus)
 * apparaît dans la phrase exemple, au radical près (« flip » → « flipped », « listas electorales » → « listas »).
 * Sans mot de 4 lettres, un mot du terme doit y figurer en entier (« GDP »).
 */
export function vocabWarnings(vocab: Vocab): string[] {
  return vocab.items.flatMap((item) => {
    const example = item.example.toLowerCase();
    const terms = item.term.toLowerCase().split(/[^\p{L}-]+/u).filter(Boolean);
    const long = terms.filter((w) => w.length >= 4);
    const wholeWord = (w: string) => new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(example);
    const found =
      terms.length === 0 || (long.length > 0 ? long.some((w) => example.includes(stem(w))) : terms.some(wholeWord));
    return found ? [] : [`« ${item.term} » absent de sa phrase exemple`];
  });
}
