/**
 * @daily-brief/maps — réservé au serveur : le paquet embarque l'atlas world-atlas 50m (≈ 750 Ko)
 * et le projette à chaque rendu. Ne pas l'importer dans un composant client ; les QR codes
 * ont leur propre sous-chemin (`@daily-brief/maps/qr`).
 */
export { renderMap, BUBBLE_K } from './render-map';
export { countriesOutOfFrame, countryCodeProblem, mapDiagnostics, placesInFrame } from './diagnostics';
export { qrSvg } from './qr';
export { countryByAlpha3, mainBounds, numericId } from './countries';
