// Canned native answers for extraction tests (not a substitute solver: they echo the geometry's own analytic R).
import type { RunSolver, SolverRequest } from '../../src/solver'
import type { Geometry, GeometryCell, Modeling } from '../../src/board'

/** Perturbations: R scale per run (0 coarse, 1 refined), DC mutual R, omit port rows, coarse frequencies. */
export interface Tweak { rScale?: [number, number]; lowMutualR?: number; noRows?: boolean; coarseHz?: number[] }

/** A canned solver whose answers pass every check for the geometry it is given (R = analytic DC R). */
export function consistentSolver(geometry: Geometry, modeling: Modeling, tweak: Tweak = {}): RunSolver {
  let call = 0
  return async (request: SolverRequest) => {
    const cell = geometry.cells[Math.floor(call / 3)]
    const phase = call++ % 3
    const n = cell.conductors.length
    const routed = !!cell.routedCopper
    if (request.solver === 'fastercap') {
      const unit = routed ? 1e-9 : 1e-12
      return { stdout: `Capacitance matrix is:\nDimension ${n} x ${n}\n` + cell.conductors.map((c, i) => `g_${c.name} ` + cell.conductors.map((_, j) => (i === j ? 4 : -1) * unit).join(' ')).join('\n') +
        '\n\nWeighted Frobenius norm of the difference between capacitance (auto option): 0.001\n', stderr: '', files: {} as Record<string, string> }
    }
    const r = analytic(cell).map(v => v * (tweak.rScale?.[phase] ?? 1))
    const frequencies = phase === 0 ? (tweak.coarseHz ?? [modeling.extraction.minimumHz, modeling.extraction.modelHz]) : [modeling.extraction.modelHz]
    const rows = tweak.noRows ? '' : cell.conductors.map((_, i) => `Row ${i + 1}: N${i}a to N${i}b`).join('\n')
    /** One Zc.mat frequency block: analytic R on the diagonal, fixed L, and the optional DC mutual R tweak. */
    const block = (f: number): string => `Impedance matrix for frequency = ${f} ${n} x ${n}\n` + cell.conductors.map((_, i) => cell.conductors.map((_, j) =>
      i === j ? `${r[i] ?? .01} ${2 * Math.PI * f * 1e-9 * (i + 2)}j` : `${f === modeling.extraction.minimumHz ? tweak.lowMutualR ?? 0 : 0} ${2 * Math.PI * f * 1e-10}j`).join(' ')).join('\n') + '\n'
    return { stdout: 'ok\n', stderr: '', files: { 'Zc.mat': rows + '\n' + frequencies.map(block).join('') } }
  }
}
/** The geometry's own l/(sigma*w*t) DC resistance per conductor, which extraction's DC check compares against. */
export function analytic(cell: GeometryCell): number[] {
  return cell.routedCopper ? cell.routedCopper.signals.map(p => p.segments.reduce((s, g) => s + Math.hypot(...g.a.map((v, i) => v - g.b[i])) * 1000 / ((g.conductivitySm ?? cell.conductivitySm) * g.widthMm * g.thicknessMm), 0))
    : cell.conductors.map(c => c.lengthM / ((c.conductivitySm ?? cell.conductivitySm) * (c.parts ?? [c]).reduce((a, p) => a + p.widthM * p.thicknessM, 0)))
}

/** Three explicitly dimensioned bars for solver/deck algebra unit tests, independent of the removed geometry API. */
export function barFixture(): { geometry: Geometry; modeling: Modeling } {
  const geometry: Geometry = { mappings: [], cells: [{ stage: 0, profile: 'parallel-routed-copper', relativePermittivity: 4, conductivitySm: 5.8e7,
    conductors: [0, 1, 2].map(i => ({ name: i === 2 ? 'return' : `sig${i}`, lengthM: .01, widthM: .0002, thicknessM: .000035, yM: i * .001, zM: 0 })) }],
    units: { circuitJson: 'mm', geometry: 'm', conductivity: 'S/m' }, approximations: [] }
  // Mappings are relevant only to the generated channel's dimension; no circuit is read by extraction.
  geometry.mappings = [0, 1].map(i => ({ port: `D${i}`, from: `p${i}`, to: `r${i}`, sourceTraceId: `s${i}`, pcbTraceId: `t${i}`, pcbPorts: [], stages: [], originalRoute: [] }))
  const modeling: Modeling = { reduction: 'routed-copper', sections: 2, lanes: [], relativePermittivity: 4,
    extraction: { minimumHz: 1, maximumHz: 1e9, modelHz: 1e8, filaments: 3, refinementFilaments: 7, convergenceTolerance: .05, capTolerance: .02,
      reciprocityTolerance: .025, dcResistanceTolerance: .002, maxPanelLengthMm: .5, groundMeshMm: .5 } }
  return { geometry, modeling }
}
