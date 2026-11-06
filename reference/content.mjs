// Données de la maquette v2 — même schéma que celui que produira la routine (brief JSON).
// Faits vérifiés le 06.11.2026 sur les sources lisibles ; les sources « read:false » sont listées (titre + lien) sans avoir été lues.

export const DATE = { iso: '2026-11-06', fr: 'Vendredi 6 novembre 2026', short: 'VEN 06.11.26', no: '001' };

const S = (name, title, url, read = false) => ({ name, title, url, read });

export const editions = [
{
  lang: 'fr', label: 'Français', region: 'France · Monde', audio: '3:24',
  headline: 'La rue pousse Lecornu à négocier, le Sud-Est sous l’eau',
  points: [
    ['Mobilisation :', '575 000 manifestants selon les autorités, 1,6 million selon la CGT ; Sébastien Lecornu convoque une conférence sociale lundi.', 'Politique & société'],
    ['Corse :', 'deux morts dans des inondations, plus de deux mois de pluie en 48 h ; le Gard et l’Hérault aussi touchés.', 'Environnement'],
    ['États-Unis :', 'les démocrates remportent les deux chambres du Congrès et font basculer plus de 40 sièges à la Chambre.', 'International'],
    ['Ukraine :', 'à Madrid, Zelensky appelle à sauver d’urgence le réseau électrique de son pays.', 'International'],
    ['SNCF :', 'le TGV M d’Alstom fait son voyage inaugural Paris–Marseille, avec plus de deux ans de retard.', 'Entreprises'],
  ],
  sections: [
    { key: 'pol', title: 'Politique & société', stories: [{
      kicker: 'France', time: '05.11',
      title: 'Après une journée de « colère sociale », Lecornu convoque une conférence sociale',
      visual: { map: 'map-strike', cap: 'Manifestants · chiffres des autorités' },
      summary: 'Salariés, fonctionnaires, retraités et jeunes ont manifesté jeudi pour réclamer des hausses de pouvoir d’achat, lors de la quatrième journée de grève nationale de l’automne. Le Premier ministre réunira syndicats et patronat lundi 9 novembre pour une conférence sur les salaires et le pouvoir d’achat. À Lyon, le cortège a été marqué par des affrontements avec la police.',
      stats: [['575 000', 'manifestants (autorités)'], ['193', 'cortèges en France'], ['65 000', 'à Paris (autorités)'], ['9 nov.', 'conférence sociale']],
      diverge: { label: 'Les chiffres divergent', rows: [['Participation nationale', '575 000', 'Autorités (AFP)', '1,6 million', 'CGT'], ['Cortège de Lyon', '30 500', 'Autorités (Euronews)', '55 000', 'CGT']] },
      quote: { text: 'La question qui est posée aujourd’hui, c’est pas “est-ce qu’on va gagner” mais “combien va-t-on gagner ?”', by: 'Sophie Binet · CGT' },
      thread: { title: 'Mobilisation sociale de l’automne', sub: '4e journée de grève nationale' },
      prepa: { tag: 'Éco-droit', text: 'Partage de la valeur ajoutée, négociation collective et rôle des partenaires sociaux.' },
      sources: [
        S('Sud Radio · AFP', 'Lecornu convoque une conférence sociale après une journée de « colère sociale »', 'https://www.sudradio.fr/societe/la-grogne-sociale-monte-dun-cran-greve-et-manifestations-partout-en-france', true),
        S('Euronews', 'France: Up to 55,000 march in Lyon amid clashes and tear gas', 'https://www.euronews.com/video/2026/11/05/france-up-to-55000-march-in-lyon-amid-clashes-and-tear-gas', true),
      ] }] },
    { key: 'int', title: 'International & géopolitique', stories: [{
      kicker: 'États-Unis', time: '05.11',
      title: 'Midterms : les démocrates prennent les deux chambres du Congrès',
      visual: { map: 'map-us', cap: 'États-Unis · courses à suivre' },
      summary: 'Les démocrates ont pris le contrôle de la Chambre des représentants en faisant basculer plus de trois douzaines de sièges républicains (43 selon le dernier décompte de CBS News, contre 2 gagnés par les républicains) et s’apprêtent à contrôler aussi le Sénat. Certaines courses restent ouvertes : au Mississippi, le démocrate Scott Colom devance la sénatrice Cindy Hyde-Smith de 65 voix, et en Alaska le Sénat pourrait se jouer au décompte préférentiel.',
      stats: [['43', 'sièges basculés (CBS)'], ['2', 'gagnés par les républicains'], ['65', 'voix d’écart au Mississippi'], ['435', 'sièges à la Chambre']],
      thread: { title: 'Midterms 2026', sub: 'Mississippi et Alaska encore indécis' },
      prepa: { tag: 'Anglais LV1 · CG', text: 'Institutions américaines : divided government et checks and balances pour la fin du mandat Trump.' },
      sources: [
        S('CBS News', 'Democrats have flipped over 40 House seats. Here’s the breakdown.', 'https://www.cbsnews.com/news/house-districts-flipped-2026-midterm-elections/', true),
        S('PBS NewsHour', 'Midterm voters rebuke Trump, handing Democrats both chambers of Congress', 'https://www.pbs.org/newshour/show/midterm-voters-rebuke-trump-handing-democrats-both-chambers-of-congress', true),
        S('The Hill', 'Democrat Jessica Killin flips longtime GOP-held Colorado House seat', 'https://thehill.com/homenews/campaign/6180533-jessica-killin-unseats-jeff-crank-colorado-5th-district/'),
        S('NPR', 'What’s next for Democrats after the midterms. And, a look at the outstanding races', 'https://www.npr.org/2026/11/05/g-s1-152046/up-first-newsletter-democrats-congress-control-house-senate-trump-reaction'),
        S('Euronews', 'US midterm elections results 2026: live updates in maps and charts', 'https://euronews.com/2026/11/03/us-midterm-elections-results-2026-live-updates-in-maps-and-charts', true),
        S('Al Jazeera', 'US Midterm Elections 2026 — results', 'https://aljazeera.com/us-midterm-elections-2026/results/', true),
      ] }, {
      kicker: 'Ukraine · Espagne', time: '06.11',
      title: 'À Madrid, Zelensky lance un appel urgent pour sauver le réseau électrique ukrainien',
      visual: { map: 'map-kyiv', cap: 'Madrid → Kyiv' },
      summary: 'Invité au 30e Sommet ibéro-américain, le président ukrainien a demandé aux dirigeants présents transformateurs, générateurs et câbles pour un réseau pilonné par les frappes russes. Il a aussi rencontré le roi Felipe VI pour obtenir un soutien espagnol à la défense aérienne.',
      quote: { text: 'le plus rapidement possible', by: 'Volodymyr Zelensky · Madrid' },
      thread: { title: 'Guerre en Ukraine', sub: 'l’énergie, cible de l’hiver' },
      sources: [
        S('Euronews', 'À Madrid, Zelensky lance un appel urgent à l’aide pour sauver le réseau électrique ukrainien', 'https://fr.euronews.com/2026/11/06/a-madrid-zelensky-lance-un-appel-urgent-a-laide-pour-sauver-le-reseau-electrique-ukrainien', true),
        S('Exteriores (gouv. espagnol)', 'Albares anuncia que la Cumbre Iberoamericana se celebrará en Madrid los días 4 y 5 de noviembre', 'https://www.exteriores.gob.es:443/en/Comunicacion/NotasPrensa/Paginas/2025_NOTAS_P/Albares-anuncia-que-la-Cumbre-Iberoamericana-se-celebrara-en-Madrid-los-dias-4-y-5-de-noviembre.aspx'),
      ] }] },
    { key: 'env', title: 'Environnement & énergie', stories: [{
      kicker: 'France', time: '06.11',
      title: 'Corse : deux morts dans des inondations, le Gard et l’Hérault aussi touchés',
      visual: { map: 'map-floods', cap: 'Corse-du-Sud · Gard · Hérault' },
      summary: 'De violentes pluies orageuses ont frappé la Corse et le sud-est : plus de deux mois de pluie sont tombés en moins de 48 heures sur l’île. Dans la nuit, une voiture emportée par les eaux sur la RT10 a coûté la vie à deux de ses trois occupants. Dans le Gard, le Vidourle est monté de plus de 1,50 m en deux heures à Sommières.',
      stats: [['285 mm', 'de pluie à Conca'], ['2', 'morts en Corse-du-Sud'], ['70+', 'personnes évacuées'], ['+1,50 m', 'Vidourle en 2 h']],
      thread: { title: 'Épisodes méditerranéens 2026', sub: '2e épisode meurtrier depuis le 20 oct.', open: 'fr' },
      prepa: { tag: 'Éco-droit', text: 'Risques climatiques et assurance : le régime d’indemnisation des catastrophes naturelles (CatNat).' },
      sources: [
        S('Euronews', 'Intempéries : deux morts en Corse dans des inondations, le Gard et l’Hérault également touchés', 'https://fr.euronews.com/2026/11/06/intemperies-deux-morts-en-corse-dans-des-inondations-le-gard-et-lherault-egalement-touches', true),
      ] }] },
    { key: 'eco', title: 'Économie', stories: [{
      kicker: 'Allemagne', time: '06.11',
      title: 'La production industrielle allemande rebondit, portée par l’automobile',
      visual: { photo: 'car factory', grad: 'radial-gradient(90% 80% at 75% 15%,#ffd9a0 0%,transparent 55%),linear-gradient(165deg,#2b2118 0%,#7a4b22 50%,#e7b77a 100%)' },
      summary: 'La production industrielle a progressé de 0,7 % en septembre par rapport à août, au-dessus des attentes, selon l’office statistique Destatis. L’automobile (+17,1 %) a tiré la hausse tandis que la construction et les machines reculaient. Sur le troisième trimestre, la production baisse toutefois de 0,4 %.',
      stats: [['+0,7 %', 'en septembre (m/m)'], ['+17,1 %', 'automobile'], ['−0,4 %', 'sur le 3e trimestre'], ['1,3 %', 'croissance prévue 2026']],
      prepa: { tag: 'Économie', text: 'Conjoncture et indicateurs : lire une variation mensuelle vs trimestrielle.' },
      sources: [ S('Euronews', 'Los fabricantes de automóviles impulsan el inesperado repunte de la producción industrial alemana', 'https://es.euronews.com/2026/11/06/los-fabricantes-de-coches-impulsan-el-inesperado-repunte-de-la-produccion-industrial-alema', true) ] }],
      briefs: [ S('Sud Radio · AFP', 'Le nombre de locations Airbnb « à l’année » augmente en Île-de-France, selon une étude', 'https://www.sudradio.fr/societe/le-nombre-de-locations-airbnb-a-lannee-augmente-en-ile-de-france-selon-une-etude') ] },
    { key: 'ent', title: 'Entreprises & management', stories: [{
      kicker: 'SNCF · Alstom', time: '06.11',
      title: 'Le TGV M, nouveau train à grande vitesse, enfin sur les rails',
      visual: { photo: 'high-speed train', grad: 'radial-gradient(120% 90% at 80% 10%,#9fb6ff 0%,transparent 55%),linear-gradient(160deg,#1c2b55 0%,#2f4fb8 45%,#d9e1ff 100%)' },
      summary: 'Conçu par Alstom pour la SNCF, le TGV M a effectué son voyage inaugural entre Paris et Marseille, environ deux ans et demi après la date espérée (les JO de 2024). Plus sobre et à capacité modulable, il roule à 320 km/h et affrontera le Frecciarossa de Trenitalia sur l’axe Paris–Marseille.',
      stats: [['−20 %', 'd’énergie consommée'], ['573', 'places (contre 500)'], ['320 km/h', 'vitesse commerciale'], ['−30 %', 'coûts de maintenance']],
      diverge: { label: 'Les sources divergent', rows: [['Mise en service commerciale', 'ven. 6 nov.', 'AFP', 'lun. 9 nov.', 'Euronews, Voyages d’Affaires']] },
      prepa: { tag: 'Management', text: 'Pilotage d’un grand projet industriel et relation client–fournisseur (SNCF–Alstom) : coûts, délais, innovation.' },
      sources: [
        S('Sud Radio · AFP', 'Le nouveau TGV d’Alstom entre enfin en service commercial vendredi', 'https://www.sudradio.fr/societe/le-nouveau-tgv-dalstom-entre-enfin-en-service-commercial-vendredi-a-la-sncf', true),
        S('Euronews', 'SNCF : le TGV M, nouveau train à grande vitesse, enfin sur les rails', 'https://fr.euronews.com/2026/11/06/sncf-le-tgv-m-nouveau-train-a-grande-vitesse-enfin-sur-les-rails', true),
        S('Voyages d’Affaires', 'TGV M : les premiers passagers attendus le 9 novembre', 'https://www.voyages-d-affaires.com/?p=231671'),
        S('L’Écho touristique', 'Le TGV M effectuera (enfin) son voyage inaugural le 6 novembre', 'https://www.lechotouristique.com/transport/le-tgv-m-prendra-enfin-son-depart-le-vendredi-6-novembre'),
        S('Journal du Geek', 'Les nouveaux TGV entrent en circulation le 6 novembre, mais vous ne pourrez pas monter dedans', 'https://www.journaldugeek.com/2026/10/19/les-nouveaux-tgv-entrent-en-circulation-le-6-novembre-mais-vous-ne-pourrez-pas-monter-dedans/'),
      ] }] },
    { key: 'dro', title: 'Droit & justice', stories: [], briefs: [
      S('Sud Radio · AFP', 'Féminicide dans le Gers : un homme condamné à 30 ans de réclusion criminelle', 'https://www.sudradio.fr/societe/gers-un-homme-condamne-a-30-ans-de-reclusion-pour-avoir-tue-son-ex-conjointe') ] },
    { key: 'tec', title: 'Tech & IA', stories: [{
      kicker: 'Europe', time: '05.11',
      title: 'Data centers : plus de 100 organisations réclament un moratoire en Europe',
      visual: { map: 'map-dc', cap: 'Pays cités · actions des 6 et 7 nov.' },
      summary: 'Coordonnées par le collectif Stop Dirty Data Centres, quelque 75 actions ont lieu ce week-end dans 15 pays, dont jusqu’à 20 en Espagne (Saragosse, Madrid, Barcelone, Huelva). Les organisateurs dénoncent l’impact des nouveaux centres de données sur l’énergie, l’eau et le foncier, alors que l’investissement européen a doublé depuis 2020.',
      stats: [['~75', 'actions en Europe'], ['102', 'organisations'], ['15', 'pays'], ['176 Md€', 'investis 2026-31 (PwC)']],
      quote: { text: 'Están jugando al salvaje Oeste: meterlo todo deprisa y corriendo antes de que dé tiempo a regular nada', tr: 'Ils jouent au Far West : tout installer à toute vitesse avant qu’on ait le temps de réguler quoi que ce soit.', by: 'Aurora Gómez · Tu Nube Seca Mi Río (Espagne)' },
      sources: [
        S('Euronews', 'Protesters across Europe to call for freeze on energy-hungry data centres', 'https://www.euronews.com/2026/11/05/protesters-across-europe-to-call-for-freeze-on-energy-hungry-data-centres', true),
        S('elDiario.es', 'España lidera la primera movilización europea contra los centros de datos', 'https://www.eldiario.es/tecnologia/espana-lidera-primera-movilizacion-europea-centros-datos-promesas-ia-son-falsas_1_13639661.html', true),
        S('Yorkshire Evening Post', 'Leeds data centre campaigners to join forces with European partners for weekend of action', 'https://www.yorkshireeveningpost.co.uk/news/environment/leeds-data-centre-campaigners-to-join-forces-with-european-partners-for-weekend-of-action-9309504'),
        S('The Hill', 'Hinojosa vows to protect Texas citizens from data centers', 'https://thehill.com/homenews/state-watch/6203045-texas-hinojosa-data-centers/'),
        S('Alloforfait', 'Stop Dirty Data Centres : des initiatives attendues en fin de semaine contre les centres de données', 'https://alloforfait.fr/?p=155444'),
      ] }] },
    { key: 'spo', title: 'Sport', stories: [], briefs: [
      S('Sud Radio', 'Ligue Europa : l’OM se relance avec une victoire à Leverkusen', 'https://www.sudradio.fr/sport-rugby/sport/ligue-europa-pour-lom-trois-points-enfin'),
      S('Sud Radio', 'F1 : Hamilton « évidemment agacé » par l’incident avec son coéquipier Leclerc au Mexique', 'https://www.sudradio.fr/sport-rugby/sport/f1-hamilton-evidemment-agace-par-lincident-avec-son-coequipier-leclerc-au-mexique') ] },
  ],
  vocab: null,
},
{
  lang: 'en', label: 'English', region: 'US · UK', audio: '3:02',
  headline: 'A blue wave sweeps Congress',
  points: [
    ['Midterms:', 'Democrats take both chambers of Congress, flipping more than 40 House seats.', 'Politics'],
    ['Still counting:', 'Mississippi’s Senate race hangs on a 65-vote margin; Alaska may go to ranked-choice tabulation.', 'Politics'],
    ['Los Angeles:', 'Nithya Raman ousts incumbent mayor Karen Bass, CBS News projects.', 'Politics'],
    ['UK:', 'the Prime Minister is reviewing the decision to give a military satellite contract to a US firm.', 'UK · Defence'],
    ['Health:', 'teens worldwide aren’t getting enough exercise, especially girls.', 'Society'],
  ],
  sections: [
    { key: 'pol', title: 'Politics & society', stories: [{
      kicker: 'United States', time: '05.11',
      title: 'Democrats win control of both chambers of Congress',
      visual: { map: 'map-us', cap: 'United States · races to watch' },
      summary: 'Democrats won the House by flipping more than three dozen Republican-held seats (43 by CBS News’s latest count, against two gained by Republicans) and are poised to control the Senate too. Some races are still open: in Mississippi, Democrat Scott Colom leads Sen. Cindy Hyde-Smith by just 65 votes, and Alaska’s Senate race could go to ranked-choice tabulation.',
      stats: [['43', 'seats flipped (CBS)'], ['2', 'gained by the GOP'], ['65', 'vote margin, Mississippi'], ['435', 'House seats']],
      thread: { title: 'Midterms 2026', sub: 'Mississippi and Alaska still undecided', open: 'en' },
      prepa: { tag: 'Anglais LV1', text: 'US institutions: divided government and checks and balances for the rest of Trump’s term.' },
      sources: [
        S('CBS News', 'Democrats have flipped over 40 House seats. Here’s the breakdown.', 'https://www.cbsnews.com/news/house-districts-flipped-2026-midterm-elections/', true),
        S('PBS NewsHour', 'Midterm voters rebuke Trump, handing Democrats both chambers of Congress', 'https://www.pbs.org/newshour/show/midterm-voters-rebuke-trump-handing-democrats-both-chambers-of-congress', true),
        S('PBS NewsHour', 'Alaskans are waiting for more votes in Senate and governor’s races', 'https://www.pbs.org/newshour/politics/alaskans-are-waiting-for-more-votes-in-senate-and-governors-races-both-could-go-to-ranked-tabulations'),
        S('CBS News', 'Mississippi Senate race is toss-up, with razor-thin margin', 'https://www.cbsnews.com/news/mississippi-senate-race-results-2026-midterms/'),
        S('The Hill', 'Democrat Jessica Killin flips longtime GOP-held Colorado House seat', 'https://thehill.com/homenews/campaign/6180533-jessica-killin-unseats-jeff-crank-colorado-5th-district/'),
        S('NPR', 'What’s next for Democrats after the midterms', 'https://www.npr.org/2026/11/05/g-s1-152046/up-first-newsletter-democrats-congress-control-house-senate-trump-reaction'),
      ] }],
      briefs: [
        S('CBS News', 'Nithya Raman ousts incumbent Karen Bass in LA mayor’s race, CBS News projects', 'https://www.cbsnews.com/news/los-angeles-mayor-election-2026-nithya-raman-karen-bass/'),
        S('Sky News', 'PM reviewing decision to give UK military satellite system contract to US firm', 'https://news.sky.com/story/pm-reviewing-decision-to-give-uk-military-satellite-system-contract-to-us-firm-13608376'),
        S('NPR', 'Teens worldwide aren’t getting enough exercise, especially girls', 'https://www.npr.org/2026/11/05/nx-s1-6027635/exercise-workout-teenagers-adolescents-gender-gap'),
      ] },
    { key: 'tec', title: 'Tech & AI', stories: [], briefs: [
      S('The Hill', 'Hinojosa vows to protect Texas citizens from data centers', 'https://thehill.com/homenews/state-watch/6203045-texas-hinojosa-data-centers/'),
      S('Yorkshire Evening Post', 'Leeds data centre campaigners to join forces with European partners for weekend of action', 'https://www.yorkshireeveningpost.co.uk/news/environment/leeds-data-centre-campaigners-to-join-forces-with-european-partners-for-weekend-of-action-9309504'),
    ] },
  ],
  vocab: { title: 'Midterms vocabulary', items: [
    ['blue wave', 'n.', 'vague démocrate', 'Analysts are breaking down the Democrats’ big majorities after the blue wave.'],
    ['to flip a seat', 'v.', 'faire basculer un siège', 'Democrats flipped more than 40 House seats.'],
    ['toss-up', 'n.', 'scrutin indécis', 'The Mississippi Senate race is a toss-up.'],
    ['incumbent', 'n./adj.', 'sortant(e)', 'Raman ousts incumbent mayor Karen Bass.'],
    ['razor-thin margin', 'n.', 'marge infime', 'The race was decided by a razor-thin margin.'],
    ['ranked-choice voting', 'n.', 'vote préférentiel', 'Alaska’s races could go to ranked-choice tabulation.'],
  ] },
},
{
  lang: 'es', label: 'Español', region: 'España', audio: '3:15',
  headline: 'Puente dimite y la crisis ferroviaria entra en campaña',
  points: [
    ['Gobierno:', 'Óscar Puente dimite como ministro de Transportes tras el accidente de Urda y no irá en las listas del 29N.', 'Política'],
    ['Encuestas:', 'la media de elDiario.es sitúa a PP y Vox en 197 escaños, muy por encima de la mayoría absoluta.', 'Política'],
    ['Transporte:', 'la caída del 13 % de viajeros del AVE Madrid-Barcelona refuerza el Puente Aéreo.', 'Economía'],
    ['Cumbre Iberoamericana:', 'Zelenski pide en Madrid ayuda urgente para la red eléctrica ucraniana.', 'Internacional'],
    ['Centros de datos:', 'España lidera la primera movilización europea, con hasta 20 convocatorias.', 'Tecnología'],
  ],
  sections: [
    { key: 'pol', title: 'Política y sociedad', stories: [{
      kicker: 'Gobierno', time: '03.11',
      title: 'Óscar Puente dimite tras la tragedia de Urda y renuncia a ir en las listas del 29N',
      visual: { map: 'map-spain', cap: 'Urda · Adamuz · Madrid' },
      summary: 'El ministro de Transportes anunció su dimisión el 3 de noviembre tras el accidente de Urda (Toledo), donde un AVE chocó por alcance el 28 de octubre contra un tren de Iryo detenido en la misma vía. Es la segunda gran tragedia de la alta velocidad en nueve meses, tras la de Adamuz en enero. Puente renuncia también a encabezar la lista del PSOE por Valladolid en las generales del 29 de noviembre.',
      stats: [['69', 'fallecidos en Urda'], ['2.ª', 'tragedia en 9 meses'], ['197', 'escaños PP + Vox (media)'], ['29N', 'elecciones generales']],
      diverge: { label: 'Las fuentes difieren', rows: [['Fallecidos en Urda', '69', 'El Salto, Alicante Plaza', '74', 'Demócrata']] },
      quote: { text: 'es una cuestión de dignidad política, de coherencia y de empatía con las víctimas', by: 'Óscar Puente' },
      thread: { title: 'Crisis ferroviaria 2026', sub: '4 episodios desde Adamuz', open: 'es' },
      prepa: { tag: 'Espagnol LV2', text: 'Vida política española: responsabilidad política y campaña de las generales del 29N.' },
      sources: [
        S('El Salto', 'Dimite Óscar Puente y no irá en las listas del PSOE en las próximas elecciones', 'https://www.elsaltodiario.com/psoe/dimite-oscar-puente-no-ira-listas-proximas-elecciones', true),
        S('Alicante Plaza', 'Puente dimite como ministro y candidato del PSOE: «Es una decisión de empatía con las víctimas»', 'https://alicanteplaza.es/alicanteplaza/espana/puente-avanza-su-dimision-tras-la-tragedia-de-urda-es-una-decision-de-empatia-con-las-victimas', true),
        S('Demócrata', 'Sánchez ensalza la dimisión de Óscar Puente: «Políticos como él dignifican a nuestro país»', 'https://www.democrata.es/politica/sanchez-ensalza-dimision-oscar-puente-politicos-como-dignifican-nuestro-pais/', true),
        S('elDiario.es', 'La media de encuestas tras la dimisión de Óscar Puente: así afecta al voto del PSOE', 'https://www.eldiario.es/politica/media-encuestas-dimision-oscar-puente-afecta-voto-psoe_1_13640327.html', true),
        S('Xataka', 'Óscar Puente anuncia su dimisión como ministro de Transportes', 'https://www.xataka.com/movilidad/oscar-puente-anuncia-su-dimision-como-ministro-transportes'),
        S('Artículo 14', 'Dimite Óscar Puente tras el accidente de Urda y renuncia a ir en listas el 29-N', 'https://www.articulo14.es/politica/dimite-oscar-puente-y-renuncia-a-ser-diputado-tras-el-29-n-20261103.html'),
        S('RTVC', 'Óscar Puente dimite como ministro de Transportes', 'https://rtvc.es/oscar-puente-anuncia-su-dimision-como-ministro-de-transportes-3-noviembre-2026/'),
        S('Vozpópuli', 'El futuro de Puente divide al PSOE: Moncloa teme que su dimisión suponga cargar con la culpa', 'https://www.vozpopuli.com/espana/politica/el-futuro-de-puente-divide-al-psoe-moncloa-teme-que-su-dimision-suponga-cargar-con-la-culpa-por-el-accidente.html'),
      ] }] },
    { key: 'eco', title: 'Economía', stories: [{
      kicker: 'Transporte', time: '05.11',
      title: 'La crisis ferroviaria aleja el fin de los vuelos cortos y refuerza el Puente Aéreo',
      visual: { photo: 'airport runway', grad: 'radial-gradient(100% 80% at 20% 10%,#ffe1a3 0%,transparent 55%),linear-gradient(170deg,#3a2a12 0%,#a8741e 50%,#f3d79a 100%)' },
      summary: 'Tras los accidentes de Adamuz y Urda, el objetivo de la Ley de Movilidad Sostenible de sustituir vuelos cortos por trenes de menos de dos horas y media se aleja: el estudio previsto no se ha puesto en marcha. La caída de viajeros en la alta velocidad Madrid-Barcelona beneficia al Puente Aéreo.',
      stats: [['−13 %', 'viajeros AVE Madrid-BCN (T2)'], ['14,6 M', 'viajeros en 2024 (CNMC)'], ['+4,7 %', 'tráfico en Barajas'], ['24.000', 'vuelos cortos sustituibles']],
      prepa: { tag: 'Espagnol LV2 · Éco', text: 'Transición ecológica y arbitraje tren/avión: un caso de política pública.' },
      sources: [ S('elDiario.es', 'La crisis ferroviaria aleja la meta de eliminar los vuelos de corto radio y refuerza el Puente Aéreo', 'https://www.eldiario.es/economia/crisis-ferroviaria-aleja-meta-eliminar-vuelos-corto-radio-refuerza-puente-aereo_1_13642115.html', true) ] }] },
    { key: 'int', title: 'Internacional', stories: [], briefs: [
      S('Euronews', 'Zelenski pide en la Cumbre Iberoamericana de Madrid ayuda urgente para la red eléctrica ucraniana', 'https://fr.euronews.com/2026/11/06/a-madrid-zelensky-lance-un-appel-urgent-a-laide-pour-sauver-le-reseau-electrique-ukrainien') ] },
    { key: 'tec', title: 'Tecnología', stories: [], briefs: [
      S('elDiario.es', 'España lidera la primera movilización europea contra los centros de datos', 'https://www.eldiario.es/tecnologia/espana-lidera-primera-movilizacion-europea-centros-datos-promesas-ia-son-falsas_1_13639661.html') ] },
    { key: 'cul', title: 'Cultura', stories: [], briefs: [
      S('Infobae', 'Lotería de Navidad 2026: se estrena el anuncio, titulado «Corazonada»', 'https://www.infobae.com/espana/2026/11/06/estrenan-el-anuncio-de-la-loteria-de-navidad-2026-se-titula-corazonada-y-se-ha-grabado-en-un-pueblo-asturiano/') ] },
    { key: 'spo', title: 'Deporte', stories: [], briefs: [
      S('Infobae', 'De la Fuente da la lista para la Nations League con un homenaje a Jesús de Miguel y a las víctimas de Urda', 'https://www.infobae.com/espana/deportes/2026/11/06/luis-de-la-fuente-da-la-lista-de-la-seleccion-espanola-para-la-nations-league-con-un-sentido-homenaje-a-jesus-de-miguel-y-las-victimas-del-accidente-de-urda/') ] },
  ],
  vocab: { title: 'Política y transporte', items: [
    ['la dimisión', 'f.', 'la démission', 'Puente anuncia su dimisión como ministro de Transportes.'],
    ['el choque por alcance', 'm.', 'la collision par l’arrière', 'Un AVE chocó por alcance contra un tren de Iryo.'],
    ['la mayoría absoluta', 'f.', 'la majorité absolue', 'PP y Vox suman 197 escaños, muy por encima de la mayoría absoluta.'],
    ['las listas electorales', 'f. pl.', 'les listes électorales', 'Puente no irá en las listas del 29N.'],
    ['el Puente Aéreo', 'm.', 'la navette aérienne Madrid–Barcelone', 'La alternativa del transporte aéreo sale reforzada.'],
    ['el luto oficial', 'm.', 'le deuil national', 'El Gobierno declaró tres días de luto.'],
  ] },
},
];

export const threads = {
  fr: { kicker: 'Environnement', title: 'Épisodes méditerranéens 2026', intro: 'Les pluies diluviennes qui frappent le Sud-Est et la Corse depuis la mi-octobre, épisode par épisode.', map: 'map-floods', nodes: [
    { st: 'next', d: 'À suivre', h: 'Vigilance orange en Corse-du-Sud', p: 'Le niveau de vigilance et les bilans seront repris dans le brief de demain.' },
    { st: 'now', d: 'Ven 06 nov · Aujourd’hui', h: 'Corse : deux morts, plus de deux mois de pluie en 48 h', p: '285 mm à Conca, au moins 70 personnes évacuées. Le Vidourle monte de plus de 1,50 m en deux heures à Sommières (Gard). Euronews porte à 4 morts le bilan de l’épisode du 20 octobre.', src: 'Euronews', map: true },
    { st: '', d: 'Mar 20 oct', h: 'Premier épisode : un mort près de Marseille, un disparu en Haute-Corse', p: 'Près de 400 mm au nord de Solenzara, dont 191 mm en une heure ; l’A9 fermée plusieurs heures à Nîmes.', src: 'Euronews' } ] },
  en: { kicker: 'Politics', title: 'Midterms 2026', intro: 'From election night to the last uncalled races.', map: 'map-us', nodes: [
    { st: 'next', d: 'Next', h: 'Alaska and Mississippi Senate races', p: 'Alaska could go to ranked-choice tabulation; Mississippi hinges on provisional ballots.' },
    { st: 'now', d: 'Thu 05 Nov · Latest', h: 'Democrats have flipped 43 House seats', p: 'CBS News’s latest count: 43 districts to Democrats, two to Republicans. Scott Colom leads by 65 votes in Mississippi.', src: 'CBS News', map: true },
    { st: '', d: 'Wed 04 Nov', h: 'Voters hand Democrats both chambers of Congress', p: 'PBS NewsHour calls it a rebuke of President Trump.', src: 'PBS NewsHour' },
    { st: '', d: 'Tue 03 Nov', h: 'Election day', p: '435 House seats and 35 Senate seats on the ballot.', src: 'Euronews' } ] },
  es: { kicker: 'Política', title: 'Crisis ferroviaria 2026', intro: 'De Adamuz a la dimisión del ministro de Transportes, episodio por episodio.', map: 'map-spain', nodes: [
    { st: 'next', d: 'Próximo', h: 'Elecciones generales del 29 de noviembre', p: 'La crisis ferroviaria entra en la campaña.' },
    { st: 'now', d: 'Mar 03 nov', h: 'Óscar Puente dimite y renuncia a las listas del 29N', p: '«Es una cuestión de dignidad política, de coherencia y de empatía con las víctimas».', src: 'Alicante Plaza', map: true },
    { st: '', d: 'Mié 28 oct', h: 'Urda: un AVE choca por alcance contra un tren de Iryo detenido', p: 'Medio millar de viajeros a bordo de los dos trenes; el Gobierno decreta tres días de luto.', src: 'elDiario.es' },
    { st: '', d: 'Dom 18 ene', h: 'Adamuz: 46 víctimas mortales', p: 'Primer gran accidente de la alta velocidad del año, aún en investigación.', src: 'elDiario.es' } ] },
};
