import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { buildAlerts } from './core/engine/alerts';
import { notify } from './notifications/notifier';
import { addMonths, formatYearMonth } from './core/yearMonth';
import { useStore } from './state/store';
import { HomeScreen } from './ui/HomeScreen';
import { OnboardingScreen } from './ui/OnboardingScreen';
import { LockScreen } from './ui/LockScreen';
import { ShortcutsHelp } from './ui/ShortcutsHelp';
import { useHashRoute } from './ui/routing';

/*
 * Les écrans secondaires sont chargés à la demande.
 *
 * Recharts pèse à lui seul l'essentiel du paquet ; le confiner dans les écrans qui
 * tracent réellement des courbes évite de le charger pour quelqu'un qui ouvre
 * l'application et regarde son solde. Le découpage est fait par écran plutôt que par
 * bibliothèque : c'est la frontière que l'utilisateur franchit, donc celle qui décide de
 * ce dont il a besoin.
 */
const BudgetScreen = lazy(() => import('./ui/BudgetScreen').then((m) => ({ default: m.BudgetScreen })));
const TransactionsScreen = lazy(() =>
  import('./ui/TransactionsScreen').then((m) => ({ default: m.TransactionsScreen })),
);
const GoalsScreen = lazy(() => import('./ui/GoalsScreen').then((m) => ({ default: m.GoalsScreen })));
const PortfolioScreen = lazy(() => import('./ui/PortfolioScreen').then((m) => ({ default: m.PortfolioScreen })));
const HealthScreen = lazy(() => import('./ui/HealthScreen').then((m) => ({ default: m.HealthScreen })));
const CalendarScreen = lazy(() => import('./ui/CalendarScreen').then((m) => ({ default: m.CalendarScreen })));
const SubscriptionsScreen = lazy(() =>
  import('./ui/SubscriptionsScreen').then((m) => ({ default: m.SubscriptionsScreen })),
);
const CategoriesScreen = lazy(() => import('./ui/CategoriesScreen').then((m) => ({ default: m.CategoriesScreen })));
const AdvisorScreen = lazy(() => import('./ui/AdvisorScreen').then((m) => ({ default: m.AdvisorScreen })));
const ProjectionScreen = lazy(() => import('./ui/ProjectionScreen').then((m) => ({ default: m.ProjectionScreen })));
const SettingsScreen = lazy(() => import('./ui/SettingsScreen').then((m) => ({ default: m.SettingsScreen })));

export type Screen =
  | 'home'
  | 'budget'
  | 'transactions'
  | 'goals'
  | 'portfolio'
  | 'health'
  | 'calendar'
  | 'subscriptions'
  | 'categories'
  | 'advisor'
  | 'projections'
  | 'settings';

/**
 * Navigation.
 *
 * Six entrées principales, celles du parcours quotidien — gagner, planifier, dépenser,
 * épargner, investir, comprendre. Les écrans d'appoint vivent dans un second groupe :
 * douze entrées de même rang, c'est une liste qu'on ne lit plus.
 */
const PRIMARY: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: 'Accueil', icon: '◆' },
  { id: 'budget', label: 'Budget', icon: '▤' },
  { id: 'transactions', label: 'Transactions', icon: '⇄' },
  { id: 'goals', label: 'Objectifs', icon: '◎' },
  { id: 'portfolio', label: 'Placements', icon: '△' },
  { id: 'health', label: 'Ma situation', icon: '❤' },
];

const SECONDARY: { id: Screen; label: string; icon: string }[] = [
  { id: 'calendar', label: 'Calendrier', icon: '▦' },
  { id: 'subscriptions', label: 'Abonnements', icon: '🔁' },
  { id: 'categories', label: 'Catégories', icon: '🏷' },
  { id: 'projections', label: 'Projections', icon: '↗' },
  { id: 'advisor', label: 'Assistant', icon: '✦' },
  { id: 'settings', label: 'Réglages', icon: '⚙' },
];

const SCREENS: Screen[] = [...PRIMARY, ...SECONDARY].map((entry) => entry.id);

export function App() {
  const { profile, analysis, ready, error, locked, encrypted, lock, period, setPeriod, undo, canUndo } = useStore();
  const [screen, setScreen] = useHashRoute<Screen>(SCREENS, 'home');
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Échelle du texte : appliquée à la racine, donc à toutes les unités relatives.
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * profile.preferences.textScale}px`;
  }, [profile.preferences.textScale]);

  // Les alertes partent à l'ouverture, une fois le profil déverrouillé et chargé.
  useEffect(() => {
    if (!ready || locked) return;
    void notify(buildAlerts(analysis, profile.preferences.alerts));
  }, [ready, locked, analysis, profile.preferences.alerts]);

  const noteExpense = useCallback(() => {
    setScreen('home');
    // Après le rendu de l'accueil : le champ n'existe pas encore au moment de la touche.
    window.setTimeout(() => document.getElementById('quick-expense-amount')?.focus(), 60);
  }, [setScreen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // Dans un champ, les touches écrivent ce qu'elles disent. Sans cette garde, saisir
      // « 3 » dans un montant changerait d'écran.
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        undo();
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= PRIMARY.length) {
        setScreen(PRIMARY[digit - 1]!.id);
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'n':
          event.preventDefault();
          noteExpense();
          break;
        case 'm':
          setPeriod(addMonths(period, -1));
          break;
        case 'p':
          setPeriod(addMonths(period, 1));
          break;
        case '?':
          setShowShortcuts(true);
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, setScreen, setPeriod, period, noteExpense]);

  if (!ready) {
    return (
      <div className="empty" style={{ paddingTop: '20vh' }}>
        Chargement…
      </div>
    );
  }

  // Le verrouillage passe avant tout : rien n'est chargé en mémoire sans le mot de passe.
  if (locked) return <LockScreen />;

  // Tant que la mise en route n'a pas été parcourue, elle passe avant le reste. Le drapeau
  // fait foi, et non la présence de données : supprimer ses revenus ne doit pas renvoyer
  // quelqu'un à l'écran d'accueil des premiers jours.
  if (!profile.preferences.onboardingCompleted) {
    return <OnboardingScreen />;
  }

  const periodPicker = (
    <div className="inline" style={{ justifyContent: 'space-between', width: '100%' }}>
      <button
        type="button"
        className="button button-ghost button-small"
        aria-label="Mois précédent"
        onClick={() => setPeriod(addMonths(period, -1))}
      >
        ‹
      </button>
      <span className="row-subtitle" style={{ textTransform: 'capitalize' }}>
        {formatYearMonth(period)}
      </span>
      <button
        type="button"
        className="button button-ghost button-small"
        aria-label="Mois suivant"
        onClick={() => setPeriod(addMonths(period, 1))}
      >
        ›
      </button>
    </div>
  );

  function navButton(entry: { id: Screen; label: string; icon: string }) {
    return (
      <button
        key={entry.id}
        type="button"
        className="nav-item"
        aria-current={screen === entry.id ? 'page' : undefined}
        onClick={() => setScreen(entry.id)}
      >
        <span aria-hidden="true" style={{ width: 16, textAlign: 'center' }}>
          {entry.icon}
        </span>
        {entry.label}
      </button>
    );
  }

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Navigation principale">
        <div className="brand">
          <span className="brand-mark" />
          Quantara
        </div>

        {PRIMARY.map(navButton)}

        <div style={{ height: 1, background: 'var(--border)', margin: '10px 12px' }} />

        {SECONDARY.map(navButton)}

        <div className="nav-spacer" />

        <div style={{ padding: '0 4px 8px' }}>{periodPicker}</div>

        {canUndo && (
          <button type="button" className="nav-item" onClick={undo}>
            <span aria-hidden="true" style={{ width: 16, textAlign: 'center' }}>
              ↶
            </span>
            Annuler
          </button>
        )}

        {encrypted && (
          <button type="button" className="nav-item" onClick={lock}>
            <span aria-hidden="true" style={{ width: 16, textAlign: 'center' }}>
              ⌧
            </span>
            Verrouiller
          </button>
        )}

        <button type="button" className="nav-item" onClick={() => setShowShortcuts(true)}>
          <span aria-hidden="true" style={{ width: 16, textAlign: 'center' }}>
            ⌨
          </span>
          Raccourcis
        </button>

        <p className="nav-footnote">
          Données locales, sur cette machine. Les montants affichés proviennent tous d’un calcul explicite.
        </p>
      </nav>

      <main className="main">
        {/* Sur écran étroit, la barre latérale devient une barre d'onglets : le sélecteur
            de mois et l'annulation remontent alors en haut du contenu. */}
        <div className="period-bar">
          {periodPicker}
          {canUndo && (
            <button type="button" className="button button-small" onClick={undo} aria-label="Annuler">
              ↶
            </button>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}

        <Suspense fallback={<div className="empty">Chargement de l’écran…</div>}>
          {screen === 'home' && <HomeScreen onNavigate={setScreen} />}
          {screen === 'budget' && <BudgetScreen />}
          {screen === 'transactions' && <TransactionsScreen />}
          {screen === 'goals' && <GoalsScreen />}
          {screen === 'portfolio' && <PortfolioScreen />}
          {screen === 'health' && <HealthScreen />}
          {screen === 'calendar' && <CalendarScreen />}
          {screen === 'subscriptions' && <SubscriptionsScreen />}
          {screen === 'categories' && <CategoriesScreen />}
          {screen === 'advisor' && <AdvisorScreen />}
          {screen === 'projections' && <ProjectionScreen />}
          {screen === 'settings' && <SettingsScreen />}
        </Suspense>
      </main>

      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
