import { useEffect, useMemo, useRef, useState } from 'react';
import { allCategories, categoryLabel } from '../core/categories';
import { useStore } from '../state/store';

export interface SearchTarget {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly screen: string;
}

/**
 * Barre supérieure : recherche, alertes, période.
 *
 * La recherche est la vraie facilité apportée ici. Avec douze écrans, retrouver « où se
 * règle le plafond des courses » demandait de se souvenir de la structure ; on tape
 * maintenant « courses » et on y va. Elle cherche dans les écrans, les catégories, les
 * revenus, les charges et les objectifs — c'est-à-dire dans ce que l'utilisateur nomme,
 * pas dans ce que l'application appelle ses modules.
 */
export function TopBar({
  screens,
  onNavigate,
  pendingCount,
  onOpenDeclaration,
  right,
}: {
  readonly screens: readonly { id: string; label: string }[];
  readonly onNavigate: (screen: string) => void;
  readonly pendingCount: number;
  readonly onOpenDeclaration: () => void;
  readonly right?: React.ReactNode;
}) {
  const { profile } = useStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Ctrl+K ouvre la recherche depuis n'importe quel écran.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Un clic à l'extérieur referme la liste, sans quoi elle resterait ouverte en travers
  // du contenu.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const targets = useMemo<SearchTarget[]>(() => {
    const entries: SearchTarget[] = screens.map((screen) => ({
      id: `screen.${screen.id}`,
      label: screen.label,
      hint: 'Écran',
      screen: screen.id,
    }));

    for (const category of allCategories()) {
      entries.push({
        id: `cat.${category.id}`,
        label: `${category.icon} ${category.label}`,
        hint: 'Catégorie',
        screen: 'categories',
      });
    }
    for (const income of profile.incomes) {
      entries.push({ id: `inc.${income.id}`, label: income.name, hint: 'Revenu', screen: 'budget' });
    }
    for (const expense of profile.recurringExpenses) {
      entries.push({
        id: `exp.${expense.id}`,
        label: expense.name,
        hint: `Charge · ${categoryLabel(expense.category)}`,
        screen: 'budget',
      });
    }
    for (const goal of profile.goals) {
      entries.push({ id: `goal.${goal.id}`, label: goal.name, hint: 'Objectif', screen: 'goals' });
    }
    return entries;
  }, [screens, profile]);

  const results = useMemo(() => {
    const needle = query
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (needle.length < 2) return [];
    return targets
      .filter((target) =>
        target.label
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .includes(needle),
      )
      .slice(0, 8);
  }, [query, targets]);

  function go(target: SearchTarget) {
    onNavigate(target.screen);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="topbar">
      <div className="search" ref={boxRef}>
        <input
          ref={inputRef}
          value={query}
          placeholder="Rechercher un écran, une catégorie, une charge…   Ctrl+K"
          aria-label="Rechercher"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            }
            if (event.key === 'Enter' && results[0]) go(results[0]);
          }}
        />
        <span className="search-icon" aria-hidden="true">
          ⌕
        </span>

        {open && results.length > 0 && (
          <div className="search-results">
            {results.map((target) => (
              <button key={target.id} type="button" className="search-result" onClick={() => go(target)}>
                <span>{target.label}</span>
                <span className="tertiary">{target.hint}</span>
              </button>
            ))}
          </div>
        )}

        {open && query.trim().length >= 2 && results.length === 0 && (
          <div className="search-results">
            <p className="search-empty">Rien trouvé pour « {query.trim()} ».</p>
          </div>
        )}
      </div>

      <div className="topbar-actions">
        {pendingCount > 0 && (
          <button
            type="button"
            className="icon-button"
            title={`${pendingCount} mois de revenu à déclarer`}
            aria-label={`${pendingCount} mois de revenu à déclarer`}
            onClick={onOpenDeclaration}
          >
            ✎<span className="badge-dot" />
          </button>
        )}
        {right}
      </div>
    </div>
  );
}
