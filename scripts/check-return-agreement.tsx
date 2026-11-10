import React from 'react'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ReturnAgreement from '../tests/fixtures/return-agreement'
import { modeling } from '../tests/fixtures/native-channel'
import { renderCoreSignals } from '../tests/support/core-render'
import { geometryFromCircuitJson, channelCopperScope, connectedSourceIds, segmentRoutes } from '../src/board'
import { extractChannel, extractRoutes, channelSpice, type StageMatrices } from '../src/extraction'
import { rootScope } from '../src/kernel'
import { guardedFields } from './guarded-fields'
import { routedNative } from './routed-native'

const root = resolve('runs/routed-2d/step4/controlled')
for (const [count, spacing] of [[1, .3], [3, .3], [3, 1]] as const) {
  const name = `${count}-${spacing}${spacing === 1 ? '-short' : ''}`
  if (process.argv[2] && process.argv[2] !== name) continue
  const directory = `${root}/${name}`
  await mkdir(directory, { recursive: true })
  await Promise.all(['failure.json', 'matrices.json', 'comparison.json'].map(file => rm(`${directory}/${file}`, { force: true })))
  try {
    const circuit = await renderCoreSignals(<ReturnAgreement count={count} spacing={spacing} length={spacing === 1 ? 5 : 10} />)
    const settings = { ...modeling, relativePermittivity: undefined, viaPlatingMm: .018,
      lanes: Array.from({ length: count }, (_, i) => ({ port: `S${i}`, from: { component: 'TX', port: `S${i}` }, to: { component: 'RX', port: `S${i}` } })),
      extraction: { ...modeling.extraction, modelHz: 1e8, maximumHz: 1e8, filaments: 3, refinementFilaments: 7, maxPanelLengthMm: 1, groundMeshMm: spacing === 1 ? 2 : 1 } }
    const geometry = geometryFromCircuitJson(circuit, settings)
    await writeFile(`${directory}/input.json`, JSON.stringify(circuit))
    await writeFile(`${directory}/geometry.json`, JSON.stringify(geometry, null, 2))
    let calls = 0
    console.log(`${name}: ${geometry.cells[0].profile}`)
    const extracted = await extractChannel(geometry, settings, rootScope('extraction'), { progress: console.log, runSolver: async request => {
      const path = `${directory}/native-${calls++}-${request.solver}`
      try {
        const old = JSON.parse(await readFile(`${path}/request.json`, 'utf8'))
        const usage = JSON.parse(await readFile(`${path}/usage.json`, 'utf8'))
        const stdout = await readFile(`${path}/stdout.log`, 'utf8')
        if (JSON.stringify(old) === JSON.stringify(request) && usage.peakRssKiB <= 768 * 1024 && (request.solver !== 'fastercap' || stdout.includes('Capacitance matrix is:'))) {
          const files = Object.fromEntries(await Promise.all(request.outputFiles.map(async file => [file, await readFile(`${path}/${file}`, 'utf8')])) )
          return { files, stdout, stderr: await readFile(`${path}/stderr.log`, 'utf8') }
        }
      } catch { /* Only exact complete calls are reusable. */ }
      console.log(`${name}: starting ${request.solver}`)
      return guardedFields(request, path)
    } })
    for (const artifact of extracted.artifacts) {
      await mkdir(`${directory}/${artifact.path.slice(0, artifact.path.lastIndexOf('/'))}`, { recursive: true })
      await writeFile(`${directory}/${artifact.path}`, artifact.body)
    }
    const reference = circuit.filter(record => record.type === 'source_net').find(net => net.name === 'GND')!
    const selected = new Set(geometry.mappings.flatMap(mapping => [...connectedSourceIds(circuit, mapping.from)]))
    const scope = channelCopperScope(circuit, selected, connectedSourceIds(circuit, reference.source_net_id), new Set(), 32)
    const sections = extractRoutes(segmentRoutes(circuit, scope), { maskMm: 0, maskEr: 1, maskLoss: 0, substrateLoss: 0 })
    const matrices: StageMatrices = { R: [], L: [], C: [] }
    for (const kind of ['R', 'L', 'C'] as const) matrices[kind] = Array.from({ length: count }, () => Array(count).fill(0))
    for (const slice of sections.slices) for (const [i, wire] of slice.wires.entries()) for (const [j, other] of slice.wires.entries()) {
      const a = geometry.mappings.findIndex(mapping => mapping.sourceTraceId === wire.source)
      const b = geometry.mappings.findIndex(mapping => mapping.sourceTraceId === other.source)
      if (a < 0 || b < 0) throw new Error('Unmapped controlled conductor')
      const length = (slice.end - slice.start) / 1000
      matrices.C[a][b] += slice.line.C[i][j] * length
      matrices.L[a][b] += slice.line.L[i][j] * length
      matrices.R[a][b] += slice.line.atFrequency(1e8).R[i][j] * length
    }
    const values = { threeD: extracted.value.matrices[0], twoD: matrices }
    await writeFile(`${directory}/matrices.json`, JSON.stringify(values, null, 2))
    for (const [method, matrix] of Object.entries(values)) {
      const path = `${directory}/${method}`
      await mkdir(path, { recursive: true })
      const sources = Array.from({ length: count }, (_, i) => i === 1 && count === 3 ? `V${i} src${i} 0 0` : `V${i} src${i} 0 pulse(0 3.3 2n 300p 300p 4n 10n)`).concat(Array.from({ length: count }, (_, i) => `R${i} src${i} in${i} 30\nC${i} out${i} 0 5p`))
      const pins = Array.from({ length: count }, (_, i) => `in${i}`).concat(Array.from({ length: count }, (_, i) => `out${i}`))
      await writeFile(`${path}/simulation.cir`, ['Controlled TSX geometry; linear 30 ohm drivers and 5 pF loads', '.options klu method=gear maxord=2 reltol=1e-5', ...sources, channelSpice([matrix], 16), `XCH ${pins.join(' ')} 0 CHANNEL`, '.control', 'set wr_singlescale', 'set wr_vecnames', 'tran 2p 20n', `wrdata waveform.dat ${Array.from({ length: count }, (_, i) => `v(out${i})`).join(' ')}`, 'quit', '.endc', '.end'].join('\n'))
      const usage = await routedNative(path, 20e-9)
      await writeFile(`${path}/usage.json`, JSON.stringify(usage))
      console.log(`${name}/${method}: ${usage.seconds.toFixed(3)} s`)
    }
  } catch (error) {
    await writeFile(`${directory}/failure.json`, JSON.stringify({ message: (error as Error).message }, null, 2))
    console.error(`${name}: ${(error as Error).message}`)
    process.exitCode = 1
  }
}
