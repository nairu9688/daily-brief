import type { Photo } from '@daily-brief/schema';

/** Photo Wikimedia conforme au schéma, pour les tests. */
export const photo = (id: number): Photo => ({
  provider: 'wikimedia',
  src: `https://upload.wikimedia.org/wikipedia/commons/${id}/P${id}.jpg`,
  width: 1600,
  height: 1067,
  author: 'P',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  pageUrl: `https://commons.wikimedia.org/wiki/File:P${id}.jpg`,
});
