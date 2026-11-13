import { BaseSolver, BasePipelineSolver, definePipelineStep } from '@tscircuit/solver-utils'
import type { PipelineStep } from '@tscircuit/solver-utils'
import type { SolverContext } from '../solver'
import type { GraphicsObject } from 'graphics-debug'
import { RouteSectionsSolver, routeBoardBox, routeBoardDrawing, routeText, routeTones, type RoutedSections } from '../board'
import { RouteFieldsSolver, type ExtractedRoutes } from '../extraction'
import {
  RouteBindingsSolver,
  RouteNetworkSolver,
  RouteTransientSolver,
  receiverThreshold,
  type RoutedDeck,
  type RoutedCapture,
  type RoutedBindings,
} from '../simulation'
import { ArtifactLedger, rootScope, snapshot, type FileMap, type Produced } from '../kernel'
import { RoutedAdmissionSolver, type RoutedProblem, type RoutedBlockPlan } from './routed-admission'
import { routedStage } from './routed-stage'

/** All six rows exist before the first step; every stage drains all admitted blocks in order. */
export const routedStages = [
  definePipelineStep('RoutedAdmissionSolver', RoutedAdmissionSolver, (p: RoutedPipelineSolver) => [p.inputProblem]),
  definePipelineStep('RouteSectionsSolver', routedStage(RouteSectionsSolver), (p: RoutedPipelineSolver) => [
    p.stageOutput('RoutedAdmissionSolver').value.map((plan) => plan.sections),
  ]),
  definePipelineStep('RouteFieldsSolver', routedStage(RouteFieldsSolver), (p: RoutedPipelineSolver) => [
    p.stageOutput('RouteSectionsSolver').value.map((sections, i) => ({
      geometry: sections.geometry,
      circuitJson: sections.circuitJson,
      scope: sections.scope,
      maskThicknessMm: sections.maskThicknessMm,
      materials: p.stageOutput('RoutedAdmissionSolver').value[i].bindings.options.materials,
      artifactPrefix: p.stageOutput('RoutedAdmissionSolver').value[i].sections.artifactPrefix,
    })),
  ]),
  definePipelineStep('RouteBindingsSolver', routedStage(RouteBindingsSolver), (p: RoutedPipelineSolver) => [
    p.stageOutput('RoutedAdmissionSolver').value.map((plan, i) => ({ ...plan.bindings, scope: p.stageOutput('RouteSectionsSolver').value[i].scope })),
  ]),
  definePipelineStep('RouteNetworkSolver', routedStage(RouteNetworkSolver), (p: RoutedPipelineSolver) => [
    p.stageOutput('RoutedAdmissionSolver').value.map((plan, i) => ({
      blockId: plan.id,
      name: plan.name,
      geometry: p.stageOutput('RouteSectionsSolver').value[i].geometry,
      extracted: p.stageOutput('RouteFieldsSolver').value[i],
      bindings: p.stageOutput('RouteBindingsSolver').value[i],
      materials: p.stageOutput('RouteFieldsSolver').value[i].materials,
      options: plan.bindings.options,
      warnings: plan.warnings,
      artifactPrefix: plan.sections.artifactPrefix,
    })),
  ]),
  definePipelineStep('RouteTransientSolver', routedStage(RouteTransientSolver), (p: RoutedPipelineSolver) => [
    p.stageOutput('RouteNetworkSolver').value.map((compiled, i) => ({
      compiled,
      board: p.stageOutput('RouteSectionsSolver').value[i],
      artifactPrefix: p.stageOutput('RoutedAdmissionSolver').value[i].sections.artifactPrefix,
      context: p.context,
      threshold: receiverThreshold(p.inputProblem.ibisSources, p.stageOutput('RouteBindingsSolver').value[i].models, new Set(p.stageOutput('RouteBindingsSolver').value[i].mappings.map(mapping => mapping.to))),
    })),
  ]),
] as const satisfies readonly PipelineStep<BaseSolver>[]

interface RoutedStageOutputs {
  RoutedAdmissionSolver: Produced<RoutedBlockPlan[]>
  RouteSectionsSolver: Produced<RoutedSections[]>
  RouteFieldsSolver: Produced<ExtractedRoutes[]>
  RouteBindingsSolver: Produced<RoutedBindings[]>
  RouteNetworkSolver: Produced<RoutedDeck[]>
  RouteTransientSolver: Produced<RoutedCapture[]>
}

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

/** A single static pipeline, from admission through sequential live transients. */
export class RoutedPipelineSolver extends BasePipelineSolver<RoutedProblem> {
  override pipelineDef: PipelineStep<BaseSolver>[] = [...routedStages]
  private output?: RoutedInspection
  /** Preserve exact model bytes while keeping runtime capabilities outside immutable input. */
  constructor(
    input: RoutedProblem,
    readonly context: SolverContext,
  ) {
    const ibisSources = Object.fromEntries(
      Object.entries(input.ibisSources).map(([name, bytes]) => [
        name,
        typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      ]),
    )
    super(snapshot({ ...input, ibisSources }))
  }
  /** Each completed row exposes its domain array in admission order. */
  stageOutput<K extends keyof RoutedStageOutputs>(name: K): RoutedStageOutputs[K] {
    const output = this.getStageOutput<RoutedStageOutputs[K]>(name)
    if (!output) throw new Error(`Incomplete stage ${name}`)
    return output
  }
  /** Fold each flat stage's artifacts once, preserving per-block values and paths. */
  override getOutput(): RoutedInspection {
    if (!this.solved) throw new Error('Routed pipeline is incomplete')
    if (this.output) return this.output
    let ledger = ArtifactLedger.empty()
    for (const stage of this.pipelineDef) ledger = ledger.add(this.getStageOutput<Produced<unknown>>(stage.solverName)!.artifacts)
    const plans = this.stageOutput('RoutedAdmissionSolver').value
    const compiled = this.stageOutput('RouteNetworkSolver').value
    const captures = this.stageOutput('RouteTransientSolver').value
    const blocks = plans.map((plan, i) => ({ id: plan.id, name: plan.name, compiled: compiled[i], capture: captures[i] }))
    ledger = ledger.add([
      rootScope('pipeline').json(
        'stages.json',
        routedStages.map((stage) => stage.solverName),
      ),
    ])
    this.output = snapshot({ kind: 'routed-inspection', blocks, files: ledger.seal() })
    return this.output
  }
  /** Exact source inputs plus the injected execution capability. */
  override getConstructorParams(): [RoutedProblem, SolverContext] {
    return [this.inputProblem, this.context]
  }
  /** Inspect retained output or the incoming stage's immutable input, without executing work. */
  visualizeStage(number: number): GraphicsObject {
    if (number === 0) return this.initialVisualize()
    const definition = this.pipelineDef[number - 1]
    let solver = this.getSolver(definition.solverName)
    if (!solver && number - 1 <= this.currentPipelineStageIndex) {
      solver = new definition.solverClass(...definition.getConstructorParams(this))
    }
    const plans = this.getStageOutput<Produced<RoutedBlockPlan[]>>('RoutedAdmissionSolver')?.value
    const circuit = this.inputProblem.circuitJson
    if (plans && !plans.length) {
      // Nothing was admitted: the whole board with one quiet line, the same in every stage.
      const drawing = routeBoardDrawing(circuit, undefined)
      const board = routeBoardBox(circuit)
      routeText(drawing, (board.minX + board.maxX) / 2, (board.minY + board.maxY) / 2, 'No signal-integrity blocks admitted', routeTones.quiet, (board.maxX - board.minX) / 40)
      return drawing
    }
    // A stage that cannot be built yet shows the selected copper in neutral grey.
    return solver?.visualize() ?? routeBoardDrawing(circuit, plans?.[0]?.sections.scope, () => routeTones.copper)
  }
  /** Stage boundaries show the incoming input immediately, before its first step. */
  override visualize(): GraphicsObject {
    return this.visualizeStage(this.iterations === 0 ? 0 : Math.min(this.currentPipelineStageIndex + 1, this.pipelineDef.length))
  }
  /** Before any stage has run there is nothing to overlay, so the whole board shows. */
  override initialVisualize(): GraphicsObject {
    return routeBoardDrawing(this.inputProblem.circuitJson, undefined)
  }
  /** A completed pipeline follows the final transient; earlier stages keep their own drawings. */
  override finalVisualize(): GraphicsObject {
    return this.getSolver('RouteTransientSolver')?.visualize() ?? this.initialVisualize()
  }
}
