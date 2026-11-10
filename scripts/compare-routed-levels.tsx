import React from 'react'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { renderCoreSignals } from '../tests/support/core-render'
import { prepareBlocks, endpointPorts } from '../src/pipeline/signals'
import { routedSimulation } from '../src/pipeline'
import { edgeSeconds } from '../src/buffers'
import { routedNative } from './routed-native'
import Single from '../examples/level1-single-ended/level1-single-ended'
import Differential from '../examples/level1-differential/level1-differential'
import Two from '../examples/level2-two-channels/level2-two-channels'
import Three from '../examples/level3-three-channels/level3-three-channels'

const sources = Object.fromEntries(await Promise.all(['sn74lvc1g04.ibs', 'sn65hvd72.ibs'].map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/${file}`)] as const)))
for (const [name, Board] of Object.entries({ single: Single, differential: Differential, two: Two, three: Three })) {
  if (process.argv[2] && process.argv[2] !== name) continue
  const circuit = await renderCoreSignals(<Board />)
  for (const block of prepareBlocks(circuit, sources, '2d')) {
    if (process.env.SI_BLOCK && process.env.SI_BLOCK !== block.block.name) continue
    if (process.env.SI_ROUTE_COUPLING_MM) block.settings.copperScope!.lateralDistanceMm = Number(process.env.SI_ROUTE_COUPLING_MM)
    const root = process.env.SI_ROUTE_RUN_ROOT ?? `runs/routed-2d/step3/part-a${process.env.SI_ROUTE_COUPLING_MM ? '-horizon' : '-full'}`
    const directory = resolve(`${root}/${name}/${block.block.name ?? 'default'}`)
    await mkdir(directory, { recursive: true })
    await Promise.all(['waveform.dat', 'receiver.csv', 'result.json', 'failure.json', 'native.json', 'ngspice-native.log', 'ngspice.log'].map(file => rm(`${directory}/${file}`, { force: true })))
    const rise = Math.min(...block.signals.flatMap(signal => endpointPorts(signal.driver).map(port => edgeSeconds(block.pins.get(port)!))))
    const duration = process.env.SI_ROUTE_DURATION_NS ? Math.min(block.duration, Number(process.env.SI_ROUTE_DURATION_NS) * 1e-9) : block.duration
    if (!(Number.isFinite(duration) && duration > rise / 20)) throw new Error('Positive duration exceeding one timestep required')
    const refinement = Number(process.env.SI_ROUTE_REFINEMENT ?? 1)
    const timeRefinement = Number(process.env.SI_ROUTE_TIME_REFINEMENT ?? 1)
    if (![1, 2, 4].includes(timeRefinement)) throw new Error('Time refinement must be 1, 2 or 4')
    const result = routedSimulation(block, sources, { riseSeconds: rise, refinement, durationSeconds: duration, stepSeconds: rise / (20 * timeRefinement) })
    const hash = createHash('sha256').update(JSON.stringify(circuit)).digest('hex')
    await writeFile(`${directory}/simulation.cir`, result.deck)
    await writeFile(`${directory}/input.json`, JSON.stringify(circuit))
    await writeFile(`${directory}/extraction.json`, JSON.stringify({ ...result.evidence, probe_names: result.probes, timings: result.timings, rendered_board_sha256: hash, original_duration_s: block.duration,
      signals: block.signals, ibis_sha256: Object.fromEntries(Object.entries(sources).map(([file, bytes]) => [file, createHash('sha256').update(bytes).digest('hex')])) }, null, 2))
    console.log(`${name}/${block.block.name ?? 'default'}: ${result.evidence.cells} cells, ${duration * 1e9} ns`)
    try {
      const native = await routedNative(directory, duration)
      const rows = (await readFile(`${directory}/waveform.dat`, 'utf8')).trim().split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/).map(Number))
      if (rows.at(-1)![0] < duration * .999 || rows.some(row => row.some(value => !Number.isFinite(value)))) throw new Error('Incomplete/nonfinite native waveform')
      await writeFile(`${directory}/receiver.csv`, ['time_s,' + result.probes.join(','), ...rows.map(row => row.join(','))].join('\n') + '\n')
      await writeFile(`${directory}/result.json`, JSON.stringify(native, null, 2))
      console.log(`${name}/${block.block.name ?? 'default'}: ${native.seconds.toFixed(3)} s`)
    } catch (error) {
      await writeFile(`${directory}/failure.json`, JSON.stringify({ error: (error as Error).message }, null, 2))
      process.exitCode = 1
    }
  }
}
