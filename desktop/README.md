# Quantara pour Windows

Application de bureau de gestion de budget. Interface web, enveloppe native Tauri,
données stockées localement.

> **État** — Le moteur financier et l'interface compilent, et les 66 tests unitaires
> passent (vérifiés à chaque `push`). L'installateur Windows est produit par
> l'intégration continue ; il n'a pas encore été exécuté sur une machine Windows réelle.

---

## Lancer l'application

**Sans rien installer** — onglet **Actions** du dépôt, workflow *Application Windows* :
téléchargez l'artefact `Quantara-windows`, décompressez-le et lancez l'installateur
`.exe`. C'est la voie recommandée.

**Depuis les sources**, si Node 22 et Rust sont installés :

```sh
npm install
npm run tauri dev      # fenêtre native, rechargement à chaud
npm run tauri build    # installateur dans src-tauri/target/release/bundle/nsis/
```

L'interface seule tourne aussi dans un navigateur (`npm run dev`) : pratique pour
travailler sur les écrans sans recompiler la partie Rust. Le profil est alors conservé
dans le stockage local du navigateur plutôt que dans un fichier.

---

## Structure

```
src/core/            Moteur financier — aucune dépendance à React
  money.ts           Montants en bigint (micro-unités), arrondis, pourcentages
  frequency.ts       Conversion des périodicités vers l'équivalent mensuel
  categories.ts      Catégories, caractère essentiel, compressibilité
  yearMonth.ts       Périodes mensuelles, dates locales
  model.ts           Entités et sélecteurs
  engine/            Budget · Trésorerie · Objectifs · Fonds d'urgence · Dettes
                     Répartition · Analyse proactive · Statistiques
  *.test.ts          66 tests, dont les exemples chiffrés du cahier des charges

src/state/           État de l'application et persistance
src/storage/         Lecture et écriture du profil (fichier JSON ou stockage local)
src/ui/              Écrans et composants
src-tauri/           Enveloppe native : fenêtre, droits d'accès au disque
```

---

## Principes

**Le calcul est séparé de l'affichage.** Les moteurs de `src/core` produisent tous les
chiffres ; l'interface se contente de les mettre en forme. Aucun montant affiché n'est
calculé dans un composant.

**L'argent est en `bigint`.** Jamais en `number` : `0.1 + 0.2 !== 0.3` en binaire. Les
montants sont stockés en micro-unités, ce qui laisse de la marge aux calculs
intermédiaires avant l'arrondi au centime. Mille additions d'un centime font exactement
10 €, et c'est vérifié par un test.

**Multiplier avant de diviser.** `1 200 × (1/12)` rend 99,9996 ; `1 200 × 1 ÷ 12` rend
exactement 100. Toute conversion de périodicité passe par une fraction exacte.

**Les seuils sont explicites.** Charges fixes au-delà de 50 % du revenu, remboursements
au-delà d'un tiers, abonnements au-delà de 2 % : ce sont des choix de produit, réunis
dans un seul fichier et discutables, pas des constantes éparpillées.

**La répartition suit le risque, pas le rendement.** Sécuriser un mois de dépenses,
éteindre les dettes coûteuses, compléter le fonds d'urgence, financer les objectifs, et
seulement ensuite investir. Chaque ligne affiche la raison du montant proposé.

**Rien ne sort de la machine.** Aucun appel réseau, aucun compte, aucune télémétrie. Le
profil est un fichier JSON lisible, exportable à tout moment depuis les réglages.

---

## Ce qui n'est pas encore là

L'assistant conversationnel, l'optimisation « ✨ Optimiser mon budget », les simulations
d'investissement, les rapports de fin de mois et l'import CSV. Les moteurs correspondants
existent côté iOS ; ils seront transposés une fois cette base validée à l'usage.
