import { validateCircuitRecords, type SignalResult, type SimulationSignal } from '../board'
import { receiverThresholds } from '../buffers'
import { crossingTimes, sampleVoltage, quietPeak, measureEye, strobeMargins, type Capture } from '../observation'
import type { PreparedBlock } from './signals'
import { endpointPorts, signalBits } from './signals'
import type { PreparedResult } from './result'

/** Match received strobe edges in order to transmitted edges of the same polarity, including before settling. */
function strobeCaptures(prepared: PreparedBlock, result: PreparedResult, signal: SimulationSignal, port: string, column: (signal: SimulationSignal, index: number) => number): Capture[] {
  const { signals, pins, duration, gate } = prepared
  const rows = result.experiments[0].waveform.rows
  const strobe = signals.find(s => s.simulation_signal_id === signal.strobe_simulation_signal_id)!
  const chip = pins.get(port)!.model.source_component_id
  const matches = strobe.receivers.flatMap((endpoint, index) => pins.get(endpointPorts(endpoint)[0])!.model.source_component_id === chip ? [index] : [])
  if (matches.length !== 1) throw new Error(`Signal "${signal.name}": expected exactly one ${strobe.name} receiver on ${chip}.`)
  const index = matches[0]
  const receiver = strobe.receivers[index]
  const limits = receiverThresholds(pins.get(endpointPorts(receiver)[0])!, receiver.kind === 'differential', strobe.mask, { typ: 0, min: 1, max: 2 }[prepared.block.corner])
  const received = crossingTimes(rows, column(strobe, index), (limits.vih + limits.vil) / 2, 0)
  const bits = signalBits(strobe, duration)
  const data = signalBits(signal, duration)
  const transmitted: { time: number; high: boolean }[] = []
  for (let bit = 1; strobe.offset_s + bit / strobe.bit_rate_bps < duration; bit++) if (bits[bit % bits.length] !== bits[(bit - 1) % bits.length]) transmitted.push({ time: strobe.offset_s + bit / strobe.bit_rate_bps, high: bits[bit % bits.length] === '1' })
  const captures: Capture[] = []
  let next = 0
  for (const time of received) {
    const epsilon = Math.min(prepared.step / 10, time / 2)
    const high = sampleVoltage(rows, column(strobe, index), time) > sampleVoltage(rows, column(strobe, index), time - epsilon)
    while (next < transmitted.length && transmitted[next].high !== high) next++
    if (next === transmitted.length) break
    const edge = transmitted[next++]
    const sampling = time + signal.offset_s
    // Data bit zero begins at data.offset; adding that same offset to the transmitted edge cancels it here.
    const bit = Math.max(0, Math.floor((edge.time + signal.offset_s - signal.offset_s) * signal.bit_rate_bps + 1e-10))
    if (sampling >= gate && sampling <= duration) captures.push({ time: sampling, high: data[bit % data.length] === '1' })
  }
  if (!captures.length) throw new Error(`Signal "${signal.name}": no received ${strobe.name} crossings after settling.`)
  return captures
}
/** Only exact shared Circuit JSON result records; private lowering records never leak. */
export function signalResults(prepared: PreparedBlock, result: PreparedResult): SignalResult[] {
  const { block, signals, pins, duration, gate } = prepared
  const run = result.experiments[0]
  const rows = run.waveform.rows
  const records: SignalResult[] = []
  const corner = { typ: 0, min: 1, max: 2 }[block.corner]
  /** Private probe-column lookup for one receiver/end. */
  const column = (signal: SimulationSignal, index: number): number => {
    const probe = run.probes.find(p => p.simulationVoltageProbeId === `${signal.simulation_signal_id}_${index}`)
    if (!probe) throw new Error(`${signal.name}: missing native probe`)
    return probe.column
  }
  for (const signal of signals) {
    const id = signal.simulation_signal_id
    const ui = 1 / signal.bit_rate_bps
    for (const [index, endpoint] of [...signal.receivers, ...(signal.quiet ? [signal.driver] : [])].entries()) {
      const port = endpointPorts(endpoint)[0]
      const end = index === signal.receivers.length ? 'near' : 'far'
      const probe = column(signal, index)
      records.push({ type: 'simulation_signal_waveform', simulation_signal_waveform_id: `${id}_${index}`, simulation_signal_id: id, end, source_port_id: port,
        timestamps_s: rows.map(r => r[0]), voltage_levels: rows.map(r => r[probe]) })
      if (signal.quiet) {
        const idle = result.idleVoltages?.[probe - 1]
        if (idle === undefined) throw new Error(`Signal "${signal.name}": floating quiet victim has no undisturbed idle operating point.`)
        records.push({ type: 'simulation_signal_crosstalk', simulation_signal_crosstalk_id: `${id}_${index}`, simulation_signal_id: id, end, source_port_id: port, ...quietPeak(rows, probe, gate, idle) })
        continue
      }
      const thresholds = receiverThresholds(pins.get(port)!, endpoint.kind === 'differential', signal.mask, corner)
      const captures = signal.strobe_simulation_signal_id ? strobeCaptures(prepared, result, signal, port, column) : undefined
      if (captures) {
        const mask = signal.mask === 'ibis' ? {} : signal.mask
        const edges = strobeMargins(rows, probe, captures, thresholds.vih, thresholds.vil, mask.setup_s ?? 0, mask.hold_s ?? 0)
        records.push({ type: 'simulation_signal_strobe_margin', simulation_signal_strobe_margin_id: `${id}_${index}`, simulation_signal_id: id, source_port_id: port,
          edges, worst_setup_margin_s: Math.min(...edges.map(e => e.setup_margin_s)), worst_hold_margin_s: Math.min(...edges.map(e => e.hold_margin_s)) })
      }
      try {
        const eye = measureEye(rows, probe, signalBits(signal, duration), ui, signal.offset_s, gate, thresholds.vih, thresholds.vil, captures, block.duration_s === undefined ? prepared.period : undefined)
        if (block.duration_s === undefined && captures && eye.traces.length < Math.round(prepared.period / ui)) throw new Error('recording needs complete eye windows and transmitted high and low bits after settling.')
        records.push({ type: 'simulation_signal_eye', simulation_signal_eye_id: `${id}_${index}`, simulation_signal_id: id, source_port_id: port,
          folded_traces: eye.traces, eye_height_v: eye.height, eye_width_s: eye.width, mask_margin_v: eye.margin })
      } catch (error) {
        if (block.duration_s !== undefined) throw new Error(`Signal "${signal.name}": explicit duration is too short for complete eye windows after settling. ${(error as Error).message}`)
        if (captures) throw Object.assign(error as Error, { code: 'automatic_duration' })
        throw error
      }
    }
  }
  const conductors: Extract<SignalResult, { type: 'simulation_signal_integrity_rlgc' }>['conductors'] = []
  const order: number[] = []
  for (const mapping of result.geometry.mappings) {
    const signal = signals.find(s => endpointPorts(s.driver).some(port => prepared.topology.get(port)?.has(mapping.from)))
    const leg = signal?.driver.kind === 'differential' ? (prepared.topology.get(signal.driver.p_source_port_id)?.has(mapping.from) ? 'p' : 'n') : 'single'
    const identity = signal ? { simulation_signal_id: signal.simulation_signal_id, leg } : { source_trace_id: mapping.sourceTraceId }
    let index = conductors.findIndex(c => JSON.stringify(c) === JSON.stringify(identity))
    if (index < 0) {
      index = conductors.length
      conductors.push(identity as (typeof conductors)[number])
    }
    order.push(index)
  }
  if (conductors.length) {
    const frequencies = [...new Set(result.matrices.map(matrix => matrix.frequencyHz))].sort((a, b) => a - b)
    /** Align each spatial section to public conductor identities and sum its already-total entries. */
    const total = (frequency: number, kind: 'R' | 'L' | 'C' | 'G'): number[][] => {
      const matrix = conductors.map(() => conductors.map(() => 0))
      for (const section of result.matrices.filter(m => m.frequencyHz === frequency)) for (const [i, row] of section[kind].entries()) for (const [j, value] of row.entries()) matrix[order[i]][order[j]] += value
      return matrix
    }
    records.push({ type: 'simulation_signal_integrity_rlgc', simulation_signal_integrity_rlgc_id: block.simulation_signal_integrity_id,
      simulation_signal_integrity_id: block.simulation_signal_integrity_id, conductors,
      matrices: frequencies.map(frequency => ({ frequency_hz: frequency, r_ohm: total(frequency, 'R'), l_h: total(frequency, 'L'), c_f: total(frequency, 'C'), g_s: total(frequency, 'G') })) })
  }
  validateCircuitRecords(records)
  return records
}
