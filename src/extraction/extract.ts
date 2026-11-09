import type { Artifact, ArtifactScope, Produced } from '../kernel'
import { sha256, numerics, max } from '../kernel'
import type { SolverContext } from '../solver'
import type { Geometry } from '../board'
import { fail } from './diagnostics'
import { validateMatrix } from './checks'
import { solve, scale, type Matrix } from './linalg'
import { epsilon0, mu0, type BemResult } from './bem'
import { fitLoss, fittedLoss, fittedStorage } from './loss'
import { cachedSlice } from './cache'
import { viaRlc } from './via'
import { channelSpice } from './rlgc'
import type { ExtractionModeling, ExtractedChannel, ExtractedStage } from './types'

/** Cached 2D extraction only. Native solvers are used later for transient simulation, never for board extraction. */
export async function extractChannel(geometry: Geometry, band: ExtractionModeling, scope: ArtifactScope, ctx: SolverContext): Promise<Produced<ExtractedChannel>> {
  if (![band.bitRateHz, band.riseTimeSeconds].every(v => Number.isFinite(v) && v > 0)) fail('model_frequency', 'Extraction requires a derived finite IBIS edge time and bit rate')
  ctx.progress('Extract 2D channel')
  const cache = new Map<string, BemResult>()
  const artifacts: Artifact[] = []
  const matrices: ExtractedStage[] = []
  const minimum = band.bitRateHz * numerics.minimumFrequencyPerBitRate
  const maximum = Math.max(band.bitRateHz, numerics.maximumFrequencyPerInverseRise / band.riseTimeSeconds)
  const frequenciesHz = Array.from({ length: numerics.frequencySamples }, (_, i) => minimum * (maximum / minimum) ** (i / (numerics.frequencySamples - 1)))
  const frequencyHz = numerics.kneeFrequencyPerInverseRise / band.riseTimeSeconds
  for (const cell of geometry.cells) {
    const sliceHash = sha256(JSON.stringify(cell.slice ? { ...cell.slice, conductors: cell.slice.conductors.map(({ id, physicalNet, ...physical }) => physical) } : cell.via))
    const n = cell.ports.length
    let R: Matrix
    let L: Matrix
    let C: Matrix
    let C0: Matrix
    let skin: Matrix
    let dielectric: Matrix
    let mesh: BemResult['steps'] = []
    let skinFrequency = minimum
    if (cell.via) {
      const via = viaRlc(cell.via)
      R = [[via.R]]
      L = [[via.L]]
      C = [[via.C]]
      C0 = [[via.C / cell.via.er]]
      skin = [[0]]
      dielectric = [[0]]
    } else {
      let solution = cache.get(sliceHash)
      if (!solution) {
        ctx.progress(`Segment ${cell.stage}: solve slice ${sliceHash}`)
        solution = cachedSlice(sliceHash, cell.slice!, message => ctx.progress(`Segment ${cell.stage}: ${message}`))
        cache.set(sliceHash, solution)
        artifacts.push(scope.child('slices', sliceHash).json('rlgc-per-metre.json', solution))
      }
      C = scale(solution.C, cell.lengthM)
      C0 = scale(solution.C0, cell.lengthM)
      const inverse = solve(solution.C0, solution.C0.map((_, i) => solution.C0.map((__, j) => Number(i === j))))
      L = scale(inverse, mu0 * epsilon0 * cell.lengthM)
      skin = scale(solution.surface, cell.lengthM)
      dielectric = scale(solution.loss, cell.lengthM)
      mesh = solution.steps
      const metal = cell.slice!.conductors
      const groundArea = metal.filter(c => c.group === -1).reduce((s, c) => s + (c.xMax - c.xMin) * (c.zMax - c.zMin) * 1e-6 * c.conductivitySm, 0)
      const groundR = cell.lengthM / groundArea
      R = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => groundR + (i === j ? cell.lengthM / metal.filter(c => c.group === i).reduce((s, c) => s + (c.xMax - c.xMin) * (c.zMax - c.zMin) * 1e-6 * c.conductivitySm, 0) : 0)))
      skinFrequency = max(metal.map(c => 1 / (Math.PI * mu0 * c.conductivitySm * ((c.zMax - c.zMin) / 1000) ** 2)))
    }
    for (const [name, matrix] of Object.entries({ R, L, C, C0 })) validateMatrix(matrix, `${cell.stage} ${name}`, numerics.matrixReciprocity)
    const skinTarget = frequenciesHz.map(f => Math.sqrt(Math.PI * mu0 * f) * (1 - Math.exp(-((f / skinFrequency) ** numerics.skinTransitionExponent))))
    const skinFit = fitLoss(frequenciesHz, skinTarget)
    const dielectricFit = fitLoss(frequenciesHz, frequenciesHz.map(f => 2 * Math.PI * f))
    // Tabulate the causal realization, including its reactive skin/dielectric storage.
    /** Capacitance of the realized dielectric network at this frequency. */
    const capacitanceAt = (frequency: number): Matrix => C.map((row,i)=>row.map((v,j)=>v-dielectric[i][j]*(fittedStorage(dielectricFit,0)-fittedStorage(dielectricFit,frequency))))
    /** Inductance of the realized skin-loss network at this frequency. */
    const inductanceAt = (frequency: number): Matrix => L.map((row,i)=>row.map((v,j)=>v+skin[i][j]*fittedStorage(skinFit,frequency)))
    const spectrum = frequenciesHz.map(f => ({ frequencyHz: f,
      R: R.map((row, i) => row.map((v, j) => v + skin[i][j] * fittedLoss(skinFit, f))),
      L: inductanceAt(f), C: capacitanceAt(f), G: scale(dielectric, fittedLoss(dielectricFit, f)) }))
    // Row norms bound the largest LC eigenvalue. Convexity bounds all Foster frequencies
    // by the DC and infinite-frequency endpoints, including off-diagonal sign changes.
    /** Conservative matrix infinity norm across the two storage endpoints. */
    const rowBound = (matrices: Matrix[]): number => max(matrices.flatMap(matrix=>matrix.map(row=>row.reduce((sum,v)=>sum+Math.abs(v),0))))
    const instantC = C.map((row,i)=>row.map((v,j)=>v-dielectric[i][j]*fittedStorage(dielectricFit,0)))
    const delay = Math.sqrt(rowBound([L,inductanceAt(0)])*rowBound([C,instantC]))
    const result: ExtractedStage = { stage: cell.stage, profile: cell.profile, lengthM: cell.lengthM, ports: cell.ports,
      cells: Math.max(1, Math.ceil(numerics.cellsPerRiseTime * delay / band.riseTimeSeconds)), R, L, C, C0, G: scale(dielectric, fittedLoss(dielectricFit, frequencyHz)),
      units: { R: 'ohm', L: 'H', C: 'F', G: 'S' }, frequencyHz, band, frequenciesHz, spectrum,
      skin: { matrix: skin, fit: skinFit }, dielectric: { matrix: dielectric, fit: dielectricFit }, mesh, sliceHash, geometry: cell }
    matrices.push(result)
    artifacts.push(scope.child(`stage-${cell.stage}`).json('extraction.json', result))
    ctx.progress(`Segment ${cell.stage}: automatic ${result.cells} cells; skin fit ${skinFit.weights.length} branches max ${skinFit.maxRelative} RMS ${skinFit.relativeRms}; dielectric fit ${dielectricFit.weights.length} branches max ${dielectricFit.maxRelative} RMS ${dielectricFit.relativeRms}`)
  }
  const spice = channelSpice(matrices, geometry.mappings.length)
  artifacts.push(scope.text('channel.cir', spice), scope.json('mesh-convergence.json', [...cache].map(([hash, r]) => ({ hash, steps: r.steps }))))
  return { value: { matrices, spice }, artifacts }
}
