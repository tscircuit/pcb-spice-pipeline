import type { SignalResult, SimulationSignal, SignalEndpoint } from '../board'
import { receiverThresholds } from '../buffers'
import { crossingTimes, quietPeak, measureEye, strobeMargins } from '../observation'
import type { PreparedBlock } from './signals'
import { endpointPorts, signalBits } from './signals'
import type { PreparedResult } from './result'

/** New Circuit JSON records only: internally lowered transient records never leak into results. */
export function signalResults(prepared: PreparedBlock, result: PreparedResult): SignalResult[] {
  const { block, signals, pins } = prepared
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
    const start = signal.offset_s + 16 * ui
    if (start >= block.duration_s) throw new Error(`${signal.name}: duration must exceed 16 UI settling`)
    /** Emit the signed waveform against its physical local/global reference. */
    const waveform = (endpoint: SignalEndpoint, index: number, end: 'near' | 'far'): void => {
      const port = endpointPorts(endpoint)[0]
      const probe = run.probes.find(p => p.column === column(signal, index))!
      records.push({ type: 'simulation_signal_waveform', simulation_signal_waveform_id: `${id}_${index}`, simulation_signal_id: id, end, source_port_id: port,
        reference_source_port_id: probe.referenceSourceId!, time_s: rows.map(r => r[0]), voltage_v: rows.map(r => r[probe.column]) })
    }
    for (const [index, receiver] of signal.receivers.entries()) waveform(receiver, index, 'far')
    if (signal.quiet) {
      waveform(signal.driver, signal.receivers.length, 'near')
      records.push({ type: 'simulation_signal_crosstalk', simulation_signal_crosstalk_id: id, simulation_signal_id: id,
        peak_next_v: quietPeak(rows, column(signal, signal.receivers.length), start), peak_fext_v: Math.max(...signal.receivers.map((_, i) => quietPeak(rows, column(signal, i), start))) })
      continue
    }
    for (const [index, receiver] of signal.receivers.entries()) {
      const port = endpointPorts(receiver)[0]
      const thresholds = receiverThresholds(pins.get(port)!, receiver.kind === 'differential', signal.mask, corner)
      let captures: number[] | undefined
      if (signal.strobe_simulation_signal_id) {
        const strobe = signals.find(s => s.simulation_signal_id === signal.strobe_simulation_signal_id)!
        // A multi-drop data pin must use the strobe received on that same chip.
        const chip = pins.get(port)!.model.source_component_id
        let strobeIndex = strobe.receivers.findIndex(endpoint => pins.get(endpointPorts(endpoint)[0])!.model.source_component_id === chip)
        if (strobeIndex < 0 && strobe.receivers.length === 1) strobeIndex = 0
        if (strobeIndex < 0) throw new Error(`${signal.name}: no strobe receiver on the data receiver chip`)
        const receiver = strobe.receivers[strobeIndex]
        const limits = receiverThresholds(pins.get(endpointPorts(receiver)[0])!, receiver.kind === 'differential', strobe.mask, corner)
        captures = crossingTimes(rows, column(strobe, strobeIndex), (limits.vih + limits.vil) / 2, start)
        if (!captures.length) throw new Error(`${signal.name}: no received strobe crossings after settling`)
        const mask = signal.mask === 'ibis' ? {} : signal.mask
        const edges = strobeMargins(rows, column(signal, index), captures, thresholds.vih, thresholds.vil, mask.setup_s ?? 0, mask.hold_s ?? 0)
        records.push({ type: 'simulation_signal_strobe_margin', simulation_signal_strobe_margin_id: `${id}_${index}`, simulation_signal_id: id, source_port_id: port,
          edges, worst_setup_margin_s: Math.min(...edges.map(e => e.setup_margin_s)), worst_hold_margin_s: Math.min(...edges.map(e => e.hold_margin_s)) })
      }
      const eye = measureEye(rows, column(signal, index), signalBits(signal, block.duration_s), ui, signal.offset_s, start, thresholds.vih, thresholds.vil, captures)
      records.push({ type: 'simulation_signal_eye', simulation_signal_eye_id: `${id}_${index}`, simulation_signal_id: id, source_port_id: port,
        unit_interval_s: ui, folded_traces: eye.traces, eye_height_v: eye.height, eye_width_s: eye.width, mask_margin_v: eye.margin,
        vih_v: thresholds.vih, vil_v: thresholds.vil, alignment: captures ? 'strobe' : 'bit_rate' })
    }
  }
  records.push({ type: 'simulation_signal_integrity_rlgc', simulation_signal_integrity_rlgc_id: block.simulation_signal_integrity_id,
    simulation_signal_integrity_id: block.simulation_signal_integrity_id, signal_order: result.geometry.mappings.map(mapping => {
      const signal = signals.find(s => endpointPorts(s.driver).includes(mapping.from))
      return signal?.simulation_signal_id ?? mapping.port
    }), source_port_order: result.geometry.mappings.map(mapping => mapping.from),
    matrices: result.matrices.map(matrix => ({ frequency_hz: matrix.frequencyHz, r_ohm: matrix.R, l_h: matrix.L, c_f: matrix.C, g_s: matrix.R.map(row => row.map(() => 0)) })) })
  return records
}
