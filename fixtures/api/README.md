# Réponses d'API pour les tests

Réponses **construites** d'après la documentation publique des API (forme des champs), pas des enregistrements réels. Elles servent à tester l'analyse des réponses sans appel réseau.

- `pexels-search.json` : `GET https://api.pexels.com/v1/search` (documentation Pexels API v1, objet `Photo`). La première photo est en portrait, pour vérifier que le client préfère une photo paysage.
- `thenewsapi-top.json` : `GET https://api.thenewsapi.com/v1/news/top` (documentation TheNewsAPI : `meta` et `data[]` avec `uuid`, `title`, `description`, `keywords`, `snippet`, `url`, `image_url`, `language`, `published_at`, `source`, `categories`, `relevance_score`, `locale`). Le troisième article n'a pas d'URL : il doit être ignoré.
- `thenewsapi-similar.json` : `GET https://api.thenewsapi.com/v1/news/similar/{uuid}`, même forme, `relevance_score` numérique.
- `exa-search.json` : `POST https://api.exa.ai/search` (documentation Exa : `results[]` avec `id`, `title`, `url`, `publishedDate`, `author`, `text`). Le résultat de lemonde.fr porte un texte qui doit être écarté (R1) ; le dernier résultat est mal formé.
- `webz-news-lite.json` : `GET https://api.webz.io/newsApiLite` (forme des `posts[]` de Webz.io : `thread`, `uuid`, `url`, `published`, `title`, `text`, `language` en toutes lettres). Le texte d'elpais.com doit être écarté (R1) ; un post est hors fenêtre, un autre mal formé. Le champ `next` contient un faux jeton.
- `rss-euronews-fr.xml` et `atom-elsalto.xml` : flux RSS 2.0 et Atom construits d'après la forme des flux Euronews et El Salto (CDATA, entités, `guid` sans `link`, lien `alternate`, article hors liste blanche, hors fenêtre ou sans lien).
