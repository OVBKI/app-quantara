import { useMemo, useState } from 'react';
import { Money, Percent, type Currency } from '../core/money';
import { totalInvestmentsBalance, type AssetClassId, type Holding } from '../core/model';
import { formatDate } from '../core/yearMonth';
import { ASSET_CLASS_IDS, ASSET_CLASS_LABELS, STALE_AFTER_DAYS, summarizePortfolio } from '../core/engine/portfolio';
import { allocatedTo } from '../core/engine/allocation';
import { investmentGuidance } from '../core/engine/investment';
import { useStore } from '../state/store';
import { Card, EmptyState, Field, Modal, MoneyInput, Tile, parseAmount, useConfirm } from './components';
import { ReadinessSection } from './InvestmentGuidance';
import { BarList, Donut, Legend, type Slice } from './charts';
import { formatFullDay } from './dates';

/** Sept familles, sept jetons de la palette validée, dans l'ordre fixe. */
const ASSET_COLORS: Record<AssetClassId, string> = {
  etf: 'var(--series-1)',
  stocks: 'var(--series-2)',
  bonds: 'var(--series-3)',
  funds: 'var(--series-4)',
  realEstate: 'var(--series-5)',
  cashEquivalent: 'var(--series-6)',
  otherAsset: 'var(--text-tertiary)',
};

/**
 * Portefeuille.
 *
 * L'écran enregistre ce que vous décidez de placer et ce que cela vaut. Il ne recommande
 * aucun produit, ne va chercher aucun cours et ne projette aucun rendement : tout chiffre
 * affiché ici vient de vous. La partie éducative, repliée en bas, rappelle simplement ce
 * qu'il vaut mieux avoir réglé avant de placer.
 */
export function PortfolioScreen() {
  const { profile, analysis, addHolding, updateHolding, removeHolding } = useStore();
  const [form, setForm] = useState<Holding | true | null>(null);
  const [showGuidance, setShowGuidance] = useState(false);
  const [confirmNode, confirm] = useConfirm();

  const portfolio = useMemo(
    () => summarizePortfolio(profile, allocatedTo(analysis.allocation, 'investment')),
    [profile, analysis],
  );

  const guidance = useMemo(
    () =>
      investmentGuidance(
        profile,
        analysis.summary,
        analysis.emergencyFund,
        allocatedTo(analysis.allocation, 'investment'),
      ),
    [profile, analysis],
  );

  const slices: Slice[] = portfolio.byAssetClass.map((slice) => ({
    key: slice.assetClass,
    label: slice.label,
    value: Number(slice.value.units.toFixed(2)),
    color: ASSET_COLORS[slice.assetClass],
    formatted: slice.value.roundedToUnit.format(),
  }));

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Portefeuille</h1>
          <p className="page-subtitle">Ce que vous avez placé, et ce que cela vaut aujourd’hui</p>
        </div>
        <div className="inline">
          <button type="button" className="button button-primary" onClick={() => setForm(true)}>
            + Ajouter une ligne
          </button>
        </div>
      </header>

      <div className="stack">
        <div className="grid grid-4">
          <Tile label="Valeur actuelle" value={portfolio.currentValue.roundedToUnit.format()} />
          <Tile label="Somme versée" value={portfolio.invested.roundedToUnit.format()} />
          <Tile
            label={portfolio.gain.isNegative ? 'Moins-value' : 'Plus-value'}
            value={portfolio.gain.roundedToUnit.format()}
            tone={portfolio.gain.isNegative ? 'critical' : portfolio.gain.isPositive ? 'positive' : undefined}
            note={portfolio.gainRatio !== null ? Percent.format(portfolio.gainRatio, 'fr-FR', 1) : 'Rien de versé'}
          />
          <Tile
            label="Prévu ce mois-ci"
            value={portfolio.investedThisMonth.roundedToUnit.format()}
            note="Selon votre plan de répartition"
          />
        </div>

        {portfolio.staleCount > 0 && (
          <div className="error-banner" style={{ borderColor: 'var(--warning)', color: 'var(--warning)', background: 'rgba(210, 153, 34, 0.12)' }}>
            {portfolio.staleCount} ligne{portfolio.staleCount > 1 ? 's ont' : ' a'} une valeur datant de plus de{' '}
            {STALE_AFTER_DAYS} jours. Le total ci-dessus est donc indicatif tant qu’elle{portfolio.staleCount > 1 ? 's ne sont' : ' n’est'} pas
            mise{portfolio.staleCount > 1 ? 's' : ''} à jour.
          </div>
        )}

        <Card title="Vos lignes">
          {portfolio.lines.length === 0 ? (
            <EmptyState
              title="Aucune ligne enregistrée"
              message="Ajoutez ce que vous avez placé — support par support, ou en une seule ligne globale. La valeur actuelle est celle que vous saisissez : l’application ne consulte aucun cours."
              action={
                <button type="button" className="button button-primary" onClick={() => setForm(true)}>
                  Ajouter une ligne
                </button>
              }
            />
          ) : (
            portfolio.lines.map((line) => (
              <div className="row" key={line.holding.id}>
                <span
                  className="dot"
                  style={{ background: ASSET_COLORS[line.holding.assetClass] }}
                  aria-hidden="true"
                />
                <div className="row-main">
                  <div className="row-title">{line.holding.name}</div>
                  <div className="row-subtitle">
                    {ASSET_CLASS_LABELS[line.holding.assetClass]} · versé{' '}
                    {line.holding.invested.roundedToUnit.format()} · valeur du{' '}
                    {formatFullDay(line.holding.valuedOn)}
                    {line.staleDays > STALE_AFTER_DAYS && <span className="warning"> · à réévaluer</span>}
                  </div>
                </div>
                <div className="row-amount amount">
                  {line.holding.currentValue.roundedToUnit.format()}
                  <div
                    className={`tile-note ${line.gain.isNegative ? 'critical' : line.gain.isPositive ? 'positive' : ''}`}
                    style={{ fontWeight: 400 }}
                  >
                    {line.gain.isPositive ? '+' : ''}
                    {line.gain.roundedToUnit.format()}
                    {line.gainRatio !== null && ` (${Percent.format(line.gainRatio, 'fr-FR', 1)})`}
                  </div>
                </div>
                <button type="button" className="button button-small" onClick={() => setForm(line.holding)}>
                  Modifier
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  aria-label={`Supprimer ${line.holding.name}`}
                  onClick={() =>
                    confirm(`Supprimer la ligne « ${line.holding.name} » ?`, () => removeHolding(line.holding.id))
                  }
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </Card>

        {slices.length > 1 && (
          <Card title="Répartition par famille">
            <div className="donut-layout">
              <Donut
                slices={slices}
                centerValue={portfolio.currentValue.roundedToUnit.formatCompact()}
                centerLabel="au total"
              />
              <div>
                <BarList slices={slices} />
              </div>
            </div>
            <p className="figure-hint">L’application ne recommande aucune répartition.</p>
            <Legend items={slices.map((slice) => ({ label: slice.label, color: slice.color }))} />
          </Card>
        )}

        <Card
          title="Avant de placer"
          action={
            <button type="button" className="button button-small" onClick={() => setShowGuidance((open) => !open)}>
              {showGuidance ? 'Replier' : 'Afficher'}
            </button>
          }
        >
          <p className="section-note" style={{ margin: 0 }}>
            {guidance.state === 'ready'
              ? 'Fonds d’urgence constitué, aucune dette coûteuse, capacité positive : les préalables habituels sont réunis.'
              : guidance.state === 'partial'
                ? 'Les préalables sont presque réunis — un point reste à surveiller.'
                : 'Un préalable n’est pas rempli. Placer avant de l’avoir réglé revient à prendre un risque évitable.'}
          </p>
          {showGuidance && (
            <div style={{ marginTop: 16 }}>
              <ReadinessSection guidance={guidance} />
            </div>
          )}
        </Card>
      </div>

      {form && (
        <HoldingForm
          initial={form === true ? null : form}
          currency={profile.currency}
          onClose={() => setForm(null)}
          onSubmit={(draft) => {
            if (form === true) addHolding(draft);
            else updateHolding({ ...form, ...draft });
          }}
        />
      )}
      {confirmNode}
    </>
  );
}

function HoldingForm({
  initial,
  currency,
  onClose,
  onSubmit,
}: {
  initial: Holding | null;
  currency: Currency;
  onClose: () => void;
  onSubmit: (holding: Omit<Holding, 'id'>) => void;
}) {
  const { profile } = useStore();
  const [name, setName] = useState(initial?.name ?? '');
  const [assetClass, setAssetClass] = useState<AssetClassId>(initial?.assetClass ?? 'etf');
  const [invested, setInvested] = useState(initial ? String(initial.invested.units) : '');
  const [currentValue, setCurrentValue] = useState(initial ? String(initial.currentValue.units) : '');
  const [valuedOn, setValuedOn] = useState(initial?.valuedOn ?? formatDate(new Date()));
  const [accountId, setAccountId] = useState(initial?.accountId ?? '');

  const parsedInvested = parseAmount(invested, currency);
  const parsedValue = parseAmount(currentValue, currency);
  const investmentAccounts = profile.accounts.filter((account) => account.kind === 'investment');

  const error =
    parsedInvested === null && invested.trim() !== ''
      ? 'Le montant versé n’est pas un nombre valide.'
      : parsedValue === null && currentValue.trim() !== ''
        ? 'La valeur actuelle n’est pas un nombre valide.'
        : parsedInvested?.isNegative || parsedValue?.isNegative
          ? 'Un montant ne peut pas être négatif. Une moins-value se traduit par une valeur actuelle plus basse que la somme versée.'
          : null;

  return (
    <Modal title={initial ? `Modifier « ${initial.name} »` : 'Nouvelle ligne'} onClose={onClose}>
      <Field label="Intitulé">
        {(id) => (
          <input
            id={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Assurance-vie, PEA, SCPI…"
            autoFocus
          />
        )}
      </Field>

      <Field label="Famille d’actifs">
        {(id) => (
          <select id={id} value={assetClass} onChange={(event) => setAssetClass(event.target.value as AssetClassId)}>
            {ASSET_CLASS_IDS.map((entry) => (
              <option key={entry} value={entry}>
                {ASSET_CLASS_LABELS[entry]}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="field-row">
        <Field label="Somme versée" hint="Ce que vous avez mis, hors gains.">
          {(id) => <MoneyInput id={id} value={invested} currency={currency} onChange={setInvested} />}
        </Field>
        <Field label="Valeur actuelle">
          {(id) => <MoneyInput id={id} value={currentValue} currency={currency} onChange={setCurrentValue} />}
        </Field>
        <Field label="Valeur au">
          {(id) => (
            <input id={id} type="date" value={valuedOn} onChange={(event) => setValuedOn(event.target.value)} />
          )}
        </Field>
      </div>

      {investmentAccounts.length > 0 && (
        <Field
          label="Compte support"
          hint="Rattachée à un compte, la ligne remplace son solde : rien n’est compté deux fois."
        >
          {(id) => (
            <select id={id} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Aucun</option>
              {investmentAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={error !== null || name.trim() === ''}
          onClick={() => {
            onSubmit({
              name: name.trim(),
              assetClass,
              invested: parsedInvested ?? Money.zero(currency),
              currentValue: parsedValue ?? parsedInvested ?? Money.zero(currency),
              valuedOn,
              ...(accountId ? { accountId } : {}),
            });
            onClose();
          }}
        >
          {initial ? 'Enregistrer' : 'Ajouter'}
        </button>
      </div>
    </Modal>
  );
}

export { totalInvestmentsBalance };
