import { useState } from 'react';
import { addMonths, formatYearMonth } from './core/yearMonth';
import { useStore } from './state/store';
import { HomeScreen } from './ui/HomeScreen';
import { BudgetScreen } from './ui/BudgetScreen';
import { TransactionsScreen } from './ui/TransactionsScreen';
import { GoalsScreen } from './ui/GoalsScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { OnboardingScreen } from './ui/OnboardingScreen';

type Screen = 'home' | 'budget' | 'transactions' | 'goals' | 'settings';

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: 'Accueil', icon: '◆' },
  { id: 'budget', label: 'Budget', icon: '▤' },
  { id: 'transactions', label: 'Transactions', icon: '⇄' },
  { id: 'goals', label: 'Objectifs', icon: '◎' },
  { id: 'settings', label: 'Réglages', icon: '⚙' },
];

export function App() {
  const { profile, ready, error, period, setPeriod } = useStore();
  const [screen, setScreen] = useState<Screen>('home');

  if (!ready) {
    return (
      <div className="empty" style={{ paddingTop: '20vh' }}>
        Chargement…
      </div>
    );
  }

  // Sans revenu déclaré, aucun calcul n'a de sens : on installe d'abord le nécessaire.
  if (profile.incomes.length === 0 && profile.recurringExpenses.length === 0) {
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

        <p className="nav-footnote">
          Données locales, sur cette machine. Les montants affichés proviennent tous d’un calcul explicite.
        </p>
      </nav>

      <main className="main">
        {error && <div className="error-banner">{error}</div>}
        {screen === 'home' && <HomeScreen />}
        {screen === 'budget' && <BudgetScreen />}
        {screen === 'transactions' && <TransactionsScreen />}
        {screen === 'goals' && <GoalsScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}
