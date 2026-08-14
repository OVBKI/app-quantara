# Quantara pour Windows

Application de bureau de gestion de budget. Interface web, enveloppe native Tauri,
données stockées localement.

> **État** — Fonctionnellement complet pour la v1. Le moteur et l'interface compilent,
> et les 156 tests unitaires passent (vérifiés à chaque `push`). L'installateur Windows
> est produit par l'intégration continue.

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
  engine/            Budget · Revenus irréguliers · Enveloppes · Trésorerie
                     Objectifs · Fonds d'urgence · Dettes · Répartition
                     Analyse proactive · Optimisation · Simulation · Rapport mensuel
                     « Puis-je me le permettre » · Catégorisation · Import CSV
                     Investissement (éducatif) · Alertes
  advisor/           Assistant déterministe : réponses assemblées à partir des moteurs
  *.test.ts          Tests, dont les exemples chiffrés du cahier des charges

src/state/           État de l'application et persistance
src/storage/         Lecture et écriture du profil (fichier JSON ou stockage local)
src/security/        Chiffrement du fichier (PBKDF2 + AES-GCM)
src/notifications/   Envoi des alertes au centre de notifications du système
src/ui/              Écrans et composants
src-tauri/           Enveloppe native : fenêtre, droits d'accès au disque, notifications
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

**Un revenu irrégulier se planifie sur son mois faible.** Un salaire qui varie n'est pas
un salaire moyen : il porte une fourchette. Le plan se cale par défaut sur le bas, si bien
qu'un mois creux ne casse rien et qu'un bon mois dégage un surplus — une bonne nouvelle
plutôt qu'un rattrapage. Dès trois mois de revenus saisis, la fourchette déclarée cède la
place à la distribution réelle. Un montant déjà encaissé n'est plus une hypothèse : il
remplace l'estimation.

**Les dépenses variables se décident, pas seulement se constatent.** Une enveloppe par
catégorie, comparée en continu au calendrier : avoir consommé 60 % de son budget courses
n'a pas le même sens le 5 et le 25. Le plan réserve l'enveloppe même les mois calmes,
parce que c'est un engagement — mais si elle est déjà dépassée, c'est le réel qui prime.
Un poste sans enveloppe n'a aucune décision à tenir : il est extrapolé au rythme observé.

**La répartition suit le risque, pas le rendement.** Sécuriser un mois de dépenses,
éteindre les dettes coûteuses, compléter le fonds d'urgence, financer les objectifs, et
seulement ensuite investir. Chaque ligne affiche la raison du montant proposé.

**Rien ne sort de la machine.** Aucun appel réseau, aucun compte, aucune télémétrie. Le
profil est un fichier JSON lisible, exportable à tout moment depuis les réglages.

**Le chiffrement est facultatif, et son périmètre est dit.** Un mot de passe peut être
posé sur le fichier (PBKDF2-SHA256, 600 000 itérations, puis AES-GCM 256). Il protège une
sauvegarde ou un disque volé — pas une session déjà ouverte sur la machine. Le mot de
passe ne vit qu'en mémoire, jamais dans l'état de l'interface ni sur le disque : oublié,
il rend le fichier définitivement illisible, et c'est écrit avant de l'activer.

**Tout est modifiable.** Revenu, charge, transaction, objectif, dette, compte, enveloppe,
règle de catégorisation : chaque entité s'édite après coup. Une saisie qu'on ne peut que
supprimer et ressaisir décourage la correction, et un budget faux qu'on n'ose pas corriger
ne sert plus à rien.

---

## L'assistant ne ment pas, par construction

Chaque phrase qu'il produit est assemblée à partir d'un montant calculé par les moteurs.
Aucun modèle de langage n'intervient, rien ne quitte la machine, et aucun chiffre ne peut
donc être inventé — la règle « ne jamais inventer de données financières » du cahier des
charges est ici une propriété du code, pas une consigne qu'on espère voir respectée.

La contrepartie est assumée : l'assistant ne traite que les questions qu'il sait calculer
— répartition des dépenses, capacité d'épargne, fonds d'urgence, pistes de réduction,
santé du budget, dettes, dépense envisagée, effet du temps sur une épargne régulière — et
répond « je ne sais pas » au-delà. Sur de l'argent, c'est préférable à une réponse
plausible et fausse.

Un test vérifie qu'aucune réponse ne garantit un rendement, et un autre que les données
manquantes sont signalées plutôt que comblées.

---

## Notifications

Les alertes partent à l'ouverture de l'application : découvert prévu, prélèvements
importants dans les trois jours, enveloppe dépassée, palier d'objectif ou de fonds
d'urgence franchi, bilan du mois. Chacune se désactive séparément.

Limite énoncée franchement : **une application de bureau fermée ne notifie rien.**
Contrairement à un téléphone, aucun service ne tourne en arrière-plan pour elle. Une
situation qui dure se rappelle une fois par jour ; un palier, qui ne se franchit qu'une
fois, ne se répète jamais.

---

## Ce qui n'est pas encore là

Le modèle freemium : cette version est un outil personnel, un mur de paiement n'y a aucun
destinataire (voir `docs/04`).

La connexion bancaire automatique — elle suppose un agrégateur agréé (DSP2) et un
serveur, donc un périmètre au-delà de l'application. L'import CSV couvre le même besoin
sans intermédiaire : le relevé se télécharge depuis le site de la banque et s'importe en
deux clics, sans que personne d'autre n'y ait accès.
