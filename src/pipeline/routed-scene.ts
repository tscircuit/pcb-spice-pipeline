import type { RoutedPipelineSolver } from './routed-pipeline'
import { boardCameraShot, boardRouteSegments, stackupFromCircuitJson, type CircuitJson, type RoutedSections, type CopperScope } from '../board'
import type { ExtractedRoutes } from '../extraction'
import type { RoutedBindings, RoutedCapture, RoutedDeck } from '../simulation'

export interface RoutedSceneState {
  circuitJson: CircuitJson
  camera: ReturnType<typeof boardCameraShot>
  routes: ReturnType<typeof boardRouteSegments>
  scopes: CopperScope[]
  sections: RoutedSections[]
  fields: ExtractedRoutes[]
  bindings: RoutedBindings[]
  networks: RoutedDeck[]
  captures: RoutedCapture[]
}

/** Read completed immutable outputs only, gated by the same selected Step as the 3D scene. */
export function routedScene(root: RoutedPipelineSolver, step: number): RoutedSceneState {
  /** A completed stage always owns its output; pending stages expose none. */
  const read = <K extends Parameters<RoutedPipelineSolver['stageOutput']>[0]>(
    name: K,
  ): ReturnType<RoutedPipelineSolver['stageOutput']>['value'] =>
    root.getSolver(name)?.solved ? (root.getSolver(name)!.getOutput() as ReturnType<RoutedPipelineSolver['stageOutput']>).value : []
  const plans = step >= 1 ? (read('RoutedAdmissionSolver') as ReturnType<RoutedPipelineSolver['stageOutput']>['value']) : []
  const circuitJson = root.inputProblem.circuitJson
  const stack = stackupFromCircuitJson(circuitJson)
  return {
    circuitJson,
    routes: boardRouteSegments(circuitJson, stack),
    camera: boardCameraShot(circuitJson, stack, { stage: step }),
    scopes: (plans as { sections: { scope: CopperScope } }[]).map((plan) => plan.sections.scope),
    sections: step >= 2 ? (read('RouteSectionsSolver') as RoutedSections[]) : [],
    fields: step >= 3 ? (read('RouteFieldsSolver') as ExtractedRoutes[]) : [],
    bindings: step >= 4 ? (read('RouteBindingsSolver') as RoutedBindings[]) : [],
    networks: step >= 5 ? (read('RouteNetworkSolver') as RoutedDeck[]) : [],
    captures: step >= 6 ? (read('RouteTransientSolver') as RoutedSceneState['captures']) : [],
  }
}

