import React, { useMemo } from 'react'
import type { BoardStageState } from './state'

/** Plot actual probe samples and one shared time cursor, without resampling solver evidence. */
export function Waveform({ captures, time }: { captures: BoardStageState['captures']; time: number }): React.JSX.Element {
  const series = useMemo(
    () => captures.flatMap((capture) => capture.probes.map((probe) => ({ ...probe, times: capture.timestampsSeconds }))),
    [captures],
  )
  const duration = Math.max(0, ...series.map((probe) => probe.times.at(-1) ?? 0))
  const low = series.reduce((low, probe) => probe.voltageLevels.reduce((value, sample) => Math.min(value, sample), low), -1)
  const high = series.reduce((high, probe) => probe.voltageLevels.reduce((value, sample) => Math.max(value, sample), high), 5)
  const colors = ['#2563eb', '#dc2626', '#059669', '#9333ea']
  const paths = useMemo(
    () =>
      series.map((probe, index) => (
        <polyline
          key={`${index}:${probe.name}`}
          fill="none"
          stroke={colors[index % colors.length]}
          strokeWidth={1.5}
          points={probe.times
            .map((sample, i) => `${40 + (sample / duration) * 750},${120 - ((probe.voltageLevels[i] - low) / (high - low)) * 100}`)
            .join(' ')}
        />
      )),
    [series, duration, low, high],
  )
  return (
    <div className="board-waveform">
      <svg viewBox="0 0 800 150" role="img" aria-label="Native probe waveforms with shared time cursor">
        <path d="M40 10 V120 H790" stroke="#94a3b8" fill="none" />
        {paths}
        {duration > 0 && (
          <line
            x1={40 + (time / duration) * 750}
            x2={40 + (time / duration) * 750}
            y1={10}
            y2={120}
            stroke="#0f172a"
            strokeDasharray="4 3"
          />
        )}
        <text x={2} y={18} fontSize={12}>
          {high.toFixed(1)} V
        </text>
        <text x={2} y={120} fontSize={12}>
          {low.toFixed(1)} V
        </text>
        <text x={40} y={140} fontSize={12}>
          0 ns
        </text>
        <text x={690} y={140} fontSize={12}>
          {(duration * 1e9).toPrecision(4)} ns
        </text>
      </svg>
      <details>
        <summary>{series.length} probe waveforms · native candidate, unqualified</summary>
        {series.map((probe, index) => (
          <div key={index} style={{ color: colors[index % colors.length] }}>
            {probe.name}
          </div>
        ))}
      </details>
    </div>
  )
}
