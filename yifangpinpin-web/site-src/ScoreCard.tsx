function tier(score: number): string {
  if (score >= 70) return "超值笋盘";
  if (score >= 40) return "优质好房";
  return "普通房源";
}

export function ScoreCard({ score }: { score: number }) {
  return (
    <div className="m-score-card">
      <div className="m-score-top">
        <div className="t">
          <b>笋度评分</b>
          <span>综合价格优势 · 产权 · 核验</span>
        </div>
        <div className="v">
          <em>{score}</em>
          <span>/100</span>
        </div>
      </div>
      <span className="m-score-tier">{tier(score)}</span>
    </div>
  );
}
