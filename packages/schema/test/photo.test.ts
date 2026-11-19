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
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Train.jpg',
};

describe('isHttpsUrlOn', () => {
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
    for (const l of ['CC0', 'CC0 1.0', 'Public domain', 'CC BY 4.0', 'CC BY 2.0', 'CC BY-SA 3.0', 'CC BY-SA 2.5 nl', 'CC BY-SA 3.0 igo', 'CC BY-SA 4.0', 'CC BY']) {
      expect(isFreeLicense(l), l).toBe(true);
    }
  });

  it('refuse NC, ND, les licences inconnues et l’usage loyal', () => {
    for (const l of ['CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'CC BY-ND 4.0', 'CC BY-NC-ND 3.0', 'GFDL', 'Fair use', 'All rights reserved', 'Attribution', '', 'CC BY-SA 4.0 <script>']) {
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
      { license: 'CC BY-NC 4.0' },
      { author: '' },
      { author: 'x'.repeat(81) },
      { provider: 'pexels' },
      { width: 0 },
    ];
    for (const patch of bad) expect(PhotoSchema.safeParse({ ...photo, ...patch }).success, JSON.stringify(patch)).toBe(false);
    expect(PhotoSchema.safeParse({ ...photo, extra: 1 }).success).toBe(false);
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
