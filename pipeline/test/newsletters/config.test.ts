import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANGS } from '@daily-brief/schema';
import { gmailFilterQuery, loadNewsletters, matchSender, NEWSLETTERS_PATH, NewslettersConfigSchema, senderDomain } from '../../newsletters/config';
import { loadWhitelist, lookupDomain } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';

const raw = () => JSON.parse(readFileSync(NEWSLETTERS_PATH, 'utf8'));

describe('newsletters.json', () => {
  it('se charge : libellé Daily Brief, 6 à 8 newsletters actives, au moins une par édition', () => {
    const c = loadNewsletters();
    expect(c.gmailLabel).toBe('Daily Brief');
    const active = c.newsletters.filter((n) => n.enabled);
    expect(active.length).toBeGreaterThanOrEqual(6);
    expect(active.length).toBeLessThanOrEqual(c.maxPerDay);
    for (const lang of LANGS) expect(active.some((n) => n.edition === lang), lang).toBe(true);
  });

  it('R2 : chaque média est dans whitelist.json ; une newsletter ES vient d’un média espagnol, une newsletter EN d’un média US ou GB', () => {
    const wl = loadWhitelist(WHITELIST_PATH);
    for (const n of loadNewsletters().newsletters) {
      const entry = lookupDomain(wl, `https://${n.domain}/`);
      expect(entry, `${n.id} : ${n.domain} absent de whitelist.json`).toBeDefined();
      expect(n.lang, n.id).toBe(n.edition);
      if (n.edition === 'es') expect(entry!.country, n.id).toBe('ES');
      if (n.edition === 'en') expect(['US', 'GB'], n.id).toContain(entry!.country);
    }
  });

  it('R1 : être dans le fichier ne donne pas le statut full à un domaine (seule la newsletter compte comme lue)', () => {
    const wl = loadWhitelist(WHITELIST_PATH);
    const full = loadNewsletters().newsletters.filter((n) => lookupDomain(wl, `https://${n.domain}/`)?.status === 'full');
    expect(full.map((n) => n.domain)).toEqual(['eldiario.es']);
  });

  it('refuse un plafond au-delà de 8, trop de newsletters actives, un identifiant ou un expéditeur en double, une inscription en http', () => {
    const over = raw();
    over.maxPerDay = 9;
    expect(NewslettersConfigSchema.safeParse(over).success).toBe(false);
    const tooMany = raw();
    tooMany.maxPerDay = 6;
    expect(NewslettersConfigSchema.safeParse(tooMany).error?.issues.map((i) => i.message)).toContain('8 newsletters actives pour un plafond de 6');
    const dup = raw();
    dup.newsletters[1].id = dup.newsletters[0].id;
    expect(NewslettersConfigSchema.safeParse(dup).success).toBe(false);
    const sender = raw();
    sender.newsletters[1].senders = ['publicsenat.fr'];
    expect(NewslettersConfigSchema.safeParse(sender).success).toBe(false);
    const http = raw();
    http.newsletters[0].signupUrl = 'http://www.publicsenat.fr/newsletters';
    expect(NewslettersConfigSchema.safeParse(http).success).toBe(false);
    const paid = raw();
    paid.newsletters[0].free = false;
    expect(NewslettersConfigSchema.safeParse(paid).success).toBe(false);
  });
});

describe('expéditeurs', () => {
  it('lit le domaine de l’en-tête From, sous-domaines compris, et ignore les newsletters désactivées', () => {
    const c = loadNewsletters();
    expect(senderDomain('Public Sénat <newsletter@info.publicsenat.fr>')).toBe('info.publicsenat.fr');
    expect(senderDomain('first.edition@theguardian.com')).toBe('theguardian.com');
    expect(senderDomain('pas une adresse')).toBeNull();
    expect(matchSender(c, 'Public Sénat <newsletter@info.publicsenat.fr>')?.id).toBe('publicsenat-quotidienne');
    expect(matchSender(c, 'X <a@evilpublicsenat.fr>')).toBeUndefined();
    expect(matchSender(c, 'EL PAÍS <noreply@elpais.com>')).toBeUndefined();
  });

  it('construit la requête du filtre Gmail à partir des newsletters actives', () => {
    expect(gmailFilterQuery(loadNewsletters())).toBe('from:(publicsenat.fr OR theconversation.com OR lemonde.fr OR theguardian.com OR independent.co.uk OR axios.com OR eldiario.es OR kloshletter.com)');
  });
});
