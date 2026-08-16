import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Graphiques.
 *
 * Écrits en SVG, sans bibliothèque : ce sont des formes simples, et une dépendance de
 * 300 ko pour tracer un anneau et des barres serait payée à chaque ouverture.
 *
 * Les règles suivies partout, et les raisons :
 *
 * - **La couleur suit l'entité, jamais son rang.** « Courses » garde sa teinte qu'elle
 *   soit première ou quatrième du mois. Recolorer au filtrage trompe quelqu'un qui a
 *   appris que Courses était bleu.
 * - **Huit teintes, pas neuf.** Au-delà, deux séries deviennent indiscernables sous
 *   déficience de la vision des couleurs. Le surplus se replie sur « Autre ».
 * - **La couleur ne porte jamais seule le sens.** Chaque part est aussi nommée, en
 *   toutes lettres, à côté de sa pastille.
 * - **Marques fines, grille en cheveu.** Les données sont la seule chose qui a le droit
 *   d'être franche ; la grille est là pour être lue, pas vue.
 * - **Un écart de 2 px en couleur de fond sépare deux marques voisines.** C'est le vide
 *   qui sépare, pas un contour — un contour ajouterait de l'encre qui n'est pas de la
 *   donnée.
 */

const SURFACE = 'var(--surface)';

/**
 * Largeur réelle du conteneur.
 *
 * Un SVG à `viewBox` fixe étiré en CSS déforme ses traits ou se retrouve centré au
 * milieu d'une bande vide. Mesurer la largeur et dessiner à cette taille donne une
 * géométrie juste : traits de 2 px partout, points ronds, et un graphique qui occupe
 * la place qu'on lui donne.
 */
function useMeasuredWidth(fallback = 640): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export interface Slice {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
  /** Montant formaté, affiché tel quel — jamais recalculé ici. */
  readonly formatted: string;
}

/** Au-delà, les parts deviennent trop fines pour être lues, et le repli sur « Autre »
 *  dit plus que sept tranches illisibles. */
const MAX_SLICES = 6;

const SLOTS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];

/**
 * Deux parts d'un même graphique ne portent jamais la même couleur.
 *
 * Le catalogue compte une trentaine de catégories pour huit teintes : deux d'entre elles
 * finissent forcément par partager une couleur, et il arrive qu'elles se retrouvent dans
 * le même graphique — « Loyer » et « Carburant », par exemple. Deux parts identiques y
 * seraient illisibles.
 *
 * La première occurrence garde donc sa couleur — c'est elle que l'œil a apprise — et la
 * suivante prend le premier emplacement encore libre. Le compromis est assumé : la
 * couleur d'une catégorie reste stable tant qu'elle n'entre pas en collision, et la
 * lisibilité l'emporte quand elle le fait. Dans tous les cas, chaque part porte son
 * libellé écrit : la couleur ne distingue jamais seule.
 */
function withDistinctColors(slices: readonly Slice[]): Slice[] {
  const used = new Set<string>();
  return slices.map((slice) => {
    if (!used.has(slice.color)) {
      used.add(slice.color);
      return slice;
    }
    const free = SLOTS.find((slot) => !used.has(slot)) ?? 'var(--text-tertiary)';
    used.add(free);
    return { ...slice, color: free };
  });
}

export function foldSlices(slices: readonly Slice[], max = MAX_SLICES, otherLabel = 'Autre'): Slice[] {
  if (slices.length <= max) return withDistinctColors(slices);
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, max - 1);
  const tail = sorted.slice(max - 1);
  return [
    ...withDistinctColors(head),
    {
      key: '__other',
      label: otherLabel,
      value: tail.reduce((sum, slice) => sum + slice.value, 0),
      // Gris neutre : « Autre » n'est pas une catégorie, c'est l'absence de détail.
      color: 'var(--text-tertiary)',
      formatted: `${tail.length} postes`,
    },
  ];
}

function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

/**
 * Anneau de composition.
 *
 * Un anneau ne sert qu'à une chose : montrer d'un coup d'œil qu'une partie pèse dans un
 * tout. Il ne sert pas à comparer deux parts proches — l'œil ne compare pas des angles.
 * Pour cela, `BarList` plus bas donne la réponse en une lecture.
 */
export function Donut({
  slices,
  centerLabel,
  centerValue,
  size = 176,
  thickness = 26,
}: {
  slices: readonly Slice[];
  centerLabel?: string;
  centerValue?: string;
  size?: number;
  thickness?: number;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const outer = size / 2 - 2;
  const inner = outer - thickness;

  // L'écart entre deux parts est exprimé en angle pour valoir 2 px sur le rayon moyen :
  // sans cette conversion, l'écart paraîtrait énorme sur un petit anneau.
  const gap = slices.length > 1 ? 2 / ((outer + inner) / 2) : 0;

  let angle = -Math.PI / 2;
  const arcs = slices.map((slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const start = angle + gap / 2;
    const end = angle + sweep - gap / 2;
    angle += sweep;
    if (end <= start) return { slice, path: '' };

    const [x1, y1] = polar(cx, cy, outer, start);
    const [x2, y2] = polar(cx, cy, outer, end);
    const [x3, y3] = polar(cx, cy, inner, end);
    const [x4, y4] = polar(cx, cy, inner, start);
    const large = end - start > Math.PI ? 1 : 0;

    return {
      slice,
      path: `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`,
    };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Répartition">
      {arcs.map(({ slice, path }) =>
        path ? (
          <path key={slice.key} d={path} fill={slice.color}>
            <title>{`${slice.label} — ${slice.formatted}`}</title>
          </path>
        ) : null,
      )}
      {centerValue && (
        <>
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            className="amount"
            style={{ fill: 'var(--text)', fontSize: 19, fontWeight: 640 }}
          >
            {centerValue}
          </text>
          {centerLabel && (
            <text x={cx} y={cy + 15} textAnchor="middle" style={{ fill: 'var(--text-tertiary)', fontSize: 11 }}>
              {centerLabel}
            </text>
          )}
        </>
      )}
    </svg>
  );
}

/**
 * Liste de barres horizontales.
 *
 * La forme à préférer dès qu'il s'agit de **comparer** : les longueurs se comparent
 * d'un coup d'œil, les angles non. Chaque barre porte son libellé et sa valeur, donc la
 * couleur ne fait qu'accompagner.
 */
export function BarList({
  slices,
  max,
  showShare = true,
}: {
  slices: readonly Slice[];
  max?: number;
  showShare?: boolean;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const ceiling = max ?? Math.max(...slices.map((slice) => slice.value), 1);

  return (
    <div className="bar-list">
      {slices.map((slice) => {
        const width = Math.max((slice.value / ceiling) * 100, slice.value > 0 ? 1.5 : 0);
        const share = total > 0 ? slice.value / total : 0;
        return (
          <div className="bar-row" key={slice.key}>
            <div className="bar-head">
              <span className="dot" style={{ background: slice.color }} aria-hidden="true" />
              <span className="bar-label">{slice.label}</span>
              <span className="bar-value amount">{slice.formatted}</span>
              {showShare && (
                <span className="bar-share tertiary amount">{Math.round(share * 100)}&#8239;%</span>
              )}
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${width}%`, background: slice.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface TrendPoint {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly formatted: string;
}

/**
 * Courbe de tendance.
 *
 * Trait de 2 px, aplat à 10 % — un aplat saturé écraserait tout le reste. La ligne du
 * zéro n'apparaît que si la courbe passe réellement dessous : sinon elle occupe de la
 * place sans rien dire.
 */
export function TrendChart({
  points,
  height = 190,
  color = 'var(--series-1)',
  zeroLine = true,
  markerAt,
}: {
  points: readonly TrendPoint[];
  height?: number;
  color?: string;
  zeroLine?: boolean;
  markerAt?: number;
}) {
  const [ref, width] = useMeasuredWidth();
  const padding = { top: 14, right: 10, bottom: 20, left: 10 };

  // Après les hooks : leur nombre doit rester constant d'un rendu à l'autre.
  if (points.length < 2) return null;

  const values = points.map((point) => point.y);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;

  const plotHeight = height - padding.top - padding.bottom;
  const plotWidth = width - padding.left - padding.right;

  const at = (point: TrendPoint, index: number): [number, number] => [
    padding.left + (index / (points.length - 1)) * plotWidth,
    padding.top + (1 - (point.y - min) / span) * plotHeight,
  ];

  const coordinates = points.map(at);
  const line = coordinates.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const baseline = padding.top + plotHeight;
  const area = `${line} L ${coordinates[coordinates.length - 1]![0]} ${baseline} L ${coordinates[0]![0]} ${baseline} Z`;
  const zeroY = padding.top + (1 - (0 - min) / span) * plotHeight;

  const marker = markerAt !== undefined ? coordinates[markerAt] : undefined;

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={width} height={height} role="img" aria-label="Évolution">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.16} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>

      {zeroLine && min < 0 && (
        <>
          <line
            x1={padding.left}
            y1={zeroY}
            x2={width - padding.right}
            y2={zeroY}
            stroke="var(--axis)"
            strokeWidth={1}
          />
          {/* Le zéro est la seule graduation qui compte ici : au-dessus le compte tient,
              en dessous il est à découvert. */}
          <text x={padding.left + 2} y={zeroY - 5} style={{ fill: 'var(--text-tertiary)', fontSize: 10 }}>
            0
          </text>
        </>
      )}

      <path d={area} fill="url(#trendFill)" />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {marker && (
        <>
          <circle cx={marker[0]} cy={marker[1]} r={6} fill={SURFACE} />
          <circle cx={marker[0]} cy={marker[1]} r={4} fill={color} />
        </>
      )}

      {points.map((point, index) => (
        <rect
          key={point.label}
          x={padding.left + (index / (points.length - 1)) * plotWidth - plotWidth / (points.length * 2)}
          y={0}
          width={plotWidth / points.length}
          height={height}
          fill="transparent"
        >
          <title>{`${point.label} — ${point.formatted}`}</title>
        </rect>
      ))}
      </svg>
    </div>
  );
}

export interface ColumnPair {
  readonly label: string;
  readonly left: number;
  readonly right: number;
  readonly leftFormatted: string;
  readonly rightFormatted: string;
}

/**
 * Colonnes appariées — revenus contre dépenses, mois par mois.
 *
 * Deux séries sur **une seule échelle**. Jamais deux axes verticaux : leur alignement
 * est arbitraire, et le graphique inventerait une corrélation qui n'existe pas.
 */
export function PairedColumns({
  data,
  leftLabel,
  rightLabel,
  leftColor = 'var(--series-3)',
  rightColor = 'var(--series-2)',
  height = 170,
}: {
  data: readonly ColumnPair[];
  leftLabel: string;
  rightLabel: string;
  leftColor?: string;
  rightColor?: string;
  height?: number;
}) {
  if (data.length === 0) return null;
  const ceiling = Math.max(...data.flatMap((entry) => [entry.left, entry.right]), 1);

  return (
    <>
      <div className="columns" style={{ height }}>
        {data.map((entry) => (
          <div className="column-group" key={entry.label}>
            <div className="column-pair">
              <div
                className="column"
                style={{ height: `${(entry.left / ceiling) * 100}%`, background: leftColor }}
                title={`${leftLabel} ${entry.label} — ${entry.leftFormatted}`}
              />
              <div
                className="column"
                style={{ height: `${(entry.right / ceiling) * 100}%`, background: rightColor }}
                title={`${rightLabel} ${entry.label} — ${entry.rightFormatted}`}
              />
            </div>
            <span className="column-label">{entry.label}</span>
          </div>
        ))}
      </div>
      <Legend
        items={[
          { label: leftLabel, color: leftColor },
          { label: rightLabel, color: rightColor },
        ]}
      />
    </>
  );
}

/** Légende. Toujours présente dès deux séries : personne ne doit avoir à deviner une
 *  identité par appariement de couleurs. */
export function Legend({
  items,
}: {
  items: readonly { label: string; color: string; note?: string }[];
}) {
  return (
    <div className="legend">
      {items.map((item) => (
        <span className="legend-item" key={item.label}>
          <span className="legend-swatch" style={{ background: item.color }} />
          {item.label}
          {item.note && <span className="tertiary"> · {item.note}</span>}
        </span>
      ))}
    </div>
  );
}

/** Petite courbe sans axes, glissée dans une tuile : elle donne la direction, pas la
 *  valeur — celle-ci est déjà écrite juste à côté, en grand. */
export function Sparkline({
  values,
  color = 'var(--series-1)',
  width = 84,
  height = 26,
}: {
  values: readonly number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 2 - ((value - min) / span) * (height - 4);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Cadre commun : un titre, une aide facultative, et le graphique. */
export function Figure({
  title,
  hint,
  children,
  aside,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="figure">
      <div className="figure-head">
        <h3 className="figure-title">{title}</h3>
        {aside}
      </div>
      {children}
      {hint && <p className="figure-hint">{hint}</p>}
    </div>
  );
}

export interface Series {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly values: readonly number[];
  /** Trait discontinu pour une série qui n'est pas une mesure mais un repère —
   *  les sommes versées face à une projection, par exemple. */
  readonly reference?: boolean;
}

/**
 * Plusieurs séries, une seule échelle verticale.
 *
 * Jamais deux axes : leur alignement relatif est arbitraire, et le lecteur y voit une
 * corrélation que les données ne portent pas. Deux grandeurs d'ordres différents
 * appellent deux graphiques, pas deux axes.
 */
export function MultiTrend({
  series,
  labels,
  height = 230,
  formatValue,
}: {
  series: readonly Series[];
  labels: readonly string[];
  height?: number;
  formatValue: (value: number) => string;
}) {
  const [ref, width] = useMeasuredWidth();
  const padding = { top: 16, right: 72, bottom: 26, left: 12 };
  const all = series.flatMap((entry) => entry.values);
  if (all.length === 0) return null;

  const min = Math.min(...all, 0);
  const max = Math.max(...all);
  const span = max - min || 1;
  const plotHeight = height - padding.top - padding.bottom;
  const plotWidth = width - padding.left - padding.right;
  const count = Math.max(labels.length - 1, 1);

  const x = (index: number) => padding.left + (index / count) * plotWidth;
  const y = (value: number) => padding.top + (1 - (value - min) / span) * plotHeight;

  // Quatre repères horizontaux : assez pour situer, trop peu pour encombrer.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => min + ratio * span);

  return (
    <>
      <div ref={ref} style={{ width: '100%' }}>
        <svg width={width} height={height} role="img" aria-label="Projection">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              y1={y(tick)}
              x2={width - padding.right}
              y2={y(tick)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text x={width - padding.right + 8} y={y(tick) + 4} style={{ fill: 'var(--text-tertiary)', fontSize: 11 }}>
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {series.map((entry) => {
          const path = entry.values
            .map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(value)}`)
            .join(' ');
          const last = entry.values.length - 1;
          return (
            <g key={entry.key}>
              <path
                d={path}
                fill="none"
                stroke={entry.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={entry.reference ? '5 5' : undefined}
                opacity={entry.reference ? 0.75 : 1}
              />
              {!entry.reference && entry.values[last] !== undefined && (
                <>
                  {/* Anneau en couleur de fond : le point reste lisible là où deux
                      courbes se croisent. */}
                  <circle cx={x(last)} cy={y(entry.values[last]!)} r={6} fill="var(--surface)" />
                  <circle cx={x(last)} cy={y(entry.values[last]!)} r={4} fill={entry.color} />
                </>
              )}
            </g>
          );
        })}

        {labels.map((label, index) =>
          index % Math.ceil(labels.length / 6) === 0 ? (
            <text
              key={label}
              x={x(index)}
              y={height - 6}
              textAnchor="middle"
              style={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
            >
              {label}
            </text>
          ) : null,
        )}
        </svg>
      </div>
      <Legend items={series.map((entry) => ({ label: entry.label, color: entry.color }))} />
    </>
  );
}
