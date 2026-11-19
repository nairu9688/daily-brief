import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isFreeLicense, isHttpsUrlOn, parseEdition, PHOTO_IMAGE_HOSTS, PhotoSchema, sanitizeVisual, StorySchema, stripInvalidPhotos, VisualSchema, type Brief, type Photo } from '../src';

const fixture: Brief = JSON.parse(readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'));

const photo: Photo = {
  provider: 'wikimedia',
  src: 'https://upload.wikimedia.org/wikipedia/commons/6/6f/Train.jpg',
  width: 1600,
  height: 1067,
  author: 'Kabelleger',
  license: 'CC BY-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Train.jpg',
};

describe('isHttpsUrlOn', () => {
  it('refuse un port écrit (même :443), une tabulation ou un saut de ligne dans l’URL brute', () => {
    const hosts = PHOTO_IMAGE_HOSTS;
    for (const u of ['https://upload.wikimedia.org:443/a.jpg', 'https://upload.wikimedia.org:/a.jpg', 'https://upload.wiki\tmedia.org/a.jpg', 'https://upload.wikimedia.org/a\n.jpg', 'https://upload.wikimedia.org/a\r.jpg', 'https://@upload.wikimedia.org/a.jpg']) {
      expect(isHttpsUrlOn(u, hosts), JSON.stringify(u)).toBe(false);
    }
  });

  it('n’accepte que https sur l’hôte exact, sans identifiants ni port', () => {
    const hosts = PHOTO_IMAGE_HOSTS;
    expect(isHttpsUrlOn('https://upload.wikimedia.org/a.jpg', hosts)).toBe(true);
    expect(isHttpsUrlOn('https://thumb.wikimedia.org/a.jpg', hosts)).toBe(true);
    for (const u of [
      'http://upload.wikimedia.org/a.jpg',
      'https://upload.wikimedia.org.evil.example/a.jpg',
      'https://evil.example/upload.wikimedia.org/a.jpg',
      'https://user:pw@upload.wikimedia.org/a.jpg',
      'https://upload.wikimedia.org:8443/a.jpg',
      'https://169.254.169.254/latest/meta-data',
      'file:///etc/passwd',
      'pas une url',
    ]) {
      expect(isHttpsUrlOn(u, hosts), u).toBe(false);
    }
  });
});

describe('isFreeLicense', () => {
  it('admet CC0, le domaine public, CC BY et CC BY-SA (toute version)', () => {
    for (const l of ['CC0', 'CC0 1.0', 'Public domain', 'CC BY 4.0', 'CC BY 2.0', 'CC BY-SA 3.0', 'CC BY-SA 2.5 nl', 'CC BY-SA 3.0 igo', 'CC BY-SA 4.0', 'CC BY 1.0', 'CC BY-SA 2.0 de']) {
      expect(isFreeLicense(l), l).toBe(true);
    }
  });

  it('refuse NC, ND, les licences inconnues et l’usage loyal', () => {
    for (const l of ['CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'CC BY-ND 4.0', 'CC BY-NC-ND 3.0', 'GFDL', 'Fair use', 'All rights reserved', 'Attribution', '', 'CC BY-SA 4.0 <script>', 'CC BY 4.0 nc', 'CC BY 4.0 ND', 'CC BY-SA 2.0 NC', 'CC BY 4.0 sa', 'CC BY 9.9', 'CC BY 3.5', 'CC BY', 'CC BY-SA']) {
      expect(isFreeLicense(l), l).toBe(false);
    }
  });
});

describe('PhotoSchema', () => {
  it('accepte une photo Wikimedia conforme, avec ou sans lien de licence', () => {
    expect(PhotoSchema.safeParse(photo).success).toBe(true);
    const { licenseUrl: _, ...pd } = { ...photo, license: 'Public domain' };
    expect(PhotoSchema.safeParse(pd).success).toBe(true);
  });

  it('refuse une image, une page ou une licence hors des hôtes de confiance', () => {
    const bad: Partial<Record<keyof Photo, unknown>>[] = [
      { src: 'http://169.254.169.254/x.jpg' },
      { src: 'https://images.pexels.com/1.jpeg' },
      { src: 'https://upload.wikimedia.org.evil.example/x.jpg' },
      { src: 'https://upload.wikimedia.org/x.jpg?utm_source=x' },
      { pageUrl: 'https://evil.example/wiki/File:x.jpg' },
      { pageUrl: 'https://commons.wikimedia.org/wiki/User:X' },
      { licenseUrl: 'https://evil.example/license' },
      { licenseUrl: 'http://creativecommons.org/licenses/by/4.0' },
      { licenseUrl: undefined },
      { src: 'https://upload.wikimedia.org:443/x.jpg' },
      { src: 'https://upload.wikimedia.org/x.jpg#f' },
      { pageUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg?action=raw' },
      { pageUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg#x' },
      { pageUrl: 'https://commons.wikimedia.org/wiki/File:X\n.jpg' },
      { license: 'CC BY-NC 4.0' },
      { author: '' },
      { author: 'x'.repeat(81) },
      { provider: 'pexels' },
      { width: 0 },
    ];
    for (const patch of bad) expect(PhotoSchema.safeParse({ ...photo, ...patch }).success, JSON.stringify(patch)).toBe(false);
    expect(PhotoSchema.safeParse({ ...photo, extra: 1 }).success).toBe(false);
  });

  it('exige un lien de licence pour CC BY et CC BY-SA, pas pour CC0 ni le domaine public', () => {
    const { licenseUrl: _, ...noLink } = photo;
    expect(PhotoSchema.safeParse(noLink).success).toBe(false);
    expect(PhotoSchema.safeParse({ ...noLink, license: 'CC0' }).success).toBe(true);
  });

  it('stocke les URL sous leur forme normalisée', () => {
    const r = PhotoSchema.parse({ ...photo, src: 'HTTPS://Upload.Wikimedia.org/wikipedia/commons/6/6f/Train é.jpg', pageUrl: 'https://Commons.Wikimedia.org/wiki/File:Train.jpg' });
    expect(r.src).toBe('https://upload.wikimedia.org/wikipedia/commons/6/6f/Train%20%C3%A9.jpg');
    expect(r.pageUrl).toBe('https://commons.wikimedia.org/wiki/File:Train.jpg');
  });
});

describe('visual.photo', () => {
  const story = () => structuredClone(fixture.editions[0].sections.flatMap((s) => s.stories).find((st) => st.visual.type === 'photo')!);

  it('accepte une photo conforme et refuse une photo hors des hôtes de confiance', () => {
    const e = structuredClone(fixture.editions[0]);
    const st = e.sections.flatMap((s) => s.stories).find((x) => x.visual.type === 'photo')!;
    st.visual = { type: 'photo', query: 'train', photo };
    expect(parseEdition(e).success).toBe(true);
    st.visual = { type: 'photo', query: 'train', photo: { ...photo, src: 'http://169.254.169.254/x.jpg' } };
    expect(parseEdition(e).success).toBe(false);
  });

  it('lit l’ancienne forme `pexels` (fichiers, lignes jsonb) comme une photo sans image', () => {
    const legacy = { type: 'photo', query: 'train', pexels: { id: 1, src: 'https://images.pexels.com/1.jpeg', width: 6, height: 4, photographer: 'Jo', photographerUrl: 'https://www.pexels.com/@jo', pexelsUrl: 'https://www.pexels.com/photo/1/' } };
    expect(VisualSchema.parse(legacy)).toEqual({ type: 'photo', query: 'train' });
    expect(StorySchema.safeParse({ ...story(), visual: legacy }).success).toBe(true);
  });

  it('le JSON Schema n’expose que la nouvelle forme', () => {
    const json = JSON.stringify(z.toJSONSchema(VisualSchema, { unrepresentable: 'any' }));
    expect(json).toContain('"photo"');
    expect(json).toContain('"wikimedia"');
    expect(json).not.toContain('pexels');
  });

  it('retire photo et pexels d’un visuel carte : l’édition reste valide', () => {
    const map = { type: 'map', caption: 'c', map: { projection: 'world' }, photo, pexels: { id: 1 } };
    expect(sanitizeVisual(map)).toEqual({ visual: { type: 'map', caption: 'c', map: { projection: 'world' } }, removed: true });
    const e = structuredClone(fixture.editions[0]) as unknown as { sections: { stories: { id: string; visual: Record<string, unknown> }[] }[] };
    const st = e.sections.flatMap((s) => s.stories).find((x) => x.visual.type === 'map')!;
    st.visual.photo = photo;
    expect(stripInvalidPhotos(e)).toEqual([st.id]);
    expect(parseEdition(e).success).toBe(true);
  });

  it('sanitizeVisual retire une photo invalide et garde une photo conforme', () => {
    const bad = { type: 'photo', query: 'q', photo: { ...photo, src: 'https://evil.example/x.jpg' } };
    expect(sanitizeVisual(bad)).toEqual({ visual: { type: 'photo', query: 'q' }, removed: true });
    const good = { type: 'photo', query: 'q', photo };
    expect(sanitizeVisual(good)).toEqual({ visual: good, removed: false });
    expect(sanitizeVisual({ type: 'map', caption: 'c' })).toEqual({ visual: { type: 'map', caption: 'c' }, removed: false });
    expect(sanitizeVisual(null)).toEqual({ visual: null, removed: false });
  });

  it('stripInvalidPhotos nettoie une édition brute et nomme les sujets touchés', () => {
    const e = structuredClone(fixture.editions[0]) as unknown as { sections: { stories: { id: string; visual: unknown }[] }[] };
    const st = e.sections.flatMap((s) => s.stories).find((x) => (x.visual as { type: string }).type === 'photo')!;
    st.visual = { type: 'photo', query: 'q', photo: { ...photo, pageUrl: 'https://evil.example/' } };
    expect(stripInvalidPhotos(e)).toEqual([st.id]);
    expect(st.visual).toEqual({ type: 'photo', query: 'q' });
    expect(stripInvalidPhotos('pas une édition')).toEqual([]);
  });
});
