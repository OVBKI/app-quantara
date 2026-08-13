# Quantara — Analyse fonctionnelle et propositions d'amélioration

> Document 1/3. Analyse du cahier des charges (§1 à §26), identification des manques,
> et propositions pour rendre l'application réellement compétitive face aux
> applications modernes de gestion financière (Bankin', Linxo, YNAB, Monarch, Copilot,
> Emma, Finary…).

---

## 1. Ce que le cahier des charges couvre déjà bien

| Domaine | Couverture | Commentaire |
|---|---|---|
| Revenus multi-sources + normalisation mensuelle | Complète | §3 |
| Dépenses fixes / variables catégorisées | Complète | §4-5 |
| Tableau de bord et indicateurs | Complète | §6 |
| Répartition intelligente du reste à vivre | Complète | §7 |
| IA conseillère + IA proactive + chat | Complète | §8, §12, §21 |
| Objectifs, fonds d'urgence, plans d'épargne | Complète | §9, §10, §13 |
| Investissement éducatif avec avertissements | Complète | §11 |
| Sécurité, RGPD, design, freemium | Complète | §17, §18, §25 |

Le socle est bon. Les manques se situent surtout sur **le modèle de données**, **la
prévision de trésorerie**, **la garantie de fiabilité de l'IA**, et **la conformité
réglementaire du volet investissement**.

---

## 2. Manques identifiés (par ordre d'impact)

### 2.1 — Les dettes et crédits ne sont pas modélisés (impact : critique)

Le §8 et la règle IA n°9 exigent de « tenir compte des dettes et crédits avant de
proposer une stratégie », mais aucune section ne définit une entité *Dette*. Un crédit
auto apparaît uniquement comme une ligne de dépense fixe — ce qui rend impossible :

- le calcul du **taux d'endettement** (DTI), indicateur central en France/Belgique
  (seuil d'usage : 33-35 % des revenus nets) ;
- l'arbitrage **rembourser vs investir**, qui dépend du taux d'intérêt ;
- les stratégies **avalanche** (taux décroissant) et **boule de neige** (solde croissant) ;
- l'affichage du capital restant dû et de la date de fin.

**Correctif retenu :** entité `Debt` de premier ordre (capital restant, TAEG, mensualité,
échéance, type, révolving ou amortissable), moteur `DebtEngine` (DTI, ordonnancement
avalanche/boule de neige, simulation de remboursement anticipé, coût total des intérêts).

### 2.2 — Aucune prévision de trésorerie jour par jour (impact : très fort, différenciant)

Le cahier des charges raisonne en agrégats mensuels. Or la question réelle de
l'utilisateur est : *« est-ce que je tiens jusqu'au 30 ? »*. Un budget mensuellement
équilibré peut être à découvert le 12 du mois si le loyer tombe avant le salaire.

**Correctif retenu :** `CashFlowEngine` — projection quotidienne du solde à partir des
échéances récurrentes (dates réelles de prélèvement et de réception) et du rythme de
dépense variable observé. Produit une courbe, le **solde minimum projeté**, la **date de
tension** et un **« reste à vivre journalier » (safe-to-spend)** — un chiffre unique,
actionnable, que les apps modernes mettent en avant.

### 2.3 — Aucun garde-fou technique contre l'invention de chiffres par l'IA (impact : critique)

Le §22 énonce dix règles (« ne jamais inventer de données financières », « expliquer ses
calculs »), mais une règle écrite dans un prompt n'est pas une garantie. Un LLM à qui l'on
demande de calculer un taux d'épargne se trompera occasionnellement.

**Correctif retenu — c'est le choix d'architecture central du projet :**

> **Le LLM ne calcule jamais. Il explique des chiffres calculés par un moteur
> déterministe.**

Tous les nombres proviennent de `QuantaraCore` (Swift pur, testé unitairement). Ils sont
sérialisés dans un **« pack de faits » (`FinancialFacts`)** transmis au modèle, qui reçoit
l'interdiction d'énoncer un montant absent de ce pack. Pour les questions ouvertes
(« et si j'épargne 700 € ? »), le modèle appelle des **outils** (`tool use`) exécutés
localement par le même moteur. On obtient : zéro hallucination numérique, explicabilité,
et traçabilité (chaque montant affiché est rattachable à une fonction testée).

### 2.4 — Le volet investissement est un risque réglementaire (impact : critique en UE)

Le §11 demande une « stratégie d'investissement personnalisée » basée sur le profil de
risque et les objectifs. En Union européenne, cela correspond à la définition du **conseil
en investissement** au sens de MiFID II (art. 4(1)(4)) : une recommandation personnalisée
portant sur un instrument financier, présentée comme adaptée à la personne. Cette activité
est réservée aux entités agréées.

**Correctif retenu :**
- recadrage explicite en **éducation financière** : classes d'actifs génériques (ETF,
  obligations, immobilier…), jamais de produit, d'ISIN, d'émetteur ou de courtier nommé ;
- pas de langage prescriptif (« vous devriez acheter ») → langage descriptif
  (« un profil équilibré à horizon 10 ans est *généralement* réparti ainsi ») ;
- avertissement de risque de perte en capital non masquable, affiché avant tout contenu ;
- prérequis bloquants explicités (fonds d'urgence, dettes à taux élevé) ;
- un `investmentEducationEnabled` désactivable par juridiction dans la configuration
  distante, pour pouvoir couper la fonctionnalité par pays sans mise à jour.

### 2.5 — Revenus irréguliers non traités (impact : fort)

§3 suppose des revenus stables. Pour un indépendant, un intérimaire ou un commercial
variabilisé, « revenu mensuel = 4 050 € » n'a pas de sens, et un budget bâti sur le
meilleur mois est un piège.

**Correctif retenu :** mode **revenu irrégulier** — budget construit sur la **médiane
glissante 6 mois** (ou le 30ᵉ percentile en mode prudent) plutôt que sur le dernier mois,
avec un **fonds de lissage** (les mois excédentaires alimentent une réserve qui comble les
mois creux). C'est un manque quasi universel des concurrents.

### 2.6 — Budget descendant uniquement, sans enveloppes ni plafonds (impact : fort)

L'application constate les dépenses mais ne permet pas de **décider à l'avance**.
Les notifications du §14 (« vous avez dépassé votre budget restaurant ») supposent
pourtant l'existence d'un plafond par catégorie — non défini.

**Correctif retenu :** **enveloppes budgétaires** (`CategoryBudget`) : plafond mensuel par
catégorie, consommation en temps réel, report du reliquat optionnel (*rollover*), et
proposition automatique de plafonds par l'IA à partir de l'historique.

### 2.7 — Aucune saisie de données au-delà du clavier (impact : fort sur la rétention)

C'est la première cause d'abandon des applications de budget : la saisie manuelle. §20
renvoie la connexion bancaire à plus tard, ce qui est raisonnable (DSP2 : agrément
d'agrégateur ou intégration d'un prestataire — Powens, Bridge, Tink, GoCardless…), mais
laisse la v1 sans solution.

**Correctif retenu pour la v1 :**
- **import CSV/OFX** avec mapping de colonnes mémorisé (contournement immédiat) ;
- **App Intents / Siri** : « Ajoute 32 € de courses » ;
- **Widget de saisie rapide** (interactive widget iOS 17+) ;
- **détection automatique des récurrences** dans les transactions importées ;
- OCR de ticket via VisionKit (montant + marchand).

### 2.8 — Aucune notion de foyer / comptes partagés (impact : moyen-fort)

Un budget de ménage à deux revenus et un loyer partagé est le cas majoritaire.

**Correctif retenu :** `Household` avec plusieurs membres et une clé de répartition
(50/50, au prorata des revenus, ou personnalisée) ; les dépenses portent un
`sharedRatio`. La synchronisation multi-utilisateurs est prévue au niveau du schéma
(CloudKit partagé) mais implémentée après la v1.

### 2.9 — Le rapport mensuel n'apprend pas (impact : moyen)

§15 compare deux mois. Il manque la boucle **prévu vs réalisé** : les dépenses variables
estimées à l'onboarding ne sont jamais confrontées à la réalité, donc l'estimation ne
s'améliore jamais.

**Correctif retenu :** suivi de l'**erreur d'estimation** par catégorie et recalibrage
automatique des prévisions (moyenne glissante pondérée), affiché honnêtement
(« vos courses dépassent votre estimation de 12 % en moyenne — j'ai ajusté »).

### 2.10 — Confidentialité de l'IA insuffisamment spécifiée (impact : critique RGPD)

§17 interdit l'entraînement sans consentement, mais ne dit rien de **ce qui est envoyé**
au fournisseur de modèle. Envoyer les libellés bruts de transactions (« Dr Martin —
cardiologie », « Pharmacie »), c'est transmettre des données de santé (art. 9 RGPD).

**Correctif retenu — trois niveaux de consentement granulaires :**

| Mode | Traitement | Réseau |
|---|---|---|
| **Local uniquement** (défaut) | Moteur déterministe + règles d'insights | Aucun envoi |
| **IA avancée — agrégats** | Envoi du pack de faits **agrégé** (montants par catégorie, ratios), aucun libellé, aucun marchand, aucune date précise | Chiffré, via proxy |
| **IA avancée — détaillé** | Ajoute les libellés pour la catégorisation automatique | Chiffré, via proxy |

Plus : **journal des envois** consultable (quoi, quand, pourquoi), minimisation par défaut,
et clé d'API jamais embarquée dans le binaire (relais serveur — cf. document 2 §9).

### 2.11 — Autres manques (correctifs intégrés à l'architecture)

| Manque | Correctif |
|---|---|
| Un seul compte, une seule devise | `Account` multi-comptes, devise par profil, calculs en `Decimal` (jamais `Double`) |
| Pas de recherche/filtres sur les transactions | Recherche plein texte, filtres, tags, transactions récurrentes détectées |
| Pas de mode hors-ligne explicité | Source de vérité locale (SwiftData), synchronisation opportuniste, file d'attente |
| Widgets / Watch / Wallet renvoyés « plus tard » | Cœur métier en package séparé sans dépendance UI → réutilisable tel quel par les extensions |
| Export non spécifié | CSV (données), PDF (rapport mensuel), JSON (portabilité RGPD art. 20) |
| Accessibilité citée sans critère | Dynamic Type jusqu'à AX5, VoiceOver sur tous les graphiques (valeurs verbalisées), contraste AA, Reduce Motion |
| i18n absente | FR/EN dès la v1, formats monétaires localisés (`FormatStyle`) |
| Analytics non cadrées | Opt-in, agrégées sur l'appareil, aucun identifiant, aucune donnée financière |
| Pas de motivation | Gamification légère : séries d'épargne, jalons du fonds d'urgence, « mois sous budget » |

---

## 3. Propositions d'amélioration compétitives

Au-delà des correctifs, cinq fonctionnalités qui positionnent réellement le produit :

1. **« Puis-je me le permettre ? »** — L'utilisateur saisit un montant et une échéance ;
   l'app répond par un feu tricolore, avec l'impact chiffré sur la trésorerie du mois, sur
   le fonds d'urgence et sur la date d'atteinte des objectifs. C'est la question que
   personne ne répond bien, et elle utilise tout le moteur déjà construit.

2. **Reste à vivre journalier (safe-to-spend)** — Un seul chiffre en tête d'écran, recalculé
   chaque jour : disponible ÷ jours restants, après provisionnement des échéances à venir.
   Remplace un tableau de bord que l'on regarde et qu'on ne sait pas exploiter.

3. **Audit d'abonnements** — Détection automatique des récurrences dans les transactions,
   total mensuel/annuel, doublons (deux services de streaming), abonnements dormants
   (aucune dépense associée), et hausses de tarif détectées.

4. **Confrontation prévu / réalisé** — Le budget devient un instrument qui s'améliore, et
   l'IA cesse d'être un générateur de conseils pour devenir un système qui apprend le
   comportement réel de l'utilisateur.

5. **Bilan annuel & effet composé** — Projection à 1/5/10/20 ans du patrimoine selon la
   trajectoire actuelle, avec la traduction concrète des arbitrages (« 50 €/mois de plus
   pendant 20 ans à 4 % ≈ 18 400 € »). C'est le levier motivationnel le plus fort.

---

## 4. Ce que je recommande de ne PAS faire en v1

| Élément | Raison |
|---|---|
| Connexion bancaire réelle | Agrément DSP2 ou contrat agrégateur, coût par utilisateur, complexité de recette. L'architecture la prépare (`BankSyncProvider`), l'implémentation attend la traction. |
| Recommandations d'investissement personnalisées | Risque réglementaire (§2.4). Éducation uniquement. |
| Version web / Android en parallèle | Disperse l'effort. Le cœur métier isolé permet un portage ultérieur (Kotlin Multiplatform ou service serveur). |
| Multi-devises avec conversion temps réel | Complexité (taux historiques, plus-values de change) sans valeur pour la cible initiale. Une devise par profil. |
| Modèle IA embarqué | La qualité de raisonnement requise dépasse ce qu'un modèle on-device offre aujourd'hui. Le mode « local uniquement » couvre le besoin de confidentialité via des règles déterministes. |

---

## 5. Périmètre retenu pour la v1

**Inclus :** les §1 à §26 du cahier des charges, plus les correctifs §2.1 à §2.11 et les
améliorations §3.1 à §3.5 de ce document.

**Préparé mais non implémenté :** connexion bancaire, foyer multi-utilisateurs,
Apple Watch, Wallet, iPad, web, Android.

La suite : [document 2 — architecture](02-architecture.md).
