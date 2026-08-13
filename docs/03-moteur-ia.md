# Quantara — Moteur IA

> Document 3/3. Comment l'application transforme des données financières en conseil
> personnalisé sans jamais inventer un chiffre.

---

## 1. Le problème à résoudre

Le §22 du cahier des charges impose dix règles à l'IA : utiliser les données réelles,
expliquer ses calculs, signaler les informations manquantes, **ne jamais inventer de
données financières**, ne jamais garantir un rendement.

Écrire ces règles dans un prompt système ne suffit pas. Un modèle de langage à qui l'on
demande « quel est mon taux d'épargne ? » avec une liste de transactions produira un
nombre plausible — parfois faux. Sur une application financière, un taux d'épargne faux
n'est pas un défaut cosmétique : c'est une décision d'épargne erronée.

## 2. La solution : séparation calcul / explication

```
                          ┌──────────────────────────┐
    Données locales  ───▶ │  QuantaraCore (Swift)    │  Tous les nombres naissent ici.
                          │  déterministe, testé     │  Zéro appel réseau.
                          └────────────┬─────────────┘
                                       │ FinancialFacts (JSON)
                                       ▼
                          ┌──────────────────────────┐
                          │  Claude (claude-opus-5)  │  Explique, priorise, dialogue.
                          │  interdiction absolue    │  Ne calcule jamais.
                          │  d'inventer un montant   │
                          └────────────┬─────────────┘
                                       │ appels d'outils
                                       ▼
                          ┌──────────────────────────┐
                          │  Outils → QuantaraCore   │  Simulation, objectif, dette…
                          └──────────────────────────┘
```

Trois conséquences directes :

1. **Aucune hallucination numérique possible** — un montant affiché provient d'une
   fonction Swift couverte par un test unitaire.
2. **Explicabilité** — chaque conseil est rattachable à un calcul nommé.
3. **Dégradation gracieuse** — sans réseau ou en mode « local uniquement », le moteur
   déterministe continue de produire les indicateurs, les insights, la répartition et
   l'optimisation. Seule la formulation conversationnelle disparaît.

---

## 3. Le pack de faits (`FinancialFacts`)

Structure `Codable` produite par `FinancialFactsBuilder`, sérialisée en JSON et injectée
dans le contexte du modèle. Elle contient :

| Bloc | Contenu |
|---|---|
| `period` | Mois de référence, devise, date du jour |
| `summary` | Revenus, fixes, variables, dettes, épargne, disponible, taux d'épargne, taux de fixes, DTI, dépenses essentielles, safe-to-spend |
| `comparison` | Écarts vs mois précédent (revenus, dépenses, épargne, taux) |
| `topCategories` | Les 8 postes les plus lourds, avec la variation vs moyenne 3 mois |
| `allocation` | La cascade proposée, ligne par ligne, avec les motifs |
| `emergencyFund` | Base mensuelle essentielle, paliers 3/6/9, couverture actuelle, mensualité requise |
| `goals` | Cible, actuel, restant, échéance, mensualité requise, progression, faisabilité |
| `debts` | Capital restant, taux, mensualité, ordre avalanche, DTI |
| `insights` | Anomalies détectées avec leur magnitude |
| `optimization` | Gisements d'économies chiffrés (si l'utilisateur l'a lancé) |
| `assumptions` | Hypothèses appliquées (rendement, inflation, mode de projection) |
| `missingData` | Ce que l'utilisateur n'a pas renseigné (règle §22.4) |
| `investmentReadiness` | Prérequis remplis ou non avant tout contenu investissement |

`missingData` est le champ le plus important pour la qualité du conseil : il permet au
modèle de dire « je ne connais pas votre épargne actuelle, la réponse suppose 0 € »
plutôt que de supposer silencieusement.

**Mode agrégé (défaut) :** aucun libellé de transaction, aucun marchand, aucune date
précise — uniquement des totaux par catégorie et des ratios. Le pack seul ne permet pas de
réidentifier des achats.

---

## 4. Prompt système

Construit par `AdvisorPrompt.system(locale:facts:consent:)`. Il énonce :

- le rôle (conseiller budgétaire personnel, pas comptable) ;
- **la règle du pack** : tout montant énoncé doit provenir du pack ou d'un résultat
  d'outil, jamais d'une estimation ;
- l'obligation d'expliquer les calculs et de nommer les hypothèses ;
- l'obligation de signaler les données manquantes ;
- l'interdiction de garantir un rendement, et l'encadrement éducatif de l'investissement ;
- la priorité épargne de sécurité → dettes coûteuses → investissement ;
- la prise en compte des dettes avant toute stratégie ;
- le ton : direct, chiffré, actionnable ; pas de généralités ;
- la langue de réponse (celle de l'utilisateur) et le format monétaire.

Le prompt est **stable** (aucune date, aucun identifiant interpolé) et placé avant le pack
de faits, afin que le cache de prompt puisse fonctionner : le préfixe stable est mis en
cache, seule la partie variable est refacturée.

---

## 5. Outils exposés au modèle

Le modèle ne fait aucun calcul : quand une question dépasse le pack, il appelle un outil,
exécuté localement par `QuantaraCore`.

| Outil | Entrées | Retour |
|---|---|---|
| `simulate_savings` | mensualité, années, rendement annuel | série annuelle, valeur finale, total versé, intérêts |
| `time_to_reach_amount` | cible, mensualité, capital initial, rendement | nombre de mois, date estimée |
| `plan_goal` | cible, échéance, capital actuel | mensualité requise, faisabilité, 3 alternatives chiffrées |
| `simulate_income_change` | variation en % | nouveau disponible, nouvelle capacité d'épargne |
| `simulate_expense_reduction` | montant mensuel | impact sur le disponible, sur les objectifs |
| `debt_payoff_plan` | mensualité supplémentaire, stratégie | ordre, date de sortie, intérêts économisés |
| `emergency_fund_plan` | mois de couverture visés, échéance | cible, mensualité requise |
| `category_breakdown` | catégorie, nombre de mois | historique mensuel, moyenne, tendance |
| `affordability_check` | montant, échéance | verdict, impact trésorerie / objectifs / fonds d'urgence |

Chaque outil valide ses entrées et renvoie une erreur explicite en cas de valeur aberrante
(montant négatif, horizon nul…), plutôt que de produire un résultat trompeur.

---

## 6. Appel du modèle

- **Modèle :** `claude-opus-5`.
- **Réflexion :** adaptative (défaut du modèle), effort `medium` pour le chat,
  `high` pour la génération du plan financier et du rapport mensuel.
- **Streaming :** activé pour le chat (réponse progressive, pas de dépassement de délai).
- **`max_tokens` :** 8 000 en chat (streaming), 16 000 pour les rapports.
- **Boucle d'outils :** tant que `stop_reason == "tool_use"`, exécuter les outils demandés,
  renvoyer tous les `tool_result` dans un **unique** message utilisateur, poursuivre.
  Plafond de 6 itérations, puis réponse dégradée.
- **Refus :** `stop_reason == "refusal"` est traité avant toute lecture du contenu.
- **Cache de prompt :** point de césure sur le bloc système, préfixe stable ; le pack de
  faits, variable, est placé après.

Transport : `ProxyTransport` par défaut (relais Quantara, la clé d'API n'est jamais dans
l'app), `DirectAnthropicTransport` en développement uniquement, sous `#if DEBUG`, avec la
clé lue dans le Trousseau.

---

## 7. Catégorisation automatique (§20)

Deux étages :

1. **Règles locales** (`Categorizer`) — normalisation du libellé, dictionnaire de
   marchands connus, motifs (`CARREFOUR` → courses, `TOTAL`/`SHELL` → carburant,
   `NETFLIX`/`SPOTIFY` → abonnement). Instantané, hors ligne, gratuit, sans envoi de
   données. Couvre l'essentiel des libellés fréquents.
2. **Repli IA** — uniquement pour les libellés non reconnus, uniquement si l'utilisateur a
   choisi le mode « IA avancée — détaillé », par lots, et le résultat enrichit le
   dictionnaire local pour ne plus jamais avoir à ressortir.

Toute catégorisation est corrigeable ; une correction crée une règle locale permanente.

---

## 8. Ce que l'IA ne fera pas

| Interdit | Raison |
|---|---|
| Énoncer un montant absent du pack ou d'un résultat d'outil | Règle §22.5 — appliquée par construction |
| Garantir ou promettre un rendement | Règle §22.6 |
| Nommer un produit, un ISIN, un émetteur, un courtier | Éviter le conseil en investissement réglementé (MiFID II) |
| Proposer un investissement risqué avant le fonds d'urgence | Règle §22.8 |
| Ignorer une dette à taux élevé | Règle §22.9 |
| Envoyer des données sans consentement du mode correspondant | RGPD |
| Traiter des données de santé déductibles de libellés | RGPD art. 9 — mode agrégé par défaut |

---

## 9. Dégradation sans réseau ni consentement

En mode « local uniquement » (le défaut), `LocalAdvisor` produit sans aucun appel réseau :

- le plan financier (cascade d'allocation + motifs) ;
- les insights proactifs ;
- le plan d'optimisation ;
- les plans d'objectifs et de fonds d'urgence ;
- le rapport mensuel factuel ;
- des réponses gabarits aux questions fréquentes du chat.

L'utilisateur voit clairement quel mode est actif, et ce que le mode avancé apporterait.
Le produit reste utile sans jamais transmettre la moindre donnée.
