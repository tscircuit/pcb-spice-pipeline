// Research parity check: ngspice ASCII raw vs Xyce `.print tran format=csv`, on ngspice's own timestamps.
// Usage: bun scripts/xyce-compare.ts <waveform.raw> <waveform.csv>
import { readFile } from 'node:fs/promises'
import { parseSpiceVectors } from '../src/observation'

/** Linear interpolation of a monotone sampled waveform. */
function sample(times: number[], values: number[], time: number): number {
  let low = 0
  let high = times.length - 1
  if (time <= times[0]) return values[0]
  if (time >= times[high]) return values[high]
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (times[middle] <= time) low = middle
    else high = middle
  }
  return values[low] + (values[high] - values[low]) * (time - times[low]) / (times[high] - times[low])
}

/** Columns of a Xyce CSV print file, keyed by lower-case header. */
function xyceColumns(text: string): Map<string, number[]> {
  const [header, ...rows] = text.trim().split(/\r?\n/)
  const names = header.split(',').map(name => name.trim().toLowerCase())
  const columns = new Map(names.map(name => [name, [] as number[]]))
  for (const row of rows) row.split(',').forEach((value, i) => columns.get(names[i])!.push(Number(value)))
  return columns
}

if (import.meta.main) {
  const [rawPath, csvPath] = process.argv.slice(2)
  const vectors = parseSpiceVectors(await readFile(rawPath, 'utf8'))
  const xyce = xyceColumns(await readFile(csvPath, 'utf8'))
  const times = vectors.find(vector => vector.name === 'time')!.values
  const xyceTimes = xyce.get('time')!
  const end = Math.min(times.at(-1)!, xyceTimes.at(-1)!)
  const report = vectors.filter(vector => vector.name.startsWith('v(') && xyce.has(vector.name)).map(vector => {
    const errors = times.flatMap((time, i) => time > end ? [] : [Math.abs(vector.values[i] - sample(xyceTimes, xyce.get(vector.name)!, time))])
    const swing = Math.max(...vector.values) - Math.min(...vector.values)
    return { node: vector.name, swingV: swing, maxAbsErrorMv: 1000 * Math.max(...errors), rmsErrorMv: 1000 * Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length) }
  })
  console.log(JSON.stringify({ ngspicePoints: times.length, xycePoints: xyceTimes.length, comparedUntilSeconds: end, nodes: report }, null, 2))
}
