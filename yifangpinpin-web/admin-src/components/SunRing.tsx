function sunColor(s: number) {
  if (s >= 80) return "#D8323B";
  if (s >= 50) return "#E08A14";
  return "#9A8D7E";
}

export function SunRing({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score));
  const c = 2 * Math.PI * 15;
  const off = c * (1 - s / 100);
  const col = sunColor(s);
  return (
    <svg className="yfp-sun-ring" viewBox="0 0 38 38">
      <circle cx="19" cy="19" r="15" fill="none" stroke="#F0E8D9" strokeWidth="4" />
      <circle
        cx="19"
        cy="19"
        r="15"
        fill="none"
        stroke={col}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform="rotate(-90 19 19)"
      />
      <text x="19" y="19" textAnchor="middle" dominantBaseline="central" fill={col}>
        {s}
      </text>
    </svg>
  );
}
