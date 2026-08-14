# Couverture du cahier des charges

Relecture des 26 sections du cahier des charges initial, section par section, avec ce qui
est réellement implémenté et où. La colonne *iOS* renvoie à `Quantara/` + `QuantaraCore/`,
la colonne *Windows* à `desktop/`.

Trois états seulement :

- **Fait** — implémenté et couvert par des tests ou par un écran fonctionnel.
- **Partiel** — implémenté autrement que décrit, avec la raison.
- **Écarté** — délibérément non fait, avec la raison. Jamais « oublié ».

---

## Tableau de couverture

| § | Sujet | iOS | Windows | Où |
|---|---|---|---|---|
| 1 | Assistant financier, pas comptabilité | Fait | Fait | Répartition motivée, constats proactifs, assistant |
| 2 | Navigation 5 onglets | Fait | Partiel | iOS : 5 onglets. Windows : 8 entrées de barre latérale — un écran de bureau n'a pas les contraintes d'un pouce sur un téléphone |
| 3 | Revenus multiples, catégories, équivalent mensuel | Fait | Fait | `model.ts`, `frequency.ts`, écran Budget |
| 4 | Dépenses fixes, périodicités, mensualisation | Fait | Fait | `categories.ts`, `frequency.ts` |
| 5 | Dépenses variables, saisie rapide | Fait | Fait | Catégories variables ; saisie rapide sur l'accueil des deux côtés |
| 6 | Tableau de bord | Fait | Fait | `HomeScreen` : reste à vivre, tuiles, courbe de trésorerie, répartition, constats |
| 7 | Budget mensuel intelligent | Fait | Fait | `budget.ts` + `allocation.ts` — cascade personnalisée, pas de règle 50/30/20 |
| 8 | IA d'analyse | Fait | Partiel | iOS : modèle de langage encadré. Windows : assistant déterministe (voir plus bas) |
| 9 | Plan d'épargne automatique | Fait | Fait | `goals.ts` — faisabilité, alternatives chiffrées quand l'objectif ne tient pas |
| 10 | Fonds d'urgence 3/6/9 mois | Fait | Fait | `emergencyFund.ts` — assis sur les dépenses **essentielles** |
| 11 | Plan d'investissement éducatif | Fait | Fait | `investment.ts` + écran Investissement — préalables bloquants, classes d'actifs génériques |
| 12 | IA proactive | Fait | Fait | `insights.ts` — anomalies détectées par règles, chiffrées |
| 13 | Objectifs financiers | Fait | Fait | `goals.ts`, écran Objectifs |
| 14 | Notifications intelligentes | Fait | Fait | `alerts.ts` + `notifier.ts` — découvert, prélèvements, enveloppe dépassée, paliers, bilan |
| 15 | Analyse mensuelle | Fait | Fait | `monthlyReport.ts` — comparaison, prévu vs réalisé |
| 16 | Simulation financière | Fait | Fait | `simulation.ts`, écran Projections |
| 17 | Sécurité et confidentialité | Fait | Fait | iOS : Face ID / PIN / Trousseau. Windows : chiffrement AES-GCM par mot de passe (`vault.ts`) |
| 18 | Design, mode clair/sombre, accessibilité | Fait | Fait | Thème par variables CSS, échelle de texte réglable |
| 19 | Architecture séparée | Fait | Fait | Cœur métier sans dépendance à l'interface, des deux côtés |
| 20 | Connexion bancaire — évolution future | Partiel | Partiel | Catégorisation automatique et import CSV faits ; l'agrégation DSP2 suppose un serveur agréé |
| 21 | Assistant conversationnel | Fait | Fait | iOS : chat. Windows : questions calculables, « je ne sais pas » au-delà |
| 22 | Règles de l'IA (10 points) | Fait | Fait | `docs/03` ; côté Windows, propriété du code plutôt que consigne |
| 23 | Parcours de première ouverture (7 étapes + plan) | Fait | Fait | `OnboardingView.swift` / `OnboardingScreen.tsx` |
| 24 | « ✨ Optimiser mon budget » | Fait | Fait | `optimization.ts`, bouton en évidence sur l'accueil |
| 25 | Modèle freemium | Fait | **Écarté** | Voir plus bas |
| 26 | Résultat attendu | Fait | Fait | Chaque montant porte son motif ; l'assistant répond aux six questions de la section |

---

## Les points qui méritent une explication

### §2 — Cinq onglets sur iOS, huit entrées sur Windows

La contrainte des cinq onglets vient d'iOS : au-delà, la barre se replie en « Plus » et
les écrans deviennent introuvables. Une barre latérale de bureau n'a pas ce plafond, et
regrouper Investissement, Projections et Réglages derrière un même onglet pour respecter
un chiffre écrit pour un téléphone aurait dégradé l'usage sans rien apporter.

### §8 et §21 — Deux assistants différents

Sur iOS, l'assistant est un modèle de langage encadré : il reçoit un pack de faits calculé
localement, l'interdiction d'énoncer un montant qui n'en provient pas, et des outils
exécutés par le moteur (`docs/03`).

Sur Windows, il n'y a **aucun modèle de langage**. Les réponses sont assemblées à partir
des moteurs. C'est un choix, pas une facilité : une application de bureau sans compte ni
serveur ne peut pas détenir de clé d'API — une clé embarquée dans un binaire s'extrait en
quelques minutes. La contrepartie est assumée et testée : l'assistant répond « je ne sais
pas » hors de son périmètre plutôt que de produire une réponse plausible.

### §11 — Ce que l'investissement ne fait pas

Le cahier des charges nomme des produits (« ETF »). L'application n'en nomme aucun, et un
test vérifie qu'aucun nom d'émetteur, d'indice ou d'instrument n'apparaît. Recommander un
instrument financier à une personne donnée est du **conseil en investissement**, activité
réglementée en Europe (MiFID II) qui suppose un agrément. Ce qui est fait : les préalables
(fonds d'urgence, absence de dette coûteuse, capacité positive), les grandes familles
d'actifs avec leur revers, l'horizon, et un avertissement de risque non masquable.

### §17 — Sécurité, et ce qui reste hors de portée

Fait : chiffrement du fichier à la demande (PBKDF2-SHA256, 600 000 itérations, AES-GCM
256), verrouillage, export, suppression définitive, aucune donnée transmise.

Non fait, et impossible à faire honnêtement : présenter le chiffrement comme une
protection contre un attaquant ayant déjà accès à la machine déverrouillée. Il protège un
fichier volé ou une sauvegarde, pas une session ouverte. C'est écrit tel quel dans les
réglages.

### §20 — Connexion bancaire

La partie qui dépend de l'application est faite : la catégorisation automatique des
libellés (`CARREFOUR 85,32 €` → Courses) fonctionne, en local, et apprend des corrections.
L'agrégation elle-même suppose un prestataire agréé DSP2 et un serveur : c'est un autre
produit, pas une fonctionnalité à ajouter. L'import CSV couvre le même besoin sans
intermédiaire ni partage d'identifiants bancaires.

### §25 — Freemium : écarté sur Windows

Sur iOS, le freemium est implémenté (StoreKit 2, `Entitlements/`).

Sur Windows, il ne l'est pas et ne le sera pas : cette version a été construite comme un
outil personnel, à la demande. Un mur de paiement dans une application qu'on utilise pour
soi n'a aucun destinataire ; il ajouterait un service de facturation, une validation de
reçus et une gestion d'abonnement pour brider des fonctionnalités déjà écrites. L'ossature
resterait ajoutable — le cœur métier ne connaît pas la notion de droit d'accès, et un
niveau d'entitlement se brancherait dans l'interface — mais rien n'est préparé en ce sens,
et le prétendre serait inexact.

---

## Ce qui a été ajouté au-delà du cahier des charges

Ces points ne figuraient pas dans la demande initiale ; ils viennent de l'analyse
(`docs/01`) ou d'un manque constaté à l'usage.

| Ajout | Pourquoi |
|---|---|
| Dettes et crédits modélisés (taux, avalanche) | Le cahier des charges demande d'en « tenir compte » sans jamais les modéliser |
| Trésorerie jour par jour, date de tension | Le solde de fin de mois peut être positif alors que le compte passe en négatif le 14 |
| Date de réception du revenu | Payé le 2 ou le 28, le point bas du mois n'est pas le même — et le découvert non plus |
| Revenus irréguliers (fourchette, percentiles, coussin) | Le cahier des charges suppose un salaire fixe |
| Enveloppes par catégorie, comparées au calendrier | Le budget descendant seul ne dit pas si l'on tient le rythme |
| Prévu vs réalisé, erreur de prévision | Sans cette boucle, l'estimation initiale n'est jamais corrigée |
| Catégorisation locale apprenante | Corriger deux fois le même marchand est une raison d'abandon |
| Import CSV avec détection de récurrences | Seule voie honnête vers les transactions réelles sans agrégateur |
| Échelle de texte réglable | Équivalent de bureau du Dynamic Type |
