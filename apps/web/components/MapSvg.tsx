import { renderMap } from '@daily-brief/maps';
import type { MapSpec } from '@daily-brief/schema';

/**
 * Carte SVG rendue côté serveur par @daily-brief/maps. C'est le SEUL usage de dangerouslySetInnerHTML
 * de l'appli (vérifié par test/security/static.test.ts), et il est sûr :
 * - le SVG est produit par notre code, pas par le modèle : tracés et coordonnées sont des nombres,
 *   les classes viennent d'une liste fixe ;
 * - les seuls textes venus de l'édition (noms et libellés des lieux, `aria-label`) passent par
 *   `escapeXml` de packages/maps/src/svg.ts (& < > " échappés), testé avec une balise <script> ;
 * - le MapSpec est validé par zod (MapSpecSchema) avant d'arriver ici.
 */
export function MapSvg({ spec, label }: { spec: MapSpec; label: string }) {
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: renderMap(spec, label) }} />;
}
