import React, { useMemo } from 'react'
import { formatSiUnit } from 'format-si-unit'
import type { RouteVoltageRange } from '../../src/simulation'
import type { BoardStageState } from './state'

/** Short SI readout, e.g. 576µ or 40n, rounded to four significant digits. */
function si(value: number): string {
  return formatSiUnit(Number(value.toPrecision(4)))
}

/** Plot actual probe samples with a playhead synced to the time slider, without resampling solver evidence. */
export function Waveform({
  captures,
  time,
  range,
}: {
  captures: BoardStageState['captures']
  time: number
  range: RouteVoltageRange
}): React.JSX.Element {
  const series = useMemo(
    () => captures.flatMap((capture) => capture.probes.map((probe) => ({ ...probe, times: capture.timestampsSeconds }))),
    [captures],
  )
  const duration = Math.max(0, ...series.map((probe) => probe.times.at(-1) ?? 0))
  const { low, high } = range
  const colors = ['#2563eb', '#dc2626', '#059669', '#9333ea']
  /** Map a sample to chart coordinates. */
  const point = (seconds: number, volts: number): [number, number] => [
    40 + (seconds / Math.max(duration, 1e-30)) * 680,
    120 - ((volts - low) / (high - low)) * 105,
  ]
  const paths = useMemo(
    () =>
      series.map((probe, index) => (
        <g key={`${index}:${probe.name}`} fill={colors[index % colors.length]}>
          <polyline
            fill="none"
            stroke={colors[index % colors.length]}
            strokeWidth={1.5}
            points={probe.times.map((sample, i) => point(sample, probe.voltageLevels[i]).join(',')).join(' ')}
          />
          <text x={726} y={point(0, probe.voltageLevels.at(-1) ?? low)[1] + 4} fontSize={12}>
            {probe.name}
          </text>
        </g>
      )),
    [series, duration, low, high],
  )
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const playhead = point(Math.min(time, duration), low)[0]
  return (
    <div className="board-waveform">
      <svg viewBox="0 0 800 140" role="img" aria-label="Native probe waveforms with a synced playhead">
        <path d="M40 10 V120 H720" stroke="#94a3b8" fill="none" />
        {ticks.map((tick) => (
          <text key={tick} x={40 + tick * 680} y={136} fontSize={11} fill="#64748b" textAnchor="middle">
            {si(tick * duration)}s
          </text>
        ))}
        <text x={34} y={19} fontSize={11} fill="#64748b" textAnchor="end">
          {si(high)}V
        </text>
        <text x={34} y={120} fontSize={11} fill="#64748b" textAnchor="end">
          {si(low)}V
        </text>
        {paths}
        {duration > 0 && <line x1={playhead} x2={playhead} y1={8} y2={122} stroke="#0f172a" strokeWidth={2} />}
      </svg>
    </div>
  )
}
