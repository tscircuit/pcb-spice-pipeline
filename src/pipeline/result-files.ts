import type { CircuitJson } from '../board'
import { jsonBody, type FileMap } from '../kernel'

/** Preserve the aggregate artifact when it fits; split full-resolution waveforms losslessly at V8's string limit. */
export function signalResultFiles(records: CircuitJson, serialize: (value: unknown) => string = jsonBody): FileMap {
  try {
    return { 'circuit-results.json': serialize(records) } }
  catch (error) {
    if (!(error instanceof RangeError) || !records.some(record => record.type === 'simulation_signal_waveform')) throw error
    const files: FileMap = {}
    const parts: { file: string; indices: number[] }[] = []
    const retained = records.flatMap((record, index) => {
      if (record.type !== 'simulation_signal_waveform') return [{ record, index }]
      const file = `circuit-results/waveform-${index}.json`
      files[file] = serialize([record])
      parts.push({ file, indices: [index] })
      return []
    })
    files['circuit-results.json'] = serialize(retained.map(item => item.record))
    parts.unshift({ file: 'circuit-results.json', indices: retained.map(item => item.index) })
    files['circuit-results.index.json'] = jsonBody({ parts })
    return files
  }
}
