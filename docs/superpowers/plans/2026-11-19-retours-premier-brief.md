# Retours sur le premier brief réel (19/11/2026)

Le premier passage réel (`out/2026-11-19/`) a donné cinq retours. Cette note dit ce qui a changé, pourquoi, et ce qu'il faut surveiller au prochain passage.

## 1. Trop peu de médias lisibles en entier (R3)

**Constat.** Édition FR : Euronews faisait 49 % des sources, Sud Radio l'essentiel du reste. Édition ES : eldiario.es faisait 83 %. Plafond R3 : environ 30 %. La collecte était dégradée (TheNewsAPI en 429, pas encore de clé Webz). Surtout, `raw.json` ne contenait de texte que pour 4 médias en FR et en ES : les seuls au statut `full` de `pipeline/config/whitelist.json`. Les autres médias trouvés en FR (france24.com, rfi.fr, theconversation.com, lalibre.be…) n'avaient que leurs métadonnées. NPR et The Hill (statut `feed`) n'avaient aucun texte. Côté textes trop courts : des vidéos d'Al Jazeera (283 à 341 caractères) et des pages d'émission de Sud Radio (70 caractères). Les redirections d'alicanteplaza.es vers castellonplaza.com ont été refusées par R1, comme prévu.

**Vérification du 19/11/2026.** Au plus une requête publique par flux ou par page, 29 en tout. Agent de la collecte (`Mozilla/5.0 (compatible; DailyBrief/1.0)`), sans donnée personnelle. Pour chaque candidat : le flux est lu par `feed-parse.ts`, puis un article du jour est passé à `extractText` (Readability). Le seuil est `fulltext.minChars` = 400 caractères. On cherche aussi une marque de paywall dans la page (`isAccessibleForFree`).

| Média | Flux | Article lu | Résultat |
|---|---|---|---|
| franceinfo (franceinfo.fr) | `https://www.franceinfo.fr/titres.rss` (francetvinfo.fr y redirige), 31 articles | 9 352 caractères, `isAccessibleForFree: true` | **full** (et francetvinfo.fr) |
| 20 Minutes | `https://www.20minutes.fr/feeds/rss-une.xml`, 30 articles | 3 002 caractères | **full** |
| Le HuffPost | `https://www.huffingtonpost.fr/rss/all_headline.xml`, 20 articles | 3 238 caractères, `isAccessibleForFree: true` | **full** |
| The Conversation FR | `https://theconversation.com/fr/articles.atom`, 50 articles | 7 775 caractères (licence CC BY-ND) | **full** (theconversation.com, pays INT) |
| France 24 | `https://www.france24.com/fr/rss`, 24 articles | 403 à notre agent | reste **meta** |
| RFI | `https://www.rfi.fr/fr/rss`, 23 articles | 403 à notre agent | reste **meta** |
| Ouest-France | `https://www.ouest-france.fr/rss/une`, 10 articles | 403 à notre agent | reste **meta** |
| Public Sénat | `https://www.publicsenat.fr/rss.xml` : 404 | — | reste **meta** |
| BBC News | `https://feeds.bbci.co.uk/news/rss.xml`, 31 articles | 5 880 caractères | **full** (bbc.co.uk, et bbc.com : même site) ; bbci.co.uk en **feed** (hôte du flux) |
| The Guardian | `https://www.theguardian.com/world/rss`, 45 articles | 5 262 caractères, `isAccessibleForFree: true` | **full** |
| NPR | flux déjà configuré | 5 348 caractères (répond à notre agent, 403 sans agent) | **feed → full** |
| 20minutos | `https://www.20minutos.es/rss`, 180 articles | 6 960 caractères | **full** |
| Europa Press | `https://www.europapress.es/rss/rss.aspx`, 10 articles | 5 938 caractères | **full** |
| El Confidencial | `https://rss.elconfidencial.com/espana/`, 15 articles | 9 477 caractères, `isAccessibleForFree: true`, paywall dynamique | **full**, avec la garde ci-dessous |
| Público | `https://www.publico.es/rss/` : 404 | — | non ajouté |
| RTVE | `https://api2.rtve.es/rss/temas_noticias.xml` : figé en 2022 ; `https://www.rtve.es/api/noticias.rss` : vide | — | reste **meta** |

Non vérifiés, faute de requêtes : La Croix et Libération (paywall), The Independent, Sky News, AP News (pas de flux RSS officiel), El País et La Vanguardia (paywall), infoLibre. Ils gardent leur statut.

**Garde de paywall.** `fetchFullText` refuse désormais toute page qui se déclare payante : `"isAccessibleForFree": false` en JSON-LD (booléen ou chaîne), ou la microdonnée `itemprop="isAccessibleForFree" content="false"`. Erreur : « article payant ». Cela permet d'ouvrir un média à paywall partiel (El Confidencial) sans lire ses articles réservés (R1).

**Configuration.** Les flux sont ajoutés à `feeds.json`. Les domaines `full` sont ajoutés à `exa.fullDomains` dans `collect.json`. Le nombre de requêtes Exa ne change pas : une recherche par rubrique et par langue. The Conversation n'est pas dans Exa : le domaine sert plusieurs langues, son flux FR suffit. Chaque édition dispose maintenant d'au moins 6 médias `full` distincts (test `config.test.ts`) : FR 6, EN 7, ES 7. La collecte lit 21 flux au lieu de 12.

## 5. Source dans la mauvaise langue

**Constat.** democrata.es publie aussi en anglais (`/en/…`). Exa a renvoyé 10 de ces pages pour l'édition ES, dont une a fini dans le brief avec un titre anglais. Le flux de democrata.es a répondu 403.

**Correction.** `pipeline/collect/language.ts` repère la langue par mots-outils propres au FR, à l'EN et à l'ES, sur le titre, le chapô et le début du texte. Il faut au moins 8 mots reconnus et deux fois plus que la langue suivante. `brief:collect` écarte, après la lecture des textes, tout article nettement dans une autre langue que celle annoncée, et le signale (« langue : N article(s)… »). Si la langue est incertaine, l'article est gardé. Sur le `raw.json` du 19/11, cette règle écarte exactement les 10 pages `/en/` de democrata.es et aucune autre. Corriger la langue du domaine dans la configuration n'aurait pas suffi : democrata.es publie dans les deux langues.
