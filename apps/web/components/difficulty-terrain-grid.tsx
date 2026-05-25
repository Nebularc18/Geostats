"use client";

import { Fragment, type CSSProperties } from "react";

const values = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

function label(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function DifficultyTerrainGrid({
  data
}: {
  data: { difficulty: number; terrain: number; count: number }[];
}) {
  const counts = new Map(data.map((cell) => [`${cell.difficulty}/${cell.terrain}`, cell.count]));
  const max = Math.max(1, ...data.map((cell) => cell.count));

  return (
    <div className="dt-matrix-wrap">
      <div className="dt-matrix" style={{ gridTemplateColumns: `46px repeat(${values.length}, minmax(54px, 1fr))` }}>
        <div className="dt-axis-corner">D/T</div>
        {values.map((terrain) => (
          <div key={`terrain-${terrain}`} className="dt-axis">
            T{label(terrain)}
          </div>
        ))}
        {values.map((difficulty) => (
          <Fragment key={`row-${difficulty}`}>
            <div key={`difficulty-${difficulty}`} className="dt-axis">
              D{label(difficulty)}
            </div>
            {values.map((terrain) => {
              const count = counts.get(`${difficulty}/${terrain}`) ?? 0;
              const intensity = count === 0 ? 0 : Math.max(0.18, count / max);
              return (
                <div
                  key={`${difficulty}-${terrain}`}
                  className={count === 0 ? "dt-cell empty" : "dt-cell"}
                  style={{ "--intensity": intensity } as CSSProperties}
                  title={`D${label(difficulty)} / T${label(terrain)}: ${count}`}
                >
                  {count}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
