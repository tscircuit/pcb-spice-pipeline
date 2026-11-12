import { BaseSolver, BasePipelineSolver, definePipelineStep } from '@tscircuit/solver-utils'
import type { PipelineStep } from '@tscircuit/solver-utils'
import type { SolverContext } from '../solver'
import type { GraphicsObject } from 'graphics-debug'
import { RouteSectionsSolver, routeBoardDrawing, routeText } from '../board'
import { RouteFieldsSolver } from '../extraction'
import { RouteBindingsSolver, RouteNetworkSolver, RouteTransientSolver, type RoutedDeck, type RoutedCapture } from '../simulation'
import { ArtifactLedger, rootScope, snapshot, type Produced, type FileMap } from '../kernel'
import { RoutedAdmissionSolver, type RoutedProblem, type RoutedBlockPlan } from './routed-admission'

/** Typed read boundary for solver-utils' dynamic slots; incomplete/wrong stages never escape. */
function completed<I, S extends BaseSolver>(pipeline: BasePipelineSolver<unknown>, solverClass: new (input: I) => S): ReturnType<S['getOutput']> {
  const stage = pipeline.pipelineDef.find(stage => stage.solverClass === solverClass)
  const solver = stage && pipeline.getSolver<S>(stage.solverName)
  if (!(solver instanceof solverClass) || !solver.solved) throw new Error(`Incomplete stage ${solverClass.name}`)
  return solver.getOutput()
}

/** The single ordered stage tuple, walked by nested pipelines, tests and documentation. */
export const routedStages = [
  definePipelineStep('RoutedAdmissionSolver', RoutedAdmissionSolver, (p: RoutedPipelineSolver) => [p.inputProblem], {
    onSolved: (p: RoutedPipelineSolver): void => {
      for (const plan of completed(p, RoutedAdmissionSolver).value) p.pipelineDef.push(definePipelineStep(`block:${plan.id}`, RoutedBlockSolver, () => [{ ...plan, context: p.context }]))
    },
  }),
  definePipelineStep('RouteSectionsSolver', RouteSectionsSolver, (p: RoutedBlockSolver) => [p.inputProblem.sections]),
  definePipelineStep('RouteFieldsSolver', RouteFieldsSolver, (p: RoutedBlockSolver) => [{ geometry: completed(p, RouteSectionsSolver).value.geometry, circuitJson: p.inputProblem.sections.circuitJson, scope: completed(p, RouteSectionsSolver).value.scope, maskThicknessMm: completed(p, RouteSectionsSolver).value.maskThicknessMm, materials: p.inputProblem.bindings.options.materials, artifactPrefix: p.inputProblem.sections.artifactPrefix }]),
  definePipelineStep('RouteBindingsSolver', RouteBindingsSolver, (p: RoutedBlockSolver) => [{ ...p.inputProblem.bindings, scope: completed(p, RouteSectionsSolver).value.scope }]),
  definePipelineStep('RouteNetworkSolver', RouteNetworkSolver, (p: RoutedBlockSolver) => [{ blockId: p.inputProblem.id, name: p.inputProblem.name, geometry: completed(p, RouteSectionsSolver).value.geometry, extracted: completed(p, RouteFieldsSolver).value, bindings: completed(p, RouteBindingsSolver).value, materials: completed(p, RouteFieldsSolver).value.materials, options: p.inputProblem.bindings.options, warnings: p.inputProblem.warnings, artifactPrefix: p.inputProblem.sections.artifactPrefix }]),
  definePipelineStep('RouteTransientSolver', RouteTransientSolver, (p: RoutedBlockSolver) => [{ compiled: completed(p, RouteNetworkSolver).value, artifactPrefix: p.inputProblem.sections.artifactPrefix, context: p.inputProblem.context }]),
] as const satisfies readonly PipelineStep<BaseSolver>[]

export interface RoutedBlockView {
  id: string
  name: string
  compiled: RoutedDeck
  capture: RoutedCapture
}
export interface RoutedInspection {
  kind: 'routed-inspection'
  blocks: RoutedBlockView[]
  files: FileMap
}

/** Per-block nested pipeline; immutable values are handed directly between domain stages. */
export class RoutedBlockSolver extends BasePipelineSolver<RoutedBlockPlan & { context: SolverContext }> {
  override pipelineDef: PipelineStep<BaseSolver>[] = routedStages.slice(1)
  /** Keep the execution port outside the immutable domain plan. */
  constructor(input: RoutedBlockPlan & { context: SolverContext }) { super(input) }
  /** Completion aggregates stage artifacts; only the root owns a ledger. */
  override getOutput(): Produced<RoutedBlockView> {
    if (!this.solved) throw new Error('Routed block is incomplete')
    return { value: snapshot({ id: this.inputProblem.id, name: this.inputProblem.name, compiled: completed(this, RouteNetworkSolver).value, capture: completed(this, RouteTransientSolver).value }), artifacts: this.pipelineDef.flatMap(stage => this.getStageOutput<Produced<unknown>>(stage.solverName)!.artifacts) }
  }
  /** Completed atlas uses one board view plus fields and capture, preserving foreground polygons. */
  override visualize(): GraphicsObject {
    if (!this.solved) return super.visualize()
    const drawings = [RouteNetworkSolver.name, RouteFieldsSolver.name, RouteCaptureSolver.name].map(name => this.getSolver(name)!.visualize())
    return {
      coordinateSystem: 'cartesian',
      lines: drawings.flatMap(drawing => drawing.lines ?? []),
      rects: drawings.flatMap(drawing => drawing.rects ?? []),
      circles: drawings.flatMap(drawing => drawing.circles ?? []),
      points: drawings.flatMap(drawing => drawing.points ?? []),
      polygons: drawings.flatMap(drawing => drawing.polygons ?? []),
      texts: drawings.flatMap(drawing => drawing.texts ?? []),
    }
  }
  /** Original admitted block input. */
  override getConstructorParams(): [RoutedBlockPlan & { context: SolverContext }] { return [this.inputProblem] }
}

/** Browser-safe stages followed by one awaited live transient per block. */
export class RoutedPipelineSolver extends BasePipelineSolver<RoutedProblem> {
  override pipelineDef: PipelineStep<BaseSolver>[] = [routedStages[0]]
  private output?: RoutedInspection
  /** Normalize exact UTF-8 assets for constructor downloads, without decoding lossy bytes. */
  constructor(input: RoutedProblem, readonly context: SolverContext) {
    const ibisSources = Object.fromEntries(Object.entries(input.ibisSources).map(([name, bytes]) => [name, typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)]))
    super(snapshot({ ...input, ibisSources }))
  }
  /** The sole artifact fold, performed once after all nested pipelines complete. */
  override getOutput(): RoutedInspection {
    if (!this.solved) throw new Error('Routed pipeline is incomplete')
    if (this.output) return this.output
    let ledger = ArtifactLedger.empty()
    const blocks: RoutedBlockView[] = []
    for (const stage of this.pipelineDef) {
      const output = this.getStageOutput<Produced<unknown>>(stage.solverName)!
      ledger = ledger.add(output.artifacts)
      const solver = this.getSolver(stage.solverName)
      if (solver instanceof RoutedBlockSolver) blocks.push(solver.getOutput().value)
    }
    ledger = ledger.add([rootScope('pipeline').json('stages.json', routedStages.map(stage => stage.solverName))])
    this.output = snapshot({ kind: 'routed-inspection', blocks, files: ledger.seal() })
    return this.output
  }
  /** Exact source input and injected execution context, without solver state. */
  override getConstructorParams(): [RoutedProblem, SolverContext] { return [this.inputProblem, this.context] }
  /** Physical board context before any work has run. */
  override initialVisualize(): GraphicsObject { return routeBoardDrawing(this.inputProblem.circuitJson, undefined, 'Routed 2.5D compiler') }
  /** Keep the completed debugger atlas free of overlapping admission/section/binding labels. */
  override visualize(): GraphicsObject { return this.solved ? this.finalVisualize() : super.visualize() }
  /** Compilation completion never implies native completion. */
  override finalVisualize(): GraphicsObject {
    const block = this.pipelineDef.map(stage => this.getSolver(stage.solverName)).findLast(solver => solver instanceof RoutedBlockSolver && solver.solved)
    if (block) return block.visualize()
    const drawing = routeBoardDrawing(this.inputProblem.circuitJson, undefined, 'Routed 2.5D · compilation complete')
    routeText(drawing, 2, 87, 'Sections → fields → bindings → network; native not run', '#a16207', 1.9)
    return drawing
  }
}
