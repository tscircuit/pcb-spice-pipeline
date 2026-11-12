import { fail } from './diagnostics'

export interface SpiceVector { name: string; type: string; values: number[] }

/** Read real, ASCII ngspice batch vectors without assuming the engine's variable order. */
export function parseSpiceVectors(text: string): SpiceVector[] {
  const header = text.split(/^Values:\s*$/m)
  const count = Number(/^No\. Variables:\s*(\d+)\s*$/m.exec(header[0])?.[1])
  const points = Number(/^No\. Points:\s*(\d+)\s*$/m.exec(header[0])?.[1])
  if (header.length !== 2 || !/^Flags:\s*real\s*$/m.test(header[0]) || !Number.isSafeInteger(count) || count < 2 || !Number.isSafeInteger(points) || points < 2)
    fail('waveform', 'Expected real ASCII ngspice vectors with at least two samples')
  const variables = header[0].split(/^Variables:\s*$/m)[1]?.trim().split(/\r?\n/) ?? []
  const vectors = variables.map((line, i) => {
    const [index, name, type, ...extra] = line.trim().split(/\s+/)
    if (Number(index) !== i || !name || !type || extra.length) fail('waveform', 'Invalid ngspice variable declaration')
    return { name: name.toLowerCase(), type, values: [] as number[] }
  })
  if (vectors.length !== count || new Set(vectors.map(vector => vector.name)).size !== count) fail('waveform', 'Invalid ngspice variable count or duplicate name')
  const values = header[1].trim().split(/\s+/).map(Number)
  if (values.length !== points * (count + 1) || values.some(value => !Number.isFinite(value))) fail('waveform', 'Expected one finite value per ngspice vector and sample')
  for (let sample = 0; sample < points; sample++) {
    const offset = sample * (count + 1)
    if (values[offset] !== sample) fail('waveform', 'Invalid ngspice sample index')
    for (let column = 0; column < count; column++) vectors[column].values.push(values[offset + column + 1])
  }
  return vectors
}

/** Format real vectors for protocol fixtures using the native batch transport. */
export function formatSpiceVectors(vectors: SpiceVector[]): string {
  const points = vectors[0]?.values.length ?? 0
  if (vectors.length < 2 || points < 2 || vectors.some(vector => vector.values.length !== points || vector.values.some(value => !Number.isFinite(value)) || !/^\S+$/.test(vector.name) || !/^\S+$/.test(vector.type)))
    fail('waveform', 'Expected complete finite real engine vectors')
  const lines = ['Title: Routed transient', 'Plotname: Transient Analysis', 'Flags: real', `No. Variables: ${vectors.length}`, `No. Points: ${points}`, 'Variables:', ...vectors.map((vector, i) => `\t${i}\t${vector.name}\t${vector.type}`), 'Values:']
  for (let sample = 0; sample < points; sample++) lines.push(`${sample}\t${vectors.map(vector => vector.values[sample]).join('\n\t')}`)
  return lines.join('\n') + '\n'
}

/** Difference receiver and reference vectors at the actual adaptive sample times. */
export function spiceProbeRows(text: string, probes: readonly { signalNode: string; referenceNode: string }[]): number[][] {
  const vectors = new Map(parseSpiceVectors(text).map(vector => [vector.name, vector.values]))
  const times = vectors.get('time')
  if (!times) return fail('waveform', 'Missing ngspice time vector')
  if (times.some((time, i) => i > 0 && time < times[i - 1])) fail('waveform', 'Expected increasing actual solver timestamps')
  /** Ground is implicit; every other requested node must be present. */
  const node = (name: string, sample: number): number => {
    if (name === '0') return 0
    const values = vectors.get(`v(${name.toLowerCase()})`)
    if (!values) return fail('waveform', `Missing ngspice vector v(${name})`)
    return values[sample]
  }
  return times.flatMap((time, i) => i < times.length - 1 && time === times[i + 1] ? [] : [[time, ...probes.map(probe => node(probe.signalNode, i) - node(probe.referenceNode, i))]])
}
