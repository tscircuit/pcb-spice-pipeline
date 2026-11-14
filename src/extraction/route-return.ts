import type { Geometry } from '../board'
import { invoke, type SolverContext } from '../solver'
import type { ArtifactScope, Produced } from '../kernel'
import { fastHenryDeck } from './decks'
import { checkNativeRun, impedanceSamples } from './parse'
import { loopImpedance, validateMatrix } from './checks'
import type { ExtractionModeling } from './types'
import type { Matrix } from './linalg'

export interface RouteReturn {
  model: 'closure' | 'series'
  traces: { source: string; start: number[]; end: number[] }[]
  R: Matrix; L: Matrix
  frequencyHz: number; convergence: { R: number; L: number }
  primitive: { R: Matrix; L: Matrix }
  definition: string
}

/** Extract only magnetic/resistive finite-return closure, without a native capacitance solve.
 * Completing the square gives AᵀZA - (Zss-Zsg Zgg⁻¹ Zgs)
 * = Zgg (1-Zsg/Zgg)(1-Zgs/Zgg), separately for real positive R and L.
 * This passive rank-one correction restores the fixed shared-return current constraint.
 * It does not restore the remaining finite signal/end-field difference from the ideal 2D line.
 */
export async function extractRouteReturn(geometry: Geometry, modeling: ExtractionModeling, scope: ArtifactScope, ctx: SolverContext, model: RouteReturn['model'] = 'closure'): Promise<Produced<RouteReturn>> {
  if (geometry.cells.length !== 1 || geometry.mappings.some(mapping => (mapping.sourceTraceIds?.length ?? 1) !== 1)) throw new Error('Hybrid return currently requires one stage and one unbranched physical trace per conductor')
  const cell = geometry.cells[0]
  if (model === 'series' && cell.routedCopper?.signals.some(path => path.segments.some(segment => Math.abs(segment.a[2] - segment.b[2]) > 1e-8))) throw new Error('Hybrid magnetic ablation requires planar signals; via transition deembedding is not implemented')
  const settings = modeling.extraction
  const args = cell.routedCopper ? ['-p', 'seg', 'channel.inp'] : ['channel.inp']
  const coarse = await invoke(ctx, scope.child('coarse'), { solver: 'fasthenry', args, files: { 'channel.inp': fastHenryDeck(cell, settings) }, outputFiles: ['Zc.mat'] })
  checkNativeRun(coarse.value, scope.prefix, 'fasthenry')
  const refined = await invoke(ctx, scope.child('refined'), { solver: 'fasthenry', args, files: { 'channel.inp': fastHenryDeck(cell, { ...settings, minimumHz: settings.modelHz, maximumHz: settings.modelHz, filaments: settings.refinementFilaments, groundMeshMm: settings.groundMeshMm === undefined ? undefined : settings.groundMeshMm / 2 }) }, outputFiles: ['Zc.mat'] })
  checkNativeRun(refined.value, scope.prefix, 'fasthenry')
  const before = impedanceSamples(coarse.value.files['Zc.mat'], cell).find(sample => sample.frequencyHz === settings.modelHz)!
  const samples = impedanceSamples(refined.value.files['Zc.mat'], cell)
  const after = samples[0]
  if (!before || samples.length !== 1 || after.frequencyHz !== settings.modelHz) throw new Error('Hybrid return requires exactly the executed model frequency')
  const convergence = { R: 0, L: 0 }
  const primitive = { R: after.R, L: after.L }
  const correction = { R: [] as Matrix, L: [] as Matrix }
  for (const kind of ['R', 'L'] as const) {
    const a = loopImpedance(before[kind])
    const b = loopImpedance(after[kind])
    convergence[kind] = Math.max(...b.flatMap((row, i) => row.map((value, j) => Math.abs(value - a[i][j])))) / Math.max(...b.flat().map(Math.abs))
    if (!Number.isFinite(convergence[kind]) || convergence[kind] > settings.convergenceTolerance) throw new Error(`Hybrid return ${kind} mesh residual ${convergence[kind]} exceeds ${settings.convergenceTolerance}`)
    const matrix = validateMatrix(after[kind], `${kind} primitive return`, settings.reciprocityTolerance).matrix
    const last = matrix.length - 1
    const common = matrix[last][last]
    const weights = matrix.slice(0, last).map(row => 1 - row[last] / common)
    correction[kind] = model === 'series' ? validateMatrix(b, `${kind} loop return`, settings.reciprocityTolerance).matrix : weights.map(a => weights.map(b => common * a * b))
  }
  const result: RouteReturn = { model, ...correction, primitive, convergence, frequencyHz: after.frequencyHz,
    traces: geometry.mappings.map(mapping => ({ source: mapping.sourceTraceId, start: [mapping.originalRoute[0].x, mapping.originalRoute[0].y], end: [mapping.originalRoute.at(-1)!.x, mapping.originalRoute.at(-1)!.y] })),
    definition: model === 'closure' ? 'Hybrid finite-return closure: positive rank-one R/L completion of the primitive signal/return energy square, added to the 2D ideal-reference energy. Constant-frequency return R/L; ideal die rails remain. The remaining 3D shorted-return signal block is approximated by the 2D field solution. No 3D C or waveform fitting.' : 'Hybrid magnetic ablation: full constant-frequency 3D loop R/L distributed by normalized route-arc overlap, with routed 2D C. Replaces 2D series R/L and skin branches; it is not a pure 2D solve or a return-only correction. No 3D C or waveform fitting.' }
  return { value: result, artifacts: [...coarse.artifacts, ...refined.artifacts, scope.json('return.json', result)] }
}
