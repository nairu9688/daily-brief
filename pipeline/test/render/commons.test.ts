import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PhotoSchema } from '@daily-brief/schema';
import { HttpError } from '../../collect/http';
import { cleanAuthor, COMMONS_API, findCommonsPhoto, pickPhoto, WIKIMEDIA_USER_AGENT } from '../../render/commons';
import { repoPath } from '../helpers';
import { fakeFetch } from './fake-fetch';

/** Réponse réelle de l'API (« high-speed train », 10 fichiers), enregistrée le 19/11/2026. */
const search = JSON.parse(readFileSync(repoPath('fixtures/api/commons-search.json'), 'utf8'));
type Page = (typeof search.query.pages)[number];

const TGV = {
  provider: 'wikimedia',
  src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6f/SNCF_TGV_Duplex_Viaduc_de_Cize_-_Bolozon.jpg/1920px-SNCF_TGV_Duplex_Viaduc_de_Cize_-_Bolozon.jpg',
  width: 1600,
  height: 1067,
  author: 'Kabelleger / David Gubler (http://www.bahnbilder.ch)',
  license: 'CC BY-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:SNCF_TGV_Duplex_Viaduc_de_Cize_-_Bolozon.jpg',
};

/** Réponse dont les pages sont modifiées (copie). */
const withPages = (edit: (pages: Page[]) => Page[]) => {
  const s = structuredClone(search);
  s.query.pages = edit(s.query.pages);
  return s;
};
const tgv = (pages: Page[]) => pages.find((p) => p.index === 1)!;
const meta = (p: Page) => p.imageinfo[0].extmetadata;

describe('pickPhoto', () => {
  it('retient la première photo paysage libre, dans l’ordre du moteur, et la valide', () => {
    const photo = pickPhoto(search);
    expect(photo).toEqual(TGV);
    expect(PhotoSchema.safeParse(photo).success).toBe(true);
  });

  it('écarte portraits, carrés, panoramas, petits fichiers et svg', () => {
    // Sans le TGV : le seul autre JPEG paysage est le 1280×720 (index 5) ; les portraits 720×1280 sont écartés.
    const r = pickPhoto(withPages((ps) => ps.filter((p) => p.index !== 1)));
    expect(r?.pageUrl).toBe('https://commons.wikimedia.org/wiki/File:Belyi_Krechet_russian_high-speed_train_concept_01.jpg');
    // Sans aucun JPEG paysage : le PNG le mieux classé (index 2) ; le « line scan » (3) et le schéma presque carré (4) sont écartés.
    const png = pickPhoto(withPages((ps) => ps.filter((p) => p.index !== 1 && p.index !== 5)));
    expect(png?.pageUrl).toBe('https://commons.wikimedia.org/wiki/File:Jakarta-Bandung_High_Speed_Train_1.png');
    expect(png?.license).toBe('CC BY 3.0');
    const small = withPages((ps) => {
      Object.assign(tgv(ps).imageinfo[0], { width: 900, height: 600 });
      return [tgv(ps)];
    });
    expect(pickPhoto(small)).toBeNull();
    const svg = withPages((ps) => {
      tgv(ps).imageinfo[0].mime = 'image/svg+xml';
      return [tgv(ps)];
    });
    expect(pickPhoto(svg)).toBeNull();
    const square = withPages((ps) => {
      Object.assign(tgv(ps).imageinfo[0], { width: 3000, height: 2900 });
      return [tgv(ps)];
    });
    expect(pickPhoto(square)).toBeNull();
  });

  it('préfère un JPEG à un PNG mieux classé', () => {
    const r = pickPhoto(withPages((ps) => ps.filter((p) => [1, 2, 6].includes(p.index)).map((p) => (p.index === 1 ? { ...p, index: 50 } : p))));
    expect(r?.pageUrl).toBe(TGV.pageUrl);
  });

  it('refuse les licences NC, ND, inconnues ou non libres, et la restriction « personality »', () => {
    for (const patch of [
      { LicenseShortName: { value: 'CC BY-NC-SA 4.0' } },
      { LicenseShortName: { value: 'CC BY-ND 4.0' } },
      { LicenseShortName: { value: 'Fair use' } },
      { LicenseShortName: undefined },
      { NonFree: { value: 'true' } },
      { Restrictions: { value: 'personality' } },
      { Restrictions: { value: 'trademarked|personality' } },
    ]) {
      const one = withPages((ps) => {
        Object.assign(meta(tgv(ps)), patch);
        return [tgv(ps)];
      });
      expect(pickPhoto(one), JSON.stringify(patch)).toBeNull();
    }
  });

  it('accepte le domaine public et CC0, sans lien de licence au besoin', () => {
    const pd = withPages((ps) => {
      Object.assign(meta(tgv(ps)), { LicenseShortName: { value: 'Public domain' }, LicenseUrl: undefined });
      return [tgv(ps)];
    });
    expect(pickPhoto(pd)).toEqual({ ...Object.fromEntries(Object.entries(TGV).filter(([k]) => k !== 'licenseUrl')), license: 'Public domain' });
    const cc0 = withPages((ps) => {
      Object.assign(meta(tgv(ps)), { LicenseShortName: { value: 'CC0' }, LicenseUrl: { value: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en' } });
      return [tgv(ps)];
    });
    expect(pickPhoto(cc0)).toMatchObject({ license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en' });
  });

  it('omet un lien de licence hors de creativecommons.org', () => {
    const r = pickPhoto(withPages((ps) => {
      meta(tgv(ps)).LicenseUrl = { value: 'https://evil.example/licence' };
      return [tgv(ps)];
    }));
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('licenseUrl');
  });

  it('refuse une image ou une page hors des hôtes Wikimedia (jamais téléchargée)', () => {
    for (const patch of [
      { thumburl: 'http://169.254.169.254/latest/meta-data/x.jpg' },
      { thumburl: 'https://upload.wikimedia.org.evil.example/x.jpg' },
      { thumburl: 'https://user@upload.wikimedia.org/x.jpg' },
      { descriptionurl: 'https://evil.example/wiki/File:x.jpg' },
    ]) {
      const one = withPages((ps) => {
        Object.assign(tgv(ps).imageinfo[0], patch);
        return [tgv(ps)];
      });
      expect(pickPhoto(one), JSON.stringify(patch)).toBeNull();
    }
  });

  it('refuse une photo sans auteur', () => {
    const r = pickPhoto(withPages((ps) => {
      meta(tgv(ps)).Artist = { value: '<span> </span>' };
      return [tgv(ps)];
    }));
    expect(r).toBeNull();
  });

  it('renvoie null sans résultat et ignore une page mal formée', () => {
    expect(pickPhoto({ batchcomplete: true })).toBeNull();
    expect(pickPhoto(withPages((ps) => [{ title: 'File:x.jpg' } as Page, tgv(ps)]))).toEqual(TGV);
  });

  it('prend l’original quand il n’y a pas de vignette plus petite, et ses dimensions', () => {
    const r = pickPhoto(withPages((ps) => {
      const p = tgv(ps);
      Object.assign(p.imageinfo[0], { width: 1500, height: 1000, size: 900_000, thumburl: p.imageinfo[0].url, thumbwidth: 1600, thumbheight: 1067 });
      return [p];
    }));
    expect(r).toMatchObject({ src: 'https://upload.wikimedia.org/wikipedia/commons/6/6f/SNCF_TGV_Duplex_Viaduc_de_Cize_-_Bolozon.jpg', width: 1500, height: 1000 });
    const heavy = pickPhoto(withPages((ps) => {
      const p = tgv(ps);
      Object.assign(p.imageinfo[0], { width: 1500, height: 1000, size: 4_000_000, thumburl: p.imageinfo[0].url });
      return [p];
    }));
    expect(heavy).toBeNull();
  });
});

describe('cleanAuthor', () => {
  it('retire le HTML, décode les entités, ramène les espaces et borne la longueur', () => {
    expect(cleanAuthor('<a href="//commons.wikimedia.org/wiki/User:X">Jo &amp; Ana</a>\n  <i>Studio</i>')).toBe('Jo & Ana Studio');
    expect(cleanAuthor('&lt;script&gt;alert(1)&lt;/script&gt; &#233;t&#xE9;')).toBe('<script>alert(1)</script> été');
    expect(cleanAuthor('<script>alert(1)</script>Nom<style>x{}</style>')).toBe('Nom');
    expect(cleanAuthor('a\u0000b​c')).toBe('a b c');
    const long = cleanAuthor('x'.repeat(200));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('findCommonsPhoto', () => {
  it('interroge l’API de Commons (fichiers, bitmaps, vignette 1600 px) avec un agent générique', async () => {
    const { fetch, calls } = fakeFetch({ [COMMONS_API]: { json: search } });
    expect(await findCommonsPhoto('high-speed train', { fetch })).toEqual(TGV);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(COMMONS_API);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'search',
      gsrsearch: 'high-speed train filetype:bitmap',
      gsrnamespace: '6',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|mime|size',
      iiurlwidth: '1600',
    });
    expect(calls[0].headers).toMatchObject({ 'User-Agent': WIKIMEDIA_USER_AGENT, 'Api-User-Agent': WIKIMEDIA_USER_AGENT });
    expect(WIKIMEDIA_USER_AGENT).toBe('DailyBrief/1.0 (personal news digest)');
  });

  it('lève HttpError sur un statut en erreur et une erreur sur une réponse d’erreur de l’API', async () => {
    const denied = fakeFetch({ [COMMONS_API]: { status: 403, json: {} } });
    await expect(findCommonsPhoto('x', { fetch: denied.fetch })).rejects.toBeInstanceOf(HttpError);
    const apiError = fakeFetch({ [COMMONS_API]: { json: { error: { code: 'maxlag', info: 'Waiting' } } } });
    await expect(findCommonsPhoto('x', { fetch: apiError.fetch })).rejects.toThrow(/Commons : maxlag/);
  });

  it('refuse un corps trop lourd et abandonne après le délai', async () => {
    const big = fakeFetch({ [COMMONS_API]: { json: search, length: String(2_000_000) } });
    await expect(findCommonsPhoto('x', { fetch: big.fetch })).rejects.toThrow(/trop lourd/);
    const slow = fakeFetch({ [COMMONS_API]: { hang: true } });
    await expect(findCommonsPhoto('x', { fetch: slow.fetch, timeoutMs: 20 })).rejects.toThrow();
  });
});
