/** Paramètres de requête qui portent un secret (TheNewsAPI : api_token ; Webz : token). */
const SECRET_PARAM = /([?&;](?:api_token|token|api_key|apikey|key)=)[^&#\s"';\\]*/gi;

/** URL sans secret : la valeur des paramètres sensibles est remplacée par `***`. */
export function redactUrl(url: string): string {
  return url.replace(SECRET_PARAM, '$1***');
}

/** Chaque secret connu (4 caractères ou plus, tel quel ou encodé pour une URL) remplacé par `***`. */
export function stripSecrets(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 4) continue;
    out = out.split(s).join('***');
    // Forme encodée pour une URL : les %XX se lisent en majuscules comme en minuscules.
    const encoded = encodeURIComponent(s);
    if (encoded !== s) {
      const pattern = encoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%([0-9A-F]{2})/gi, (_, h: string) => `%${h.toUpperCase()}`.replace(/[A-F]/g, (c) => `[${c}${c.toLowerCase()}]`));
      out = out.replace(new RegExp(pattern, 'g'), '***');
    }
  }
  return out;
}

/** Message sans secret : paramètres sensibles masqués dans toute URL, puis secrets connus retirés. */
export function redactText(text: string, secrets: (string | undefined)[]): string {
  return stripSecrets(redactUrl(text), secrets);
}
