import { useMemo, useState } from 'react';
import { Money } from '../core/money';
import { SUGGESTED_QUESTIONS, ask, missingData, type AdvisorAnswer } from '../core/advisor/advisor';
import { optimize, EFFORT_LABELS } from '../core/engine/optimization';
import { canIAfford, VERDICT_TONE } from '../core/engine/affordability';
import { useStore } from '../state/store';
import { Card, Field, MoneyInput, parseAmount } from './components';

export function AdvisorScreen() {
  const { profile, analysis } = useStore();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AdvisorAnswer | null>(null);

  const gaps = useMemo(() => missingData(profile, analysis), [profile, analysis]);

  function submit(text: string) {
    if (text.trim() === '') return;
    setQuestion(text);
    setAnswer(ask(text, analysis));
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Assistant</h1>
          <p className="page-subtitle">Des réponses construites sur vos chiffres, jamais inventées</p>
        </div>
      </header>

      <div className="stack">
        <Card>
          <form
            className="inline"
            style={{ gap: 8, flexWrap: 'nowrap' }}
            onSubmit={(event) => {
              event.preventDefault();
              submit(question);
            }}
          >
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Posez votre question…"
              aria-label="Votre question"
            />
            <button type="submit" className="button button-primary" style={{ whiteSpace: 'nowrap' }}>
              Demander
            </button>
          </form>

          <div className="inline" style={{ marginTop: 14 }}>
            {SUGGESTED_QUESTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="button button-small"
                onClick={() => submit(entry.label)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </Card>

        {answer && <AnswerCard answer={answer} />}

        {!answer && (
          <Card title="Comment cet assistant fonctionne">
            <p className="muted" style={{ marginTop: 0 }}>
              Chaque phrase produite ici est assemblée à partir d’un montant calculé par les moteurs de
              l’application, jamais rédigée librement. Aucun modèle de langage n’intervient, rien ne quitte votre
              machine — et par construction, aucun chiffre ne peut être inventé.
            </p>
            <p className="muted">
              La contrepartie est assumée : l’assistant ne traite que les questions qu’il sait calculer, et le dit
              franchement sinon. Sur de l’argent, un « je ne sais pas » vaut mieux qu’une réponse plausible et fausse.
            </p>
            {gaps.length > 0 && (
              <>
                <div className="card-title" style={{ marginTop: 18 }}>
                  Ce qui manque pour des réponses plus fiables
                </div>
                {gaps.map((gap) => (
                  <p className="rationale" key={gap}>
                    · {gap}
                  </p>
                ))}
              </>
            )}
          </Card>
        )}

        <OptimizationCard />
        <AffordabilityCard />
      </div>
    </>
  );
}

function AnswerCard({ answer }: { answer: AdvisorAnswer }) {
  return (
    <Card>
      <h2 style={{ margin: '0 0 12px', fontSize: 19, letterSpacing: '-0.01em' }}>{answer.title}</h2>
      {answer.paragraphs.map((paragraph, index) => (
        <p key={index} style={{ color: 'var(--text-secondary)', marginTop: index === 0 ? 0 : 10 }}>
          {paragraph}
        </p>
      ))}

      {answer.figures.length > 0 && (
        <div className="grid grid-4" style={{ marginTop: 16 }}>
          {answer.figures.map((figure) => (
            <div key={figure.label}>
              <div className="tile-label">{figure.label}</div>
              <div className="amount" style={{ fontWeight: 600 }}>
                {figure.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {answer.caveats.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          {answer.caveats.map((caveat) => (
            <p className="rationale" key={caveat}>
              ⚠ {caveat}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function OptimizationCard() {
  const { profile, analysis } = useStore();
  const [result, setResult] = useState<ReturnType<typeof optimize> | null>(null);

  return (
    <Card
      title="Optimiser mon budget"
      action={
        <button
          type="button"
          className="button button-primary button-small"
          onClick={() => setResult(optimize(profile, analysis.summary, analysis.period, analysis.reference))}
        >
          ✨ Analyser
        </button>
      }
    >
      {!result ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Je compare votre mois à vos propres habitudes des six derniers mois, et non à une moyenne nationale :
          savoir qu’on dépense plus que « la moyenne des Français » n’apprend rien à quelqu’un qui a quatre enfants.
        </p>
      ) : result.suggestions.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Aucune piste chiffrable ce mois-ci
          {result.historyMonths < 3 ? ' — et il me manque de l’historique pour comparer sérieusement.' : '.'}
        </p>
      ) : (
        <>
          <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="amount" style={{ fontSize: 22, fontWeight: 640 }}>
              {result.totalMonthly.roundedToUnit.format()}
              <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> par mois</span>
            </span>
            <span className="badge">{result.totalAnnual.roundedToUnit.format()} sur un an</span>
          </div>

          {result.suggestions.map((suggestion) => (
            <div className="row" key={suggestion.id} style={{ alignItems: 'flex-start' }}>
              <div className="row-main">
                <div className="row-title">{suggestion.title}</div>
                <div className="rationale">{suggestion.detail}</div>
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {suggestion.monthlySaving.isPositive && (
                  <div className="row-amount amount positive">
                    {suggestion.monthlySaving.roundedToUnit.format()}
                  </div>
                )}
                <div className="tile-note">{EFFORT_LABELS[suggestion.effort]}</div>
              </div>
            </div>
          ))}

          <p className="rationale" style={{ marginTop: 14 }}>
            Ces montants supposent que chaque piste soit suivie jusqu’au bout. Ce sont des ordres de grandeur,
            pas des économies acquises — et c’est vous qui jugez ce qui vaut l’effort.
          </p>
        </>
      )}
    </Card>
  );
}

function AffordabilityCard() {
  const { profile, analysis } = useStore();
  const [amount, setAmount] = useState('');
  const [answer, setAnswer] = useState<ReturnType<typeof canIAfford> | null>(null);

  const parsed = parseAmount(amount, profile.currency);

  return (
    <Card title="Puis-je me le permettre ?">
      <div className="inline" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Field label="Montant envisagé">
            {(id) => <MoneyInput id={id} value={amount} currency={profile.currency} onChange={setAmount} />}
          </Field>
        </div>
        <button
          type="button"
          className="button"
          disabled={!parsed || !parsed.isPositive}
          style={{ marginBottom: 14 }}
          onClick={() => {
            if (!parsed) return;
            setAnswer(canIAfford(parsed, analysis.summary, analysis.emergencyFund, analysis.cashFlow, analysis.capacity));
          }}
        >
          Vérifier
        </button>
      </div>

      {answer ? (
        <>
          <div className={VERDICT_TONE[answer.verdict]} style={{ fontWeight: 620, fontSize: 17, marginBottom: 8 }}>
            {answer.headline}
          </div>
          {answer.reasons.map((reason) => (
            <p className="rationale" key={reason}>
              {reason}
            </p>
          ))}
        </>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          Un solde positif ne suffit pas à répondre. Je regarde ce qui est déjà engagé d’ici la fin du mois, le
          point bas de votre trésorerie, et l’effet sur votre fonds d’urgence.
        </p>
      )}
    </Card>
  );
}

export { Money };
