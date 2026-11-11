import { describe, expect, it } from 'vitest';
import { articleId, makeArticle, plainText, toIso } from '../../collect/article';
import { Breaker, recordFailure } from '../../collect/breaker';
import { BodyError, decodeBody, HttpError, messageOf, readCapped, fetchJson } from '../../collect/http';
import { mapLimit } from '../../collect/limit';
import { redactUrl, stripSecrets } from '../../collect/redact';
import { emptyRun } from '../../collect/types';
import { addDays } from '../../lib/date';
import { loadWhitelist, WhitelistSchema } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';
import { fakeHttp } from './fake-http';

const wl = loadWhitelist(WHITELIST_PATH);

describe('http : corps annulé, cause réseau, charset', () => {
  it('annule le corps avant de lever (content-length excessif et statut non 2xx)', async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
    const big = { ok: true, status: 200, headers: { get: (n: string) => (n === 'content-length' ? '999' : null) }, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0), body };
    await expect(readCapped(big, 10)).rejects.toBeInstanceOf(BodyError);
    expect(cancelled).toBe(1);
    const body2 = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
    const bad = { ok: false, status: 500, headers: { get: () => null }, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0), body: body2 };
    await expect(fetchJson(async () => bad, 'https://a/x', { timeoutMs: 100 })).rejects.toBeInstanceOf(HttpError);
    expect(cancelled).toBe(2);
  });

  it('messageOf ajoute cause.code', () => {
    const e = new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
    expect(messageOf(e)).toBe('fetch failed (ECONNREFUSED)');
    expect(messageOf(new Error('simple'))).toBe('simple');
    expect(messageOf('texte')).toBe('texte');
  });

  it('decodeBody : BOM, en-tête, puis déclaration XML ou meta, sinon UTF-8', () => {
    const latin = (s: string) => Buffer.from(s, 'latin1');
    expect(decodeBody(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('café')]), 'text/html; charset=iso-8859-1')).toBe('café');
    expect(decodeBody(latin('café'), 'text/html; charset=iso-8859-1')).toBe('café');
    expect(decodeBody(latin('<?xml version="1.0" encoding="ISO-8859-1"?><t>café</t>'), 'application/xml')).toBe('<?xml version="1.0" encoding="ISO-8859-1"?><t>café</t>');
    expect(decodeBody(latin('<html><head><meta charset="iso-8859-1"></head>café'), 'text/html')).toContain('café');
    expect(decodeBody(latin('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">café'), null)).toContain('café');
    expect(decodeBody(Buffer.from('<p>café</p>'), 'text/html')).toBe('<p>café</p>');
  });
});

describe('disjoncteur : coupure unique, délais undici', () => {
  it('garde la première raison et ne répète pas « source coupée »', () => {
    const run = emptyRun();
    const b = new Breaker();
    expect(recordFailure(run, b, 'a', new HttpError(429, 'https://a'))).toBe(true);
    expect(recordFailure(run, b, 'b', new HttpError(403, 'https://a'))).toBe(true);
    expect(b.reason).toBe('HTTP 429');
    expect(run.stoppedBy).toBe('HTTP 429');
    expect(run.errors).toHaveLength(1);
  });

  it('traite les délais undici comme des délais', () => {
    for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
      const e = new TypeError('fetch failed', { cause: Object.assign(new Error('t'), { code }) });
      expect(new Breaker().trip(e)).toBe(true);
    }
    expect(new Breaker().trip(new TypeError('fetch failed', { cause: Object.assign(new Error('t'), { code: 'ECONNREFUSED' }) }))).toBe(false);
  });
});

describe('mapLimit : robustesse', () => {
  it('refuse une limite qui n’est pas un entier positif', async () => {
    for (const l of [0, -1, 1.5, Number.NaN]) await expect(mapLimit([1], l, async (x) => x)).rejects.toBeInstanceOf(RangeError);
  });

  it('cesse de prendre des éléments après un rejet et le propage', async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5, 6], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });
});

describe('article : entités, code points, dates, R1', () => {
  it('décode les entités nommées courantes', () => {
    expect(plainText('l&rsquo;&eacute;t&eacute; &laquo;&nbsp;oui&nbsp;&raquo; &hellip; 5&euro; 10&deg; &ntilde; &oelig;uvre &Eacute;')).toBe('l’été « oui » … 5€ 10° ñ œuvre É');
    expect(plainText('&inconnu;')).toBe('&inconnu;');
  });

  it('aucune balise ne survit, même encodée', () => {
    expect(plainText('&lt;b&gt;gras&lt;/b&gt; <i>x</i>')).not.toMatch(/[<>]/);
    expect(plainText('&lt;script&gt;alert(1)&lt;/script&gt;')).not.toMatch(/[<>]/);
  });

  it('tronque la description sur des points de code, sans substitut orphelin', () => {
    const { article } = makeArticle({ url: 'https://a.fr/x', title: 'T', lang: 'fr', origin: 'rss', description: '😀'.repeat(700) }, wl);
    expect(Array.from(article!.description!)).toHaveLength(600);
    expect((article!.description as string & { isWellFormed(): boolean }).isWellFormed()).toBe(true);
  });

  it('toIso suppose UTC sans décalage', () => {
    expect(toIso('2026-11-06T05:00:00')).toBe('2026-11-06T05:00:00.000Z');
    expect(toIso('2026-11-06T05:00:00+01:00')).toBe('2026-11-06T04:00:00.000Z');
    expect(toIso('2026-11-06')).toBe('2026-11-06T00:00:00.000Z');
  });

  it('R1 : hôtes trompeurs, majuscules et www', () => {
    const t = (url: string) => makeArticle({ url, title: 'T', lang: 'fr', origin: 'exa', text: 'texte' }, wl).article?.text;
    expect(t('https://fr.euronews.com.evil.com/a')).toBeNull();
    expect(t('https://evileuronews.com/a')).toBeNull();
    expect(t('https://FR.EURONEWS.COM/a')).toBe('texte');
    expect(t('https://www.sudradio.fr/a')).toBe('texte');
    expect(articleId('https://a')).toMatch(/^a-[0-9a-f]{16}$/);
  });
});

describe('date, liste blanche, masquage', () => {
  it('addDays refuse un décalage non entier', () => {
    for (const d of [1.5, Number.NaN, Infinity]) expect(() => addDays('2026-11-06', d)).toThrow('décalage de jours invalide');
  });

  it('la liste blanche refuse un domaine avec www., majuscules ou chemin ; le fichier actuel passe', () => {
    const entry = (domain: string) => ({ checkedAt: 'x', domains: [{ domain, country: 'FR', status: 'full' }] });
    expect(WhitelistSchema.safeParse(entry('exemple.fr')).success).toBe(true);
    for (const d of ['www.exemple.fr', 'Exemple.fr', 'exemple.fr/x', 'exemple fr']) expect(WhitelistSchema.safeParse(entry(d)).success, d).toBe(false);
  });

  it('redactUrl : ; et &amp; avant le nom, noms en majuscules, apiKey, key, valeur encodée', () => {
    expect(redactUrl('https://a/x?q=1;api_token=S1')).toBe('https://a/x?q=1;api_token=***');
    expect(redactUrl('https://a/x?q=1&amp;token=S2&amp;z=1')).toBe('https://a/x?q=1&amp;token=***&amp;z=1');
    expect(redactUrl('https://a/x?API_TOKEN=S3')).toBe('https://a/x?API_TOKEN=***');
    expect(redactUrl('https://a/x?apiKey=S4&key=S5')).toBe('https://a/x?apiKey=***&key=***');
    expect(redactUrl('https://a/x?token=ab%2fcd%2Fef&n=1')).toBe('https://a/x?token=***&n=1');
  });
});

describe('relecture : balises, secrets, entités, charset', () => {
  it('garde « < » et « > » isolés mais retire les balises, même encodées', () => {
    expect(plainText('Inflation &lt; 2 % et chômage &gt; 7 %')).toBe('Inflation < 2 % et chômage > 7 %');
    expect(plainText('&lt;script&gt;alert(1)&lt;/script&gt;ok')).toBe('alert(1) ok');
    expect(plainText('&lt;b&gt;gras&lt;/b&gt; <i>x</i> <!-- c -->')).not.toMatch(/[<>]/);
  });

  it('stripSecrets masque la forme encodée en minuscules', () => {
    expect(stripSecrets('k%2f%2bsec', ['k/+sec'])).toBe('***');
    expect(stripSecrets('k%2F%2Bsec', ['k/+sec'])).toBe('***');
  });

  it('décode les majuscules accentuées, laisse intact ce qui est inconnu', () => {
    expect(plainText('&Ccedil;a &Egrave;re &Ecirc;tre &OElig;uvre &Euml; &Iuml; &Icirc; &Ocirc; &Ucirc; &Uacute; &Ntilde; &Aacute; &Oacute; &Iacute; &Agrave; &Acirc;')).toBe(
      'Ça Ère Être Œuvre Ë Ï Î Ô Û Ú Ñ Á Ó Í À Â',
    );
    expect(plainText('&Zzzz; &EACUTE;')).toBe('&Zzzz; &EACUTE;');
  });

  it('charset : utf-16 annoncé donne utf-8, BOM utf-16 reconnus', () => {
    expect(decodeBody(Buffer.from('<?xml version="1.0" encoding="utf-16"?><t>café</t>'), 'application/xml')).toContain('café');
    expect(decodeBody(Buffer.from('<meta charset="utf-16">café'), 'text/html')).toContain('café');
    expect(decodeBody(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('café', 'utf16le')]), null)).toBe('café');
    const be = Buffer.from('café', 'utf16le').swap16();
    expect(decodeBody(Buffer.concat([Buffer.from([0xfe, 0xff]), be]), 'text/html; charset=utf-8')).toBe('café');
  });
});
