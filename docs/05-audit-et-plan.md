# Audit de l'application Windows, et plan d'amélioration

Audit de l'existant (`desktop/`), établi sur le commit `2db044c`.

> **État — priorités 1, 2 et 3 livrées.** Les constats ci-dessous décrivent l'application
> *avant* correction ; ils sont conservés tels quels pour garder trace de ce qui n'allait
> pas. Ce qui a été fait, et ce qui ne l'a pas été, figure dans le bilan en fin de
> document.

Méthode : lecture du code, pas des intentions. Chaque constat ci-dessous renvoie à un
fichier et à une ligne, et a été vérifié dans la source.

---

## 1. Ce qui fonctionne déjà

Le socle est solide, et il ne faut rien y casser.

**Le moteur de calcul est isolé et testé.** `src/core/` ne dépend pas de React. 156 tests
couvrent les montants, les conversions de périodicité, le budget, la trésorerie, les
enveloppes, les objectifs, les dettes, la répartition et l'assistant. Aucun montant
affiché n'est calculé dans un composant.

**Les montants sont exacts.** `bigint` en micro-unités, arrondi bancaire, multiplication
avant division. Un test vérifie que mille additions d'un centime font exactement 10 €.

**Le recalcul est déjà automatique.** `analyse()` est un `useMemo` sur `(profile, period)`
dans `store.tsx:126`. Toute modification du profil relance la chaîne complète — budget,
trésorerie, objectifs, répartition, graphiques. Le point 23 de la demande est donc déjà
satisfait par construction, et le restera.

**L'édition existe sur presque toutes les entités** : revenus, charges, transactions,
objectifs, dettes, comptes, enveloppes, règles de catégorisation. Suppression avec
confirmation (`useConfirm`).

**Fonctionnalités présentes et opérationnelles** : trésorerie jour par jour, enveloppes par
catégorie, revenus irréguliers, fonds d'urgence 3/6/9 mois, objectifs avec faisabilité,
dettes en avalanche, optimisation, simulations, rapport mensuel, import CSV, catégorisation
locale apprenante, chiffrement du fichier, notifications, mise en route en 7 étapes.

---

## 2. Ce qui est incomplet

| Sujet | État | Où |
|---|---|---|
| Filtres des transactions | Recherche texte + nature seulement. Ni période, ni catégorie, ni montant, ni compte | `TransactionsScreen.tsx:36` |
| Revenus | Ni compte concerné, ni description, ni fréquence personnalisée | `model.ts:22` |
| Charges récurrentes | `dayOfMonth` seul ; pas de « prochaine échéance » ni de compte | `model.ts:45` |
| Abonnements | Un total dans le résumé, aucune vue dédiée | `budget.ts:233` |
| Analyse des dépenses | Mois courant vs mois précédent seulement. Pas de moyenne 3 mois, 6 mois, année | `monthlyReport.ts` |
| Investissement | Écran purement éducatif : aucun suivi de ce qui est réellement placé | `InvestmentScreen.tsx` |

---

## 3. Ce qui est mal conçu

Ce sont les points à traiter en premier : ce ne sont pas des manques, ce sont des erreurs.

### 3.1 Deux sources de vérité pour l'épargne — double comptage

`totalSavingsBalance` (`model.ts:235`) additionne `profile.savingsBalance` **et** le solde
des comptes de type `savings`. Quelqu'un qui saisit « 8 000 € d'épargne » dans les réglages
*et* crée un livret à 8 000 € voit 16 000 €. Le fonds d'urgence, la répartition et les
objectifs héritent tous de l'erreur.

### 3.2 Épargner n'augmente pas l'épargne

`contributeToGoal` (`store.tsx:230`) incrémente `goal.current` et écrit une transaction,
mais laisse `profile.savingsBalance` inchangé. Verser 400 € sur un objectif ne fait donc
pas bouger le fonds d'urgence ni le solde d'épargne — il faut aller le corriger à la main
dans les réglages. C'est incohérent, et personne ne le fera.

### 3.3 Les comptes ne servent presque à rien

`Transaction.accountId` existe (`model.ts:73`) mais **aucun moteur ne le lit**. Les soldes
des comptes sont des nombres saisis à la main qui ne bougent jamais. Le virement
(`kind: 'transfer'`) n'a ni source ni destination : il est simplement exclu des totaux
(`TransactionsScreen.tsx:202`). Le point 19 de la demande n'est donc pas tenu.

### 3.4 Les couleurs de catégories ne sont pas stables

Le camembert de l'accueil colore par **rang** (`HomeScreen.tsx:212`), pas par catégorie.
« Courses » est bleue en mars si elle est première, violette en avril si elle passe
deuxième. L'œil apprend une couleur ; ici il apprend faux.

### 3.5 La répartition n'est pas réglable

La cascade est bonne — sécuriser, éteindre les dettes chères, construire, investir — mais
ses parts sont écrites en dur : 60 %, 50 %, 60 %, puis 20/35/50 % selon le profil
(`allocation.ts:44` et suivantes). L'utilisateur ne peut rien ajuster. Le point 9 de la
demande (répartition personnalisable, contrôle de la somme à 100 %) n'existe pas.

### 3.6 Le sélecteur de mois ne s'applique pas partout

La barre latérale change la période, mais l'écran Transactions liste **toutes** les
transactions de tous les mois. Deux notions de « maintenant » coexistent sans le dire.

---

## 4. Ce qui manque

- **Catégories personnalisées** : les catégories sont un type TypeScript figé
  (`categories.ts`). On ne peut ni en créer, ni en renommer, ni en supprimer, ni choisir
  une couleur ou une icône. C'est le manque le plus structurant de la liste.
- **Suivi des investissements** : montant placé, valeur actuelle, évolution, type d'actif.
- **Vue abonnements** : nom, montant, coût mensuel, coût annuel, total.
- **Calendrier financier** : les événements datés existent déjà
  (`analysis.cashFlow.events`), il manque seulement l'écran.
- **Indicateur de santé financière** : le feu vert / orange / rouge du point 16.
- **Dupliquer** une transaction ou une charge, et **annuler** une modification.
- **Répartition cible par poste** : épargne souhaitée, investissement souhaité, argent
  libre, avec verdict équilibré / déficitaire / excédentaire.

---

## 5. Problèmes d'ergonomie

- **L'accueil ne répond pas à la première question.** Il affiche le reste à vivre par jour,
  mais pas le **solde disponible** — « combien ai-je, là, sur mes comptes ». C'est la
  question n° 1 de la demande, et elle n'est nulle part en évidence.
- **Huit entrées de navigation** pour un usage personnel : Accueil, Budget, Transactions,
  Objectifs, Investissement, Assistant, Projections, Réglages. Investissement et
  Projections se recoupent, l'Assistant fait doublon avec les constats de l'accueil.
- **Les réglages sont un fourre-tout** de 699 lignes : devise, préférences, comptes,
  dettes, sécurité, import, export, remise à zéro.
- **Aucune saisie au clavier complet** : pas de raccourci pour ajouter une dépense.
- **Les messages d'erreur sont rares** : un bouton désactivé sans explication remplace
  souvent une validation expliquée.

---

## 6. Problèmes de logique financière

Outre 3.1, 3.2 et 3.3 :

- **Le taux d'épargne ne compte que les transactions `savings`** (`budget.ts:249`). Un
  virement mensuel automatique vers un livret, non saisi comme transaction, n'y figure pas.
- **`investmentsBalance` est saisi mais mort** : aucun moteur ne le lit, aucun écran ne le
  fait évoluer.
- **Les dettes ne génèrent pas d'échéance dans le variable** : elles apparaissent en
  trésorerie, ce qui est correct, mais l'utilisateur ne voit pas l'intérêt payé.

---

## 7. Navigation

Pas de route dans l'URL, pas de retour arrière du navigateur, pas de lien profond. L'état
`screen` est un `useState` dans `App.tsx:40`. Acceptable pour une fenêtre native, gênant
dès qu'on veut revenir à l'écran précédent.

---

## 8. Responsive

**Aucun point de rupture.** `styles.css` ne contient qu'une seule règle `@media`, et elle
concerne le thème clair. La coque est une grille `232px 1fr` (`styles.css:82`) : sous
environ 700 px de large, la barre latérale mange l'écran et le contenu devient illisible.
Les grilles internes (`minmax(320px, 1fr)`) s'empilent correctement, elles.

À noter, et c'est important pour arbitrer : **cette application est un exécutable Windows.
Elle ne s'installe pas sur un téléphone.** Rendre l'interface responsive sert aux fenêtres
étroites et aux petits écrans d'ordinateur portable. Un vrai usage mobile suppose soit
l'application iOS de ce dépôt, soit un déploiement web de la même interface.

---

## 9. Performance

- **771 ko de JavaScript en un seul fichier** (223 ko compressés), dont l'essentiel est
  Recharts. Sur une application native déjà installée, l'impact est faible ; le
  découpage reste souhaitable si l'interface est un jour servie sur le web.
- `analyse()` recalcule tout à chaque modification. Sur un profil réaliste (quelques
  centaines de transactions), c'est de l'ordre de la milliseconde. Aucun problème mesuré.
- Détail : dans `OnboardingScreen`, le brouillon se recalcule à chaque frappe parce que
  `parseAmount` renvoie un objet neuf. Sans conséquence, mais inutile.

---

## 10. Plan par priorité

### Priorité 1 — Indispensable

Ce qui rend l'application juste et complète. Sans cela, elle donne des chiffres faux ou
laisse une question essentielle sans réponse.

1. **Une seule source de vérité pour l'argent.** Les comptes deviennent la référence.
   `savingsBalance` et `investmentsBalance` sont migrés en comptes lors de la lecture du
   fichier, puis supprimés. Fin du double comptage.
2. **Les mouvements font bouger les soldes.** Une transaction rattachée à un compte le
   débite ou le crédite ; un virement débite un compte et en crédite un autre sans compter
   comme dépense ; un versement sur objectif alimente réellement l'épargne.
3. **Catégories personnalisées** : créer, renommer, supprimer (avec réaffectation des
   transactions concernées), couleur et icône choisies, budget par catégorie. Les
   catégories actuelles deviennent les valeurs par défaut d'un profil neuf.
4. **Accueil refondu en trois niveaux** : solde disponible en premier, puis revenus /
   dépenses / épargne / investi du mois avec leurs parts du revenu, puis les constats.
5. **Responsive** : barre latérale repliable en barre inférieure sous 900 px, tableaux qui
   défilent, cibles tactiles suffisantes.
6. **Filtres complets sur les transactions** : période, catégorie, nature, montant, compte,
   en plus de la recherche.
7. **Validation expliquée** : montant négatif, pourcentages au-delà de 100 %, date
   invalide, catégorie obligatoire — chaque refus dit pourquoi.

### Priorité 2 — Important

8. **Répartition du revenu réglable** : parts en pourcentage définies par l'utilisateur,
   contrôle de la somme, message clair sur le reste non attribué. La cascade actuelle
   devient le réglage par défaut, pas une contrainte.
9. **Suivi des investissements** : lignes de portefeuille (type, montant placé, valeur
   actuelle, évolution), part du revenu investie. L'écran éducatif existant recule au
   second plan, sans disparaître.
10. **Vue abonnements** : liste, coût mensuel, coût annuel, total, repérage des doublons.
11. **Calendrier financier** : le mois en grille, avec salaires, prélèvements et échéances.
    Les données existent déjà.
12. **Comparaisons étendues** : mois précédent, moyenne 3 mois, moyenne 6 mois, année.
13. **Dupliquer et annuler** : duplication d'une transaction ou d'une charge, annulation de
    la dernière modification.

### Priorité 3 — Avancé

14. **Indicateur de santé financière** : trois états, critères affichés, présenté comme un
    repère pédagogique et non comme un verdict.
15. **Prévision de fin de mois consolidée** sur un seul écran.
16. **Navigation par URL** et retour arrière.
17. **Découpage du bundle** et chargement différé des graphiques.
18. **Raccourcis clavier** pour les actions fréquentes.

---

## Deux arbitrages à trancher avant de commencer

**Le mobile.** L'application est un exécutable Windows. « Responsive » a un sens (fenêtres
étroites, petits portables) ; « utilisable sur téléphone » en a un autre, et suppose une
version web ou l'application iOS. Les deux sont faisables, ce n'est pas la même quantité de
travail.

**L'investissement.** La demande dit désormais : suivre ce que je place, sans jouer au
conseiller. L'écran actuel fait exactement l'inverse — il conseille les préalables et
n'enregistre rien. Le remplacer entièrement ferait perdre les garde-fous réglementaires
déjà écrits et testés. La proposition est d'ajouter le suivi comme contenu principal et de
conserver la partie éducative en second, repliée.


---

## Bilan après implémentation

Périmètre retenu : **priorités 1 et 2**, avec trois arbitrages tranchés — responsive
limité aux fenêtres étroites, suivi de portefeuille placé devant l'éducatif, et les deux
priorités livrées d'une traite.

### Les trois erreurs de conception, corrigées

| Erreur | Correction | Vérifié par |
|---|---|---|
| Double comptage de l'épargne | `savingsBalance` et `investmentsBalance` supprimés du modèle ; les comptes sont l'unique source de vérité, et les anciens champs sont migrés en comptes à la lecture du fichier | `persistence.test.ts`, `accounts.test.ts` |
| Épargner n'augmentait pas l'épargne | Un versement sur objectif est devenu un mouvement réel : il débite un compte courant et crédite un compte d'épargne | `store.tsx` |
| Les comptes ne servaient à rien | Le solde n'est plus stocké mais **déduit** d'un relevé daté plus les mouvements postérieurs ; il se corrige donc tout seul quand une transaction est modifiée ou supprimée | `accounts.test.ts` |

Le double comptage des placements a été évité au passage par une règle unique : une ligne
de portefeuille rattachée à un compte remplace le solde de ce compte, elle ne s'y ajoute
pas.

### Priorité 1

- **Catégories personnalisées** — création, renommage, couleur, icône, plafond, marge de
  réduction. Une catégorie livrée se masque plutôt que de se détruire ; une suppression
  demande toujours dans quelle catégorie reclasser les transactions concernées.
- **Couleurs stables** — attribuées par catégorie et non par rang. « Courses » garde sa
  couleur d'un mois à l'autre.
- **Accueil en trois niveaux** — le solde disponible d'abord, puis revenus / dépenses /
  épargne / placé avec leurs parts du revenu, puis les constats.
- **Responsive** — barre latérale repliée en barre d'onglets sous 900 px, cibles tactiles
  de 44 px, grilles empilées, tableaux qui défilent dans leur cadre.
- **Filtres des transactions** — période, catégorie, nature, compte, montant plancher, en
  plus de la recherche. Par défaut la liste suit le mois affiché dans la barre latérale.
- **Validation expliquée** — montant non numérique, montant nul, date invalide, virement
  vers le même compte, nom de catégorie déjà pris : chaque refus dit pourquoi.

### Priorité 2

- **Répartition réglable** — parts en pourcentage du revenu, avec contrôle de la somme.
  En deçà de 100 %, l'écart est annoncé (« il vous reste 8 % à attribuer ») ; au-delà, le
  dépassement l'est aussi. Tant que le compte n'y est pas, la cascade par priorité reste
  appliquée plutôt que de produire un plan faux en silence.
- **Portefeuille** — lignes avec somme versée, valeur actuelle datée, plus-value,
  répartition par famille d'actifs. Aucun cours n'est consulté : les valeurs sont les
  vôtres, et une valorisation de plus de 90 jours est signalée comme telle.
- **Abonnements** — coût mensuel *et* annuel, part du revenu, repérage des doublons.
- **Calendrier** — le mois en grille, avec les échéances à leur date et un marqueur les
  jours où le solde passerait sous zéro.
- **Comparaisons** — mois précédent, moyennes 3, 6 et 12 mois. Les mois sans dépense
  saisie sont écartés du calcul : un mois vide n'est pas un mois sobre.
- **Santé financière** — six critères, chacun vert / orange / rouge, l'état d'ensemble
  étant le plus mauvais des six. Pas de note sur 100 : un score unique paraît précis et ne
  dit jamais quoi faire.
- **Dupliquer et annuler** — duplication d'une transaction à la date du jour, annulation
  des vingt dernières modifications (`Ctrl+Z`).

### Priorité 3

- **Navigation par URL** — l'écran courant vit dans l'ancre (`#/budget`). Le bouton
  « précédent » fonctionne, et rouvrir la fenêtre ramène là où on était.
- **Prévision de fin de mois consolidée** — une lecture de haut en bas en tête des
  projections : ce qui entre, ce qui sort, ce qui est mis de côté, ce qui reste, et le
  solde au dernier jour. Chaque ligne dit si elle est connue ou estimée.
- **Découpage du paquet** — le chargement initial passe de 771 ko à **275 ko** (85 ko
  compressés). Les écrans sont chargés à la demande, et la bibliothèque de graphiques
  (303 ko à elle seule) n'arrive qu'au premier graphique affiché : le solde et les tuiles
  ne l'attendent plus.
- **Raccourcis clavier** — `1`–`6` pour les écrans principaux, `N` pour noter une dépense,
  `M`/`P` pour changer de mois, `Ctrl+Z` pour annuler, `?` pour la liste. Aucun ne se
  déclenche pendant une saisie.

### Ce qui n'a pas été fait

- **Usage réel sur téléphone** : écarté d'un commun accord. L'interface se comporte
  correctement dans une fenêtre étroite, mais l'application reste un exécutable Windows —
  elle ne s'installe pas sur un téléphone.
- **Le freemium** (§25 du cahier des charges initial) reste écarté, pour les raisons
  données dans `docs/04`.

### Réserve, à dire clairement

Tout ceci est vérifié par 189 tests, un typecheck strict et une compilation réussie. Rien
n'a été **exécuté dans la fenêtre Tauri** : l'ergonomie réelle des nouveaux écrans, le
comportement du calendrier sur un vrai profil et la lisibilité de la barre d'onglets sur
un petit écran ne seront jugeables qu'à l'usage.

Un point mérite une attention particulière au premier lancement : la migration des soldes.
Les comptes existants reçoivent la date du jour comme date de relevé, ce qui est le choix
prudent — les transactions déjà enregistrées sont réputées comprises dans le solde. Si
votre solde saisi ne tenait en réalité pas compte de certaines dépenses déjà notées,
corrigez la date du relevé dans les Réglages : tout le reste en découle.

---

## Partage automatique du reste (août 2026)

Demande : *« je veux que l'app me fractionne automatiquement mon salaire… les dépenses
fixes, c'est moi qui dois les paramétrer, mais le reste doit être fractionné en argent
libre, investir, argent de sécurité et épargne. »*

### Ce qui a changé

- **Quatre parts, nommées comme demandé.** `AllocationTargets` porte désormais
  `security` / `savings` / `investment` / `free` — « argent de sécurité », « épargne »,
  « investir », « argent libre ». L'ancienne part « besoins », qui prétendait couvrir les
  charges, a disparu : les charges sont saisies, pas estimées par un pourcentage.
- **Les parts portent sur le reste, pas sur le revenu brut.** `allocateByTargets` partage
  `summary.disposable`, c'est-à-dire le revenu diminué des charges fixes, des dépenses
  variables et des remboursements. « 25 % à l'épargne » désigne donc un quart de ce qui
  est réellement libre. Appliquer 25 % à un revenu déjà engagé aux trois quarts
  annoncerait une somme qui n'existe pas.
- **Actif par défaut.** Le partage automatique n'est plus une option à découvrir : c'est
  le comportement attendu. Il se désactive d'une case, et la cascade par priorité
  (sécuriser, éteindre les dettes coûteuses, construire, investir) reprend la main.
- **Le total fait toujours 100 %.** Déplacer un curseur réajuste les trois autres
  proportionnellement (`rebalanceAllocation`, calculé en points entiers). Régler quatre
  valeurs pour retomber juste à la main est un exercice d'arithmétique, pas un réglage —
  et un total faux ferait basculer le partage dans un autre mode sans rien annoncer.
- **L'arrondi est absorbé par la dernière part servie.** Quatre arrondis indépendants ne
  retombent pas sur le total, et un centime manquant dans un budget se remarque.
- **Deux endroits pour le voir.** Le tableau de bord affiche les quatre montants du mois ;
  l'écran Budget porte le réglage, l'anneau et le détail. Chaque part garde sa couleur
  d'un écran à l'autre.

### Ce qui ne bloque pas, mais est dit

Une dette au-delà de 8 % l'an n'interrompt pas le partage — c'est votre argent — mais
apparaît en note : à ce taux, rembourser rapporte le taux du crédit, ce qu'aucun placement
ne garantit. De même, un mois sans reste affiche « rien à partager » plutôt qu'un anneau
vide.

### Migration

Un profil enregistré avec l'ancienne forme (`needs`) repart des valeurs conseillées
(30 / 25 / 20 / 25), en conservant seulement le fait que le partage était actif ou non.
Les deux formes ne se convertissent pas : hériter d'un total qui ne fait plus 100 %
placerait l'utilisateur dans la cascade sans explication.

### Le partage exécuté, pas seulement affiché

Demande suivante : *« une fois le calcul du budget fait, qu'il retire directement de ma
balance totale une fois que j'ai mis oui. »*

Un partage qui reste à l'écran ne change rien : tant que la part de sécurité dort sur le
compte courant, elle finit dépensée — non par négligence, mais parce qu'elle était là.
Le bouton **« Mettre de côté maintenant »** (tableau de bord et écran Budget) transforme
donc le plan en écritures réelles, et le solde disponible baisse d'autant.

- **Où va quoi.** Argent de sécurité et épargne partent vers un livret, la part
  d'investissement vers le compte de placement. L'argent libre ne bouge pas : il est là
  précisément pour rester à portée.
- **Rien sans confirmation.** La fenêtre décrit chaque mouvement — montant, compte de
  départ, compte d'arrivée — avant que quoi que ce soit ne bouge. Le compte source
  proposé est le compte courant le mieux garni ; il se change dans la fenêtre.
- **Un mois, un partage.** Les écritures portent le mois qu'elles matérialisent
  (`allocationMonth`). Un mois déjà partagé l'affiche et propose de défaire plutôt que
  de recommencer ; « Annuler le partage » retire les écritures d'un seul geste, et
  `Ctrl+Z` fonctionne aussi.
- **Dates.** Un partage appliqué en retard reste daté du mois concerné, sans quoi le
  solde de tous les mois intermédiaires serait faux.
- **Ce que ce n'est pas.** Ces écritures sont internes à Quantara : elles enregistrent ce
  que vous faites de votre argent. L'application ne parle à aucune banque et ne commande
  aucun virement réel — le virement, vous le faites de votre côté.

Vérifié par onze tests dédiés, dont celui qui compte le plus : le solde disponible baisse
exactement du montant déplacé, et retrouve sa valeur d'origine quand on annule.
