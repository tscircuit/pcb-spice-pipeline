import { numerics } from '../kernel'
import { ibisNumber, ibisTimeSeconds, parseIbis } from '@tscircuit/ibis-to-spice'
import { fail } from './diagnostics'
import type { CompiledBuffer } from './types'

/** Extracts the fastest selected IBIS 20–80% ramp, converted to 10–90% edge time. */
export function extractionBand(models: readonly CompiledBuffer[], timing: readonly { maxStepSeconds: number; eyes: readonly { unitIntervalSeconds: number }[] }[]): { riseTimeSeconds: number; bitRateHz: number } {
  const edges: number[] = []
  const bits: number[] = []
  for (const model of models) {
    for (const stimulus of Object.values(model.input.run.stimuli)) bits.push(ibisTimeSeconds(stimulus.unitInterval))
    for (const pin of model.metadata.pins) if (pin.runState.mode === 'output') {
      const source = model.sourceEvidence.rawSourceFile
      void source
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
      if (!ramp) {
        const buffer = parseIbis(text).getBuffer(pin.model)
        for (const wave of buffer.waveforms) {
          const values = wave.data.map(row => row[index + 1]).filter((v): v is number => v !== null)
          const low = Math.min(...values)
          const high = Math.max(...values)
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
          const start = crossing(low + .1 * (high - low))
          const end = crossing(low + .9 * (high - low))
          if (start !== undefined && end !== undefined) edges.push(Math.abs(end - start))
        }
      }
    }
  }
  const drivers = models.some(m => m.metadata.pins.some(p => p.runState.mode === 'output'))
  if (drivers && !edges.some(v => Number.isFinite(v) && v > 0)) fail('ibis_edge', 'Selected output models need finite IBIS Ramp or waveform edge data')
  if (!bits.length) bits.push(...timing.flatMap(p => p.eyes.map(e => e.unitIntervalSeconds)))
  if (!bits.length) fail('ibis_edge', 'A bit stimulus or eye unit interval is required to derive the extraction band')
  return { riseTimeSeconds: drivers ? Math.min(...edges.filter(v => v > 0)) : Math.min(...timing.map(t => t.maxStepSeconds)) * numerics.cellsPerRiseTime,
    bitRateHz: 1 / Math.min(...bits) }
}
