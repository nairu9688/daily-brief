# Réponses d'API pour les tests

Réponses **construites** d'après la documentation publique des API (forme des champs), pas des enregistrements réels. Elles servent à tester l'analyse des réponses sans appel réseau.

- `pexels-search.json` : `GET https://api.pexels.com/v1/search` (documentation Pexels API v1, objet `Photo`). La première photo est en portrait, pour vérifier que le client préfère une photo paysage.
- `thenewsapi-top.json` : `GET https://api.thenewsapi.com/v1/news/top` (documentation TheNewsAPI : `meta` et `data[]` avec `uuid`, `title`, `description`, `keywords`, `snippet`, `url`, `image_url`, `language`, `published_at`, `source`, `categories`, `relevance_score`, `locale`). Le troisième article n'a pas d'URL : il doit être ignoré.
- `thenewsapi-similar.json` : `GET https://api.thenewsapi.com/v1/news/similar/{uuid}`, même forme, `relevance_score` numérique.
