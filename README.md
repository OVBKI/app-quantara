# Quantara

Gestion de budget avec assistant financier. Deux applications, un même modèle de calcul :

| | |
|---|---|
| [`Quantara/`](Quantara) + [`QuantaraCore/`](QuantaraCore) | Application **iOS** (SwiftUI), avec conseiller IA |
| [`desktop/`](desktop) | Application **Windows** (Tauri), moteur transposé en TypeScript |

> **État du dépôt** — Le projet compile et les 76 tests unitaires du cœur métier
> passent, vérifiés par l'intégration continue sur un runner macOS (Xcode 16.4,
> SDK iOS 18.5). L'application n'a en revanche **jamais été exécutée sur un appareil** :
> rien n'a encore été validé à l'usage. Voir « Tester sans Mac » et « Avant la première
> exécution » plus bas.

---

## Documentation

| Document | Contenu |
|---|---|
| [`docs/01-analyse-et-ameliorations.md`](docs/01-analyse-et-ameliorations.md) | Analyse du cahier des charges, manques identifiés, améliorations proposées, périmètre v1 |
| [`docs/02-architecture.md`](docs/02-architecture.md) | Architecture technique, écrans, modèles de données, moteur de calcul budgétaire |
| [`docs/03-moteur-ia.md`](docs/03-moteur-ia.md) | Pack de faits, prompt système, outils, garanties anti-hallucination |
| [`docs/04-couverture-du-cahier-des-charges.md`](docs/04-couverture-du-cahier-des-charges.md) | Les 26 sections, une par une : fait, partiel ou écarté — et pourquoi |
| [`docs/05-audit-et-plan.md`](docs/05-audit-et-plan.md) | Audit de la version Windows, plan par priorité, et bilan de ce qui a été livré |

---

## Structure

```
QuantaraCore/          Package Swift pur — tout le calcul financier, testé
  Sources/QuantaraCore/
    Money/             Money (Decimal), devises, arrondis
    Model/             Fréquences, catégories, entités, profil financier
    Engine/            Budget · Trésorerie · Allocation · Objectifs · Fonds d'urgence
                       Dettes · Simulation · Insights · Optimisation · Investissement
                       Rapport mensuel · Catégorisation · « Puis-je me le permettre »
    Advisor/           Pack de faits, prompt système, schémas et exécution des outils
  Tests/               Tests unitaires, dont les exemples chiffrés du cahier des charges

Quantara/              Application SwiftUI
  App/                 Point d'entrée, injection de dépendances, navigation, verrouillage
  DesignSystem/        Thème, composants, graphiques
  Persistence/         Entités SwiftData, mappage, DataStore
  Security/            Face ID / Touch ID / code PIN, Trousseau
  AI/                  Protocole conseiller, conseiller local, client API, boucle d'outils
  Notifications/       Programmation des notifications
  Entitlements/        Freemium (StoreKit 2)
  DataImport/          Import CSV
  Features/            Onboarding · Accueil · Budget · Transactions · Objectifs · IA · Réglages
  Resources/           Info.plist, catalogue d'assets, localisations FR et EN

Quantara.xcodeproj/    Projet Xcode (dossier synchronisé, Xcode 16+)

desktop/               Application Windows — voir desktop/README.md
  src/core/            Moteur financier en TypeScript, 189 tests
  src/security/        Chiffrement du fichier (PBKDF2 + AES-GCM)
  src/ui/              Écrans
  src-tauri/           Enveloppe native
```

---

## Principes de conception

**Le calcul est séparé de l'explication.** `QuantaraCore` produit tous les chiffres ;
le modèle de langage les explique et les met en perspective. Il reçoit un « pack de
faits » (`FinancialFacts`) et l'interdiction d'énoncer un montant qui n'en provient pas.
Pour les questions ouvertes, il appelle des outils exécutés localement par le même
moteur. Conséquence : aucune hallucination numérique possible, et chaque montant affiché
est rattachable à une fonction couverte par un test.

**L'argent est en `Decimal`.** Jamais en `Double` : `0.1 + 0.2 != 0.3` en binaire, et
l'écart devient visible dès qu'on additionne quelques centaines de transactions.

**Local-first.** L'appareil est la source de vérité. L'application est pleinement
fonctionnelle hors ligne, y compris le plan financier, les alertes et l'optimisation —
qui sont calculés par des règles déterministes, pas par le modèle.

**Rien ne sort sans consentement.** Le mode par défaut est « local uniquement » : aucune
donnée transmise. Le mode « agrégats » n'envoie que des totaux par catégorie et des
ratios — ni libellé, ni marchand, ni date précise. Le mode « détaillé » ajoute les
libellés, uniquement pour la catégorisation, et doit être activé explicitement.

**L'investissement est éducatif.** Classes d'actifs génériques, aucun produit ni
émetteur nommé, langage descriptif, avertissement de risque non masquable. Une
recommandation personnalisée portant sur un instrument financier relève du conseil en
investissement réglementé (MiFID II) et suppose un agrément — ce n'est pas ce que fait
cette application.

---

## Tester sans Mac (Windows / Linux)

Une application iOS ne se compile pas hors de macOS. Deux contournements, dans l'ordre :

**1. Compiler via GitHub Actions (gratuit, aucun Mac requis)**

Le workflow `.github/workflows/ci.yml` s'exécute à chaque `push` sur un Mac fourni par
GitHub. Onglet **Actions** du dépôt :

- le job *Cœur métier* lance les tests unitaires — c'est là qu'est toute la logique
  financière, et c'est ce qui valide les calculs ;
- le job *Application iOS* compile pour le simulateur et publie un artefact
  `Quantara-simulator.zip`.

Les erreurs de compilation apparaissent dans le journal du job. C'est le moyen le plus
rapide d'obtenir un retour depuis Windows.

**2. Manipuler l'application dans un navigateur**

Téléchargez l'artefact `Quantara-simulator.zip` depuis l'onglet Actions, puis déposez-le
sur un service de streaming de simulateur (Appetize.io propose une offre gratuite
limitée). L'application s'exécute alors dans le navigateur, cliquable, sans machine
Apple. C'est suffisant pour parcourir l'onboarding, saisir un budget et vérifier les
écrans ; ce n'est pas suffisant pour tester Face ID, les notifications ou les achats
intégrés.

**Version Windows** — une application de bureau distincte existe désormais dans
[`desktop/`](desktop) : elle s'exécute nativement sous Windows et se télécharge depuis
l'onglet Actions (workflow *Application Windows*). Elle reprend le même modèle de calcul,
transposé en TypeScript et testé indépendamment.

**Autres options** : louer un Mac à l'heure (Scaleway Mac mini, MacinCloud, MacStadium),
ou emprunter un Mac le temps d'une session. Les machines virtuelles macOS sur PC sont
contraires aux conditions d'utilisation d'Apple et instables — je ne les recommande pas.

---

## Avant la première exécution

1. **Ouvrir le projet**

   ```sh
   open Quantara.xcodeproj
   ```

   Le projet utilise un *dossier synchronisé* (Xcode 16+) : les fichiers sont repris
   automatiquement depuis le dossier `Quantara/`, sans référence à maintenir.

2. **Lancer les tests du package** — toute la logique s'y trouve, et ses tests valident
   les exemples chiffrés du cahier des charges :

   ```sh
   cd QuantaraCore && swift test
   ```

3. **Signature** — renseigner une équipe de développement dans les réglages de la cible
   (`Signing & Capabilities`). L'identifiant de bundle par défaut est
   `app.quantara.Quantara`.

4. **iCloud (facultatif)** — la synchronisation multi-appareils est déclarée
   (`cloudKitDatabase: .automatic`) mais ne s'active que si la capacité iCloud est
   ajoutée à la cible avec un conteneur CloudKit. Sans elle, l'application fonctionne
   en local, sans erreur.

5. **Achats intégrés** — créer les produits `app.quantara.premium.monthly` et
   `app.quantara.premium.yearly` dans App Store Connect, ou ajouter un fichier
   `.storekit` pour tester localement. **La validation des reçus côté serveur reste à
   brancher** : la vérification purement locale est contournable.

6. **Conseiller IA** — l'application démarre en mode « local uniquement » et n'a besoin
   d'aucune clé. Pour activer le mode conversationnel :
   - **production** : renseigner `QuantaraAdvisorProxyURL` dans `Info.plist` et
     déployer le relais (il détient la clé d'API, authentifie l'appareil et applique
     les quotas) ;
   - **développement** : stocker une clé dans le Trousseau sous
     `KeychainStore.Key.developmentAPIKey` — le chemin direct n'existe que sous `#if DEBUG`.

   **Ne jamais embarquer de clé d'API dans le binaire** : elle est extractible en
   quelques minutes.

---

## Points restant à traiter avant une mise en production

- Exécution sur appareil réel (jamais faite : seule la compilation est vérifiée).
- Relais serveur pour l'API du conseiller (non inclus : hors périmètre de l'app).
- Validation serveur des achats StoreKit.
- Icône d'application (le catalogue ne contient qu'un emplacement vide).
- Tests d'interface et passage complet en VoiceOver / Dynamic Type AX5.
- Revue juridique des textes (`legal.*` dans les fichiers de localisation) par pays de
  distribution, en particulier l'avertissement investissement.

---

## Ce qui n'est pas implémenté (préparé, mais hors v1)

Connexion bancaire (protocole `BankSyncProvider` prévu), foyer multi-utilisateurs,
Apple Watch, widgets, Apple Wallet, version iPad dédiée, web, Android. Le cœur métier
étant isolé et sans dépendance UI, ces extensions le réutilisent tel quel.
