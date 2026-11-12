import { BaseSolver, BasePipelineSolver, definePipelineStep } from '@tscircuit/solver-utils'
import type { PipelineStep } from '@tscircuit/solver-utils'
import type { SolverContext } from '../solver'
import { getBounds } from 'graphics-debug'
import { RouteSectionsSolver, routeBoardDrawing, routeText, routeTextSize, routeTitle, type RoutedSections, type StageDrawing } from '../board'
import { RouteFieldsSolver, type ExtractedRoutes } from '../extraction'
import {
  RouteBindingsSolver,
  RouteNetworkSolver,
  RouteTransientSolver,
  routeReceiverLimits,
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
      limits: routeReceiverLimits(
        p.inputProblem.ibisSources,
        p.stageOutput('RouteBindingsSolver').value[i].models,
        p.stageOutput('RouteBindingsSolver').value[i].plan.states.filter((state) => state.is_output).map((state) => state.source_port_id),
      ),
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
  visualizeStage(number: number): StageDrawing {
    if (number === 0) return this.initialVisualize()
    const definition = this.pipelineDef[number - 1]
    let solver = this.getSolver(definition.solverName)
    if (!solver && number - 1 <= this.currentPipelineStageIndex) {
      solver = new definition.solverClass(...definition.getConstructorParams(this))
    }
    const plans = this.getStageOutput<Produced<RoutedBlockPlan[]>>('RoutedAdmissionSolver')?.value
    const title = `${number} · ${definition.solverName.replace(/^Routed?|Solver$/g, '')}`
    if (number > 1 && plans?.length === 0)
      return routeTitle(routeBoardDrawing(this.inputProblem.circuitJson, undefined), title, [{ text: 'No signal-integrity blocks admitted', color: '#64748b' }])
    const drawing: StageDrawing = solver?.visualize() ?? routeTitle(routeBoardDrawing(this.inputProblem.circuitJson, plans?.[0]?.sections.scope), title)
    if (!solver || solver.iterations === 0) {
      const focus = drawing.focus ?? getBounds(drawing)
      const size = routeTextSize(focus).body
      routeText(drawing, focus.minX + size, focus.minY + size, 'Not run yet', '#64748b', size)
    }
    return drawing
  }
  /** Stage boundaries show the incoming input immediately, before its first step. */
  override visualize(): StageDrawing {
    return this.visualizeStage(this.iterations === 0 ? 0 : Math.min(this.currentPipelineStageIndex + 1, this.pipelineDef.length))
  }
  /** Show admission's initial physical board before any stage has run. */
  override initialVisualize(): StageDrawing {
    return routeTitle(routeBoardDrawing(this.inputProblem.circuitJson, undefined), '0 · Board')
  }
  /** A completed pipeline follows the final transient; earlier stages keep their own drawings. */
  override finalVisualize(): StageDrawing {
    return this.getSolver('RouteTransientSolver')?.visualize() ?? this.initialVisualize()
  }
}
