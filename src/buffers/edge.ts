import { numerics, min, max } from '../kernel'
import { ibisNumber, ibisTimeSeconds, parseIbis } from '@tscircuit/ibis-to-spice'
import { fail } from './diagnostics'
import type { CompiledBuffer } from './types'

/** Uses physical IBIS or voltage-source edges and declared bit timing; never the solver timestep. */
export function extractionBand(models: readonly CompiledBuffer[], timing: readonly { eyes: readonly { unitIntervalSeconds: number }[] }[], sources: readonly { wave_shape?: string; is_dc_source?: boolean; rise_time?: number; fall_time?: number }[] = []): { riseTimeSeconds: number; bitRateHz: number } {
  const edges: number[] = []
  const bits: number[] = []
  for (const model of models) {
    for (const stimulus of Object.values(model.input.run.stimuli)) bits.push(ibisTimeSeconds(stimulus.unitInterval))
    for (const pin of model.metadata.pins) if (pin.runState.mode === 'output') {
      const before = edges.length
      // Metadata source is admitted separately; model text is attached to the compilation input.
      const text = model.sourceText
      if (typeof text !== 'string') fail('ibis_edge', 'Admitted IBIS text must accompany the compiled edge model')
      const blocks = [...text.matchAll(/^\[Model\]\s+([^\r\n]+)\r?\n([^]*?)(?=^\[Model\]|^\[End\]|$(?![^]))/gmi)]
      const block = blocks.find(b => b[1].trim() === pin.model)?.[2] ?? ''
      const ramp = block.match(/^\[Ramp\]([^]*?)(?=^\[|$(?![^]))/mi)?.[1]
      const index = { typical: 0, minimum: 1, maximum: 2 }[model.input.definition.corner]
      for (const match of ramp?.matchAll(/^dV\/dt_[rf]\s+([^\r\n]+)/gmi) ?? []) {
        const token = match[1].trim().split(/\s+/)[index]
        const dt = token?.split('/')[1]
        if (dt && dt.toUpperCase() !== 'NA') {
          const seconds = ibisNumber(dt)
          if (seconds !== null) edges.push(seconds * numerics.rampToRiseTime)
        }
      }
      if (!edges.slice(before).some(v=>Number.isFinite(v)&&v>0)) {
        const buffer = parseIbis(text).getBuffer(pin.model)
        for (const wave of buffer.waveforms) {
          const values = wave.data.map(row => row[index + 1]).filter((v): v is number => v !== null)
          const low = min(values)
          const high = max(values)
          /** First interpolated threshold crossing in a vendor fixture. */
          const crossing = (threshold: number): number | undefined => {
            for (let i = 1; i < wave.data.length; i++) {
              const a = wave.data[i - 1]
              const b = wave.data[i]
              const va = a[index + 1]
              const vb = b[index + 1]
              if (va !== null && vb !== null && va !== vb && (va - threshold) * (vb - threshold) <= 0) return a[0] + (b[0] - a[0]) * (threshold - va) / (vb - va)
            }
          }
          const start = crossing(low + numerics.edgeLowFraction * (high - low))
          const end = crossing(low + numerics.edgeHighFraction * (high - low))
          if (start !== undefined && end !== undefined) edges.push(Math.abs(end - start))
        }
      }
      if (!edges.slice(before).some(v=>Number.isFinite(v)&&v>0)) fail('ibis_edge', `${pin.model}: selected output needs finite IBIS Ramp or waveform edge data`)
    }
  }
  for (const source of sources) if (!source.is_dc_source && source.wave_shape==='square') for (const time of [source.rise_time,source.fall_time]) {
    if (typeof time!=='number' || !Number.isFinite(time) || time<=0) fail('ibis_edge','Physical square sources need positive rise/fall times')
    edges.push(time/1000*(numerics.edgeHighFraction-numerics.edgeLowFraction))
  }
  if (!edges.some(v=>Number.isFinite(v)&&v>0)) fail('ibis_edge','No physical edge: declare an IBIS output or a finite-edge square source; simulation timestep cannot define extraction physics')
  if (!bits.length) for (const plan of timing) for (const eye of plan.eyes) bits.push(eye.unitIntervalSeconds)
  if (!bits.length) fail('ibis_edge', 'A bit stimulus or eye unit interval is required to derive the extraction band')
  return { riseTimeSeconds: min(edges.filter(v => Number.isFinite(v)&&v > 0)),
    bitRateHz: 1 / min(bits) }
}
