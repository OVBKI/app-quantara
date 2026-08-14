import { useEffect, useState } from 'react';
import { buildAlerts } from './core/engine/alerts';
import { notify } from './notifications/notifier';
import { addMonths, formatYearMonth } from './core/yearMonth';
import { useStore } from './state/store';
import { HomeScreen } from './ui/HomeScreen';
import { BudgetScreen } from './ui/BudgetScreen';
import { TransactionsScreen } from './ui/TransactionsScreen';
import { GoalsScreen } from './ui/GoalsScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { AdvisorScreen } from './ui/AdvisorScreen';
import { ProjectionScreen } from './ui/ProjectionScreen';
import { OnboardingScreen } from './ui/OnboardingScreen';
import { InvestmentScreen } from './ui/InvestmentScreen';
import { LockScreen } from './ui/LockScreen';

type Screen =
  | 'home'
  | 'budget'
  | 'transactions'
  | 'goals'
  | 'investment'
  | 'advisor'
  | 'projections'
  | 'settings';

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: 'Accueil', icon: '◆' },
  { id: 'budget', label: 'Budget', icon: '▤' },
  { id: 'transactions', label: 'Transactions', icon: '⇄' },
  { id: 'goals', label: 'Objectifs', icon: '◎' },
  { id: 'investment', label: 'Investissement', icon: '△' },
  { id: 'advisor', label: 'Assistant', icon: '✦' },
  { id: 'projections', label: 'Projections', icon: '↗' },
  { id: 'settings', label: 'Réglages', icon: '⚙' },
];

export function App() {
  const { profile, analysis, ready, error, locked, encrypted, lock, period, setPeriod } = useStore();
  const [screen, setScreen] = useState<Screen>('home');

  // Échelle du texte : appliquée à la racine, donc à toutes les unités relatives.
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * profile.preferences.textScale}px`;
  }, [profile.preferences.textScale]);

  // Les alertes partent à l'ouverture, une fois le profil déverrouillé et chargé.
  useEffect(() => {
    if (!ready || locked) return;
    void notify(buildAlerts(analysis, profile.preferences.alerts));
  }, [ready, locked, analysis, profile.preferences.alerts]);

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

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Navigation principale">
        <div className="brand">
          <span className="brand-mark" />
          Quantara
        </div>

        {NAV.map((entry) => (
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
        ))}

        <div className="nav-spacer" />

        <div style={{ padding: '0 4px 8px' }}>
          <div className="inline" style={{ justifyContent: 'space-between' }}>
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
        </div>

        {encrypted && (
          <button type="button" className="nav-item" onClick={lock} style={{ marginBottom: 4 }}>
            <span aria-hidden="true" style={{ width: 16, textAlign: 'center' }}>
              ⌧
            </span>
            Verrouiller
          </button>
        )}

        <p className="nav-footnote">
          Données locales, sur cette machine. Les montants affichés proviennent tous d’un calcul explicite.
        </p>
      </nav>

      <main className="main">
        {error && <div className="error-banner">{error}</div>}
        {screen === 'home' && <HomeScreen onNavigate={setScreen} />}
        {screen === 'budget' && <BudgetScreen />}
        {screen === 'transactions' && <TransactionsScreen />}
        {screen === 'goals' && <GoalsScreen />}
        {screen === 'investment' && <InvestmentScreen />}
        {screen === 'advisor' && <AdvisorScreen />}
        {screen === 'projections' && <ProjectionScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}
