# Quantara — Architecture

> Document 2/3. Architecture technique, écrans, modèles de données et fonctionnement du
> moteur de calcul budgétaire. Le document 3 détaille le moteur IA.

---

## 1. Principes directeurs

1. **Le cœur métier ne dépend de rien.** `QuantaraCore` est un package Swift pur
   (Foundation uniquement) : ni SwiftUI, ni SwiftData, ni réseau. Il est donc testable en
   ligne de commande, réutilisable par les widgets, l'app Watch, une extension Wallet, et
   portable vers une autre plateforme.
2. **L'argent est en `Decimal`, jamais en `Double`.** `0.1 + 0.2 != 0.3` en binaire ;
   sur un budget cela produit des écarts visibles à l'affichage.
3. **L'IA n'invente aucun chiffre.** Elle reçoit un pack de faits calculé, et des outils
   pour demander des calculs supplémentaires. Voir document 3.
4. **Local-first.** L'appareil est la source de vérité ; la synchronisation est un
   agrément, pas une dépendance. L'app est pleinement fonctionnelle hors ligne.
5. **Minimisation des données.** Rien ne sort de l'appareil sans consentement explicite,
   granulaire et révocable, et ce qui sort est agrégé par défaut.

---

## 2. Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────────┐
│  Quantara (app iOS, SwiftUI)                                         │
│                                                                      │
│  Features/          Accueil · Budget · Transactions · Objectifs · IA │
│                     Onboarding · Réglages · Paywall                  │
│  DesignSystem/      Thème, composants, graphiques (Swift Charts)     │
│                                                                      │
│  ├── Persistence/   SwiftData (+ CloudKit)  ←→  Mappers  ←→  Core    │
│  ├── Security/      Face ID / Touch ID / PIN · Keychain · verrou     │
│  ├── AI/            AdvisorService · transports · outils · privacy   │
│  ├── Notifications/ UNUserNotificationCenter                          │
│  ├── Entitlements/  StoreKit 2 (freemium)                            │
│  └── Import/        CSV/OFX · détection de récurrences               │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ types valeur Sendable
┌──────────────────────────────▼───────────────────────────────────────┐
│  QuantaraCore (Swift pur, testé — aucune dépendance UI)              │
│                                                                      │
│  Money/    Money · Currency · arrondis                               │
│  Model/    Frequency · catégories · IncomeSource · RecurringExpense   │
│            Transaction · Debt · Goal · Account · CategoryBudget       │
│            RiskProfile · FinancialProfile · YearMonth                 │
│  Engine/   Budget · CashFlow · Allocation · Goal · EmergencyFund      │
│            Debt · Investment · Simulation · Insight · Optimization    │
│            MonthlyReport · Categorizer · Affordability                │
│  Advisor/  FinancialFacts (pack de faits) · prompt · schémas d'outils │
└──────────────────────────────────────────────────────────────────────┘
                               │ HTTPS (consentement requis)
┌──────────────────────────────▼───────────────────────────────────────┐
│  Relais Quantara (hors périmètre app) → API Claude (claude-opus-5)   │
│  Détient la clé API · authentifie l'appareil · quotas · aucun log     │
│  de contenu                                                          │
└──────────────────────────────────────────────────────────────────────┘
```

**Pourquoi un relais ?** Une clé d'API embarquée dans un binaire iOS est extractible en
quelques minutes. Le relais détient la clé, applique les quotas par utilisateur (essentiel
pour un modèle freemium), et permet de changer de modèle sans mise à jour de l'app. En
développement, un transport direct existe, protégé par un flag de compilation.

---

## 3. Couches et responsabilités

| Couche | Responsabilité | Ne fait pas |
|---|---|---|
| `Features/*/View` | Affichage, gestes, animations | Aucun calcul métier |
| `Features/*/Model` (`@Observable`) | État d'écran, orchestration, appels aux services | Aucune requête SwiftData directe dans les vues |
| `AppEnvironment` | Injection de dépendances (protocoles) | — |
| `DataStore` | Lecture/écriture SwiftData, conversion vers types Core | Aucun calcul financier |
| `QuantaraCore/Engine` | Tout le calcul financier | Aucune E/S |
| `AdvisorService` | Dialogue avec le modèle, exécution des outils | Aucun calcul propre |

Les services sont exposés via des protocoles (`AdvisorService`, `EntitlementStore`,
`BankSyncProvider`, `NotificationScheduling`, `AnalyticsSink`) afin de rendre les vues
testables et de permettre les implémentations différées (banque, Android…).

---

## 4. Modèle de données

### 4.1 Types de valeur (QuantaraCore)

```
Money          amount: Decimal, currency: Currency          — arithmétique sûre, arrondi bancaire
Frequency      daily…annual, oneOff                         — → équivalent mensuel
YearMonth      year: Int, month: Int                        — clé de période, Comparable

Account        id, name, kind(.checking/.savings/.investment/.cash/.credit), balance, isIncludedInBudget
IncomeSource   id, name, amount, frequency, category, dayOfMonth?, startDate, endDate?, isActive
RecurringExpense id, name, amount, frequency, category, dayOfMonth?, isEssentialOverride?, endDate?, isSubscription
Transaction    id, date, amount, kind(.income/.expense/.transfer/.savings), category, label,
               accountID?, note?, tags, merchantRaw?, isRecurringInstance, sharedRatio
Debt           id, name, kind, outstandingPrincipal, annualRate, monthlyPayment, remainingMonths?, isRevolving
Goal           id, kind, name, targetAmount, currentAmount, targetDate?, priority, monthlyContribution?, isArchived
CategoryBudget id, category, limit, rollover: Bool
RiskProfile    .conservative/.balanced/.dynamic/.aggressive  + horizonYears
FinancialProfile  agrégat de tout ce qui précède + soldes épargne/investissement + préférences
```

Toutes les catégories exposent `isEssential`, qui sert au calcul du fonds d'urgence
(§10 du cahier des charges) et à la distinction essentiel / discrétionnaire.

### 4.2 Persistance (SwiftData, `Persistence/Entities`)

Chaque type valeur a une entité `@Model` miroir (`SDIncomeSource`, `SDTransaction`…).
Contraintes imposées par CloudKit et respectées par le schéma :

- tout attribut est optionnel ou possède une valeur par défaut ;
- aucune contrainte `@Attribute(.unique)` ;
- toute relation est optionnelle et possède son inverse ;
- les montants sont stockés en `Decimal`, les énumérations en `String` brut (stabilité du
  schéma en cas de renommage Swift).

Les mappers (`Mapping/`) convertissent entité ↔ valeur. Les vues ne voient **jamais** une
entité SwiftData : elles reçoivent des types `Sendable` du cœur métier. Cela isole
complètement l'UI d'un futur changement de moteur de persistance.

### 4.3 Chiffrement

SwiftData chiffre déjà au repos via la protection de fichiers iOS. On force
`.completeUnlessOpen` sur le magasin, on stocke le sel du code PIN et le jeton du relais
dans le Trousseau (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`), et on masque le
contenu dans le sélecteur d'apps.

---

## 5. Le moteur de calcul budgétaire

### 5.1 Normalisation mensuelle

Toute somme récurrente est ramenée à un équivalent mensuel via le nombre d'occurrences
annuelles :

```
mensuel = montant × (occurrences/an) / 12
```

| Fréquence | occurrences/an | facteur mensuel |
|---|---|---|
| quotidienne | 365 | 30,4167 |
| hebdomadaire | 52 | 4,3333 |
| bimensuelle (14 j) | 26 | 2,1667 |
| mensuelle | 12 | 1 |
| trimestrielle | 4 | 0,3333 |
| semestrielle | 2 | 0,1667 |
| annuelle | 1 | 0,0833 |
| ponctuelle | — | 0 (hors récurrent) |

*Exemple du §4 :* assurance annuelle 1 200 € → 1 200 × 1/12 = **100 €/mois**.
*Exemple du §3 :* 3 000 + 250 + 800 = **4 050 €/mois**.

Le choix de 365 j (et non 30 j) évite une dérive de 6 j/an sur les dépenses quotidiennes.

### 5.2 Chaîne de calcul mensuelle (`BudgetEngine`)

```
revenus            = Σ équivalents mensuels des sources actives (+ revenus ponctuels du mois)
dépenses fixes     = Σ équivalents mensuels des charges récurrentes
dépenses variables = Σ transactions de dépense non récurrentes du mois
                     (mois en cours : réalisé + projection du reste du mois)
mensualités dettes = Σ mensualités des dettes actives
épargne            = Σ transactions de type .savings

reste disponible   = revenus − fixes − variables − dettes − épargne
```

Indicateurs dérivés :

```
taux d'épargne          = (épargne + reste disponible) / revenus
taux de dépenses fixes  = fixes / revenus                    (alerte si > 50 %)
taux d'endettement (DTI)= mensualités dettes / revenus        (alerte si > 33 %)
dépenses essentielles   = Σ (fixes ∪ variables) marquées essentielles
reste à vivre journalier= reste disponible restant / jours restants du mois
```

*Exemple du §7 :* 4 000 − 2 000 − 700 = **1 300 € disponibles**.

Les mois passés sont figés ; le mois en cours mélange réalisé et projection, et cette
distinction est **affichée** (« 412 € dépensés · ~640 € projetés en fin de mois »), car
présenter une projection comme un fait est la première façon de perdre la confiance.

### 5.3 Projection de trésorerie (`CashFlowEngine`)

Pour chaque jour du mois : solde de départ, + revenus datés, − échéances fixes datées,
− dépense variable quotidienne moyenne (moyenne pondérée des 3 derniers mois, à défaut
l'estimation de l'onboarding).

Sorties : courbe, **solde minimum projeté**, **date de tension** (jour de solde le plus
bas), et le **safe-to-spend** — ce qui reste réellement disponible aujourd'hui une fois
provisionnées les échéances à venir.

### 5.4 Répartition du disponible (`AllocationEngine`)

Cascade personnalisée — pas de règle fixe type 50/30/20 (le §7 l'exclut explicitement) :

| Ordre | Poste | Condition d'activation | Part |
|---|---|---|---|
| 1 | Coussin de sécurité | fonds d'urgence < 1 mois de dépenses essentielles | jusqu'à 60 % du disponible |
| 2 | Dettes à taux élevé | TAEG > 8 % | jusqu'à 50 % du solde restant |
| 3 | Fonds d'urgence | < objectif choisi (3/6/9 mois) | 40 % du solde restant |
| 4 | Objectifs | par priorité × urgence de l'échéance | montant requis, plafonné |
| 5 | Investissement | fonds d'urgence ≥ 3 mois **et** aucune dette > 8 % | selon profil de risque |
| 6 | Argent libre | toujours | plancher 10 % du disponible |

Chaque ligne porte un **motif en clair** (`rationale`), affiché tel quel dans l'app et
réutilisé par l'IA — ce qui garantit la cohérence entre l'écran et le conseiller.

### 5.5 Objectifs (`GoalEngine`)

```
mensuel requis    = (cible − actuel) / mois restants jusqu'à l'échéance
progression       = actuel / cible
date d'atteinte   = aujourd'hui + ⌈(cible − actuel) / contribution mensuelle⌉ mois
faisabilité       = mensuel requis ≤ capacité d'épargne
```

*Exemple du §9 :* 15 000 € / 24 mois = **625 €/mois**. Si la capacité est de 450 €, le
moteur produit trois issues chiffrées : allonger l'échéance (33 mois), réduire la cible
(10 800 €), ou dégager 175 €/mois via le plan d'optimisation.

### 5.6 Fonds d'urgence (`EmergencyFundEngine`)

Base = dépenses essentielles mensuelles (fixes essentielles + variables essentielles).
Paliers 3 / 6 / 9 mois, mois de couverture actuels, mensualité nécessaire pour atteindre
le palier à l'échéance choisie. *Exemple du §10 :* 2 000 € → 6 000 / 12 000 / 18 000 €.

### 5.7 Dettes (`DebtEngine`)

DTI, ordonnancement **avalanche** (taux décroissant, optimal financièrement) et **boule de
neige** (solde croissant, optimal psychologiquement), simulation de remboursement avec
mensualité supplémentaire, coût total des intérêts et gain d'un remboursement anticipé.

### 5.8 Simulation (`SimulationEngine`)

Capitalisation à versements mensuels, intérêts composés mensuellement :

```
FV = P·(1+i)^n + M·[((1+i)^n − 1)/i]        i = taux annuel/12, n = mois
```

Scénarios du §16 : épargner X/mois, réduire les dépenses de Y, atteindre Z €, hausse de
salaire de p %, capacité d'investissement. Chaque résultat renvoie une **série** de points
(pour le graphique) et les **hypothèses utilisées** (taux, inflation, horizon) — jamais un
chiffre nu.

### 5.9 Insights proactifs (`InsightEngine`)

Règles déterministes, seuils explicites, exécution locale (donc disponibles même en mode
« local uniquement ») :

| Règle | Seuil | Exemple (§12) |
|---|---|---|
| Dérive de catégorie | > 20 % vs moyenne 3 mois | « alimentation +24 % » |
| Surplus disponible | disponible > 15 % des revenus | « 340 € supplémentaires » |
| Avance/retard objectif | ±5 % du plan | « en avance de 8 % » |
| Variation du taux d'épargne | ±3 points | « 12 % → 18 % » |
| Poids des abonnements | > 3 % des revenus | « 87 €/mois d'abonnements » |
| Dépenses fixes | > 50 % des revenus | alerte structurelle |
| Risque de découvert | solde projeté < 0 | alerte trésorerie |
| Dépassement d'enveloppe | > 100 % du plafond | alerte budget |

Chaque insight porte une **action concrète** (ouvrir l'écran concerné, ajuster une
enveloppe, lancer l'optimisation) — sans action, ce n'est qu'une notification de plus.

### 5.10 Optimisation (`OptimizationEngine`) — le bouton « ✨ Optimiser mon budget »

Les gisements sont mesurés **contre l'historique de l'utilisateur**, pas contre une moyenne
nationale (qui ne dit rien de son cas) :

1. catégories variables au-dessus de leur médiane 6 mois → écart récupérable ;
2. abonnements : total, doublons, dormants ;
3. part discrétionnaire des revenus au-delà d'un seuil de confort ;
4. dettes coûteuses : intérêts évitables par réaffectation ;
5. dépenses inhabituelles isolées (au-delà de 2 écarts-types).

Sortie : liste d'opportunités chiffrées avec **niveau de confiance** et **effort perçu**,
total mensuel, et nouvelle capacité d'épargne. *Format du §24 :* « J'ai trouvé 285 €
d'optimisation potentielle par mois », détaillé par poste.

---

## 6. Écrans

### 6.1 Navigation — 5 onglets (§2)

```
Accueil · Budget · Transactions · Objectifs · IA
```

### 6.2 Onboarding (§23) — 7 étapes + résultat

Une question par écran, progression visible, tout est modifiable ensuite, chaque étape est
sautable (« je verrai plus tard ») pour éviter l'abandon. À la fin, génération du **plan
financier** avec son raisonnement détaillé.

1. Revenus → 2. Dépenses fixes → 3. Dépenses variables (estimation) → 4. Crédits & dettes
→ 5. Épargne existante → 6. Objectifs → 7. Tolérance au risque → **Votre plan**

### 6.3 Accueil

- **Reste à vivre journalier** (chiffre principal) + reste du mois
- Bouton **✨ Optimiser mon budget** (proéminent, §24)
- Anneau revenus / fixes / variables / épargne / disponible
- Insights IA du jour (2-3 cartes actionnables)
- Progression des objectifs (barres)
- Saisie rapide d'une dépense (bouton flottant, 2 taps)

### 6.4 Budget

- Répartition proposée par l'IA, ligne par ligne, avec le motif de chaque affectation
- Enveloppes par catégorie : plafond, consommé, restant, report
- Revenus (liste éditable) · Dépenses fixes (liste éditable)
- Prévision de trésorerie du mois (courbe + date de tension)
- Comparaison prévu / réalisé

### 6.5 Transactions

- Liste groupée par jour, recherche, filtres (catégorie, compte, période, montant), tags
- Saisie rapide, catégorisation automatique proposée et corrigeable
- Récurrences détectées → proposition de conversion en dépense fixe
- Import CSV/OFX

### 6.6 Objectifs

- Cartes avec anneau de progression : cible, actuel, restant, échéance, mensualité
  recommandée, date d'atteinte estimée
- Fonds d'urgence en objectif épinglé, avec ses paliers 3/6/9 mois
- Création guidée + test de faisabilité immédiat

### 6.7 IA / Conseiller

- Chat en streaming, avec les données réelles du budget
- Suggestions d'entrée (« Mon budget est-il équilibré ? », « Combien puis-je investir ? »)
- Plan financier, rapport mensuel, simulateur, guide d'investissement (éducatif)
- Bandeau permanent du mode de confidentialité actif

### 6.8 Réglages

Sécurité (Face ID / Touch ID / PIN, verrouillage automatique) · Confidentialité (mode IA,
journal des envois) · Devise et langue · Notifications · Abonnement · Données (export CSV /
PDF / JSON, suppression définitive) · Mentions légales

---

## 7. Sécurité et confidentialité (§17)

| Exigence | Mise en œuvre |
|---|---|
| Face ID / Touch ID | `LocalAuthentication`, `.deviceOwnerAuthenticationWithBiometrics` |
| Code PIN | Repli si biométrie indisponible ; PBKDF2 (sel dans le Trousseau), jamais en clair |
| Chiffrement | Protection de fichiers iOS `.completeUnlessOpen` + Trousseau pour les secrets |
| Verrouillage | À l'ouverture et après inactivité (délai réglable) ; masquage dans le sélecteur d'apps |
| Consentement IA | Trois modes explicites, révocables, journalisés (cf. doc 1 §2.10) |
| Export | CSV, PDF, JSON (portabilité — RGPD art. 20) |
| Suppression | Effacement local + CloudKit, double confirmation, irréversible (art. 17) |
| Minimisation | Aucun libellé brut envoyé en mode agrégé ; aucun identifiant dans les analytics |
| Entraînement | Jamais sans opt-in explicite ; désactivé par défaut |

---

## 8. Freemium (§25)

`EntitlementStore` (protocole) + implémentation StoreKit 2. Les fonctionnalités sont
gardées par un `Feature` enum, jamais par un `if isPremium` disséminé.

| Gratuit | Premium |
|---|---|
| Budget, revenus, dépenses, statistiques de base | Conseiller IA & chat |
| 3 objectifs | Objectifs illimités |
| Rapport mensuel simplifié | Optimisation automatique, plans d'épargne, simulations avancées |
| Insights de base (règles locales) | Analyses mensuelles complètes, guide d'investissement, sync bancaire (à venir) |

---

## 9. Extensibilité (§19-20)

| Extension future | Point d'ancrage déjà en place |
|---|---|
| Connexion bancaire | Protocole `BankSyncProvider` + `Categorizer` déjà branché sur les libellés |
| Import CSV | `TransactionImporter` (v1) |
| Widgets / Watch / Wallet | `QuantaraCore` sans dépendance UI, partageable via App Group |
| iPad | `NavigationSplitView` derrière un `AdaptiveNavigation` |
| Web / Android | Cœur métier isolé et spécifié ; règles de calcul documentées ici |
| Multi-appareils | SwiftData + CloudKit, schéma déjà compatible |

---

## 10. Tests

| Niveau | Portée |
|---|---|
| Unitaires (`QuantaraCoreTests`) | Conversions de fréquence, agrégats mensuels, cascade d'allocation, faisabilité des objectifs, fonds d'urgence, DTI, capitalisation, insights, optimisation — y compris les exemples chiffrés du cahier des charges, repris tels quels comme cas de test |
| Contrat IA | Le pack de faits contient tous les champs cités par le prompt ; les outils valident leurs entrées ; refus de tout montant hors pack |
| UI | Parcours d'onboarding, ajout de dépense, création d'objectif |
| Accessibilité | Dynamic Type AX5, VoiceOver sur les graphiques |

La suite : [document 3 — moteur IA](03-moteur-ia.md).
