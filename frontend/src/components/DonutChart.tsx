interface Segment { label: string; value: number; color: string; }

interface Props {
  segments: Segment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}

export default function DonutChart({ segments, size = 140, thickness = 22, centerLabel, centerValue }: Props) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={(size - thickness)/2 - 2}
        fill="none" stroke="#e0e0e0" strokeWidth={thickness} />
    </svg>
  );

  const r = (size - thickness) / 2 - 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      {segments.map((seg, i) => {
        const dash = (seg.value / total) * circ;
        const gap = circ - dash;
        const el = (
          <circle
            key={i}
            cx={size/2} cy={size/2} r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
          />
        );
        offset += dash;
        return el;
      })}
      {(centerLabel || centerValue) && (
        <g style={{ transform: `rotate(90deg) translate(0, -${size}px)` }}>
          {/* This won't work due to SVG transform complexity, handled in parent */}
        </g>
      )}
    </svg>
  );
}
