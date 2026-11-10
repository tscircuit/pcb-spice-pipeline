import { isQuiet, validateCircuitRecords, type SignalResult } from '../board'
import type { PreparedBlock } from './signals'
import { endpointPorts } from './signals'
import type { PreparedResult } from './result'

/** Emit only receiver/quiet-driver waveforms and total matrices of listed signal legs. */
export function signalResults(prepared: PreparedBlock, result: PreparedResult): SignalResult[] {
  const { block, signals } = prepared
  const run = result.experiments[0]
  const rows = run.waveform.rows
  const records: SignalResult[] = []
  for (const signal of signals) {
    const id = signal.simulation_signal_id
    for (const [index, endpoint] of [...signal.receivers, ...(isQuiet(signal) ? [signal.driver] : [])].entries()) {
      const probe = run.probes.find(probe => probe.simulationVoltageProbeId === `${id}_${index}`)
      if (!probe) throw new Error(`${signal.name}: missing native probe`)
      const idle = isQuiet(signal) ? result.idleVoltages?.[probe.column - 1] : undefined
      if (isQuiet(signal) && idle === undefined) throw new Error(`Signal "${signal.name}": floating quiet victim has no undisturbed idle operating point.`)
      records.push({ type: 'simulation_signal_waveform', simulation_signal_waveform_id: `${id}_${index}`, simulation_signal_id: id,
        source_port_id: endpointPorts(endpoint)[0],
        timestamps_s: rows.map(row => row[0]), voltage_levels: rows.map(row => row[probe.column]),
        ...(idle !== undefined ? { idle_voltage_v: idle } : {}) })
    }
  }
  const conductors: Extract<SignalResult, { type: 'simulation_signal_integrity_rlgc' }>['conductors'] = []
  const order = result.geometry.mappings.map(mapping => {
    const signal = signals.find(signal => endpointPorts(signal.driver).some(port => prepared.topology.get(port)?.has(mapping.from)))
    if (!signal) return -1
    const port = endpointPorts(signal.driver).find(port => prepared.topology.get(port)?.has(mapping.from))!
    let index = conductors.findIndex(conductor => conductor.simulation_signal_id === signal.simulation_signal_id && conductor.source_port_id === port)
    if (index < 0) {
      index = conductors.length
      conductors.push({ simulation_signal_id: signal.simulation_signal_id, source_port_id: port })
    }
    return index
  })
  if (conductors.length) {
    const frequencies = [...new Set(result.matrices.map(matrix => matrix.frequencyHz))].sort((a, b) => a - b)
    /** Sum section totals after selecting the listed rows and columns; unlisted copper stays private. */
    const total = (frequency: number, kind: 'R' | 'L' | 'C' | 'G'): number[][] => {
      const matrix = conductors.map(() => conductors.map(() => 0))
      for (const section of result.matrices.filter(matrix => matrix.frequencyHz === frequency)) {
        for (const [i, row] of section[kind].entries()) for (const [j, value] of row.entries()) {
          if (order[i] >= 0 && order[j] >= 0) matrix[order[i]][order[j]] += value
        }
      }
      return matrix
    }
    records.push({ type: 'simulation_signal_integrity_rlgc', simulation_signal_integrity_rlgc_id: block.simulation_signal_integrity_id,
      simulation_signal_integrity_id: block.simulation_signal_integrity_id, conductors,
      matrices: frequencies.map(frequency => ({ frequency_hz: frequency, r_ohm: total(frequency, 'R'), l_h: total(frequency, 'L'), c_f: total(frequency, 'C'), g_s: total(frequency, 'G') })) })
  }
  validateCircuitRecords([...signals, ...records])
  return records
}
