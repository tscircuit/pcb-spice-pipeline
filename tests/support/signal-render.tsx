import React from 'react'
import type { CircuitJson } from '../../src/board'
import type { IbisSources } from '../../src/buffers'
import { RoutedPipelineSolver } from '../../src/pipeline'
import { prepareBlockById, signalBlocks, type PreparedBlock } from '../../src/pipeline/signals'
import type { RouteBindingsInput } from '../../src/simulation'
import { renderCoreSignals } from './core-render'

/** Render through real core, permitting only specifically expected physical diagnostics. */
export async function renderSignals(tree: React.ReactElement, expectedErrors: string[] = []): Promise<CircuitJson> {
  try {
    return await renderCoreSignals(tree) }
  catch (error) {
    const records = (error as { circuitJson?: CircuitJson }).circuitJson
    const errors = records?.filter(record => record.type.endsWith('_error')) ?? []
    if (records?.some(record => record.type === 'simulation_signal') && errors.length && errors.every(record => expectedErrors.includes(record.type))) return records
    throw error
  }
}

/** Lower every signal-integrity block in board order, as RoutedAdmissionSolver does one block per step. */
export function prepareBlocks(circuit: CircuitJson, sources: IbisSources, distanceMm?: number): PreparedBlock[] {
  return signalBlocks(circuit).map(block => prepareBlockById(circuit, sources, block.simulation_signal_integrity_id, distanceMm))
}

/** The first admitted block's bindings, admitted through the public root so IBIS bytes are decoded as in production. */
export function admittedBindings(circuitJson: CircuitJson, ibisSources: IbisSources): Omit<RouteBindingsInput, 'scope'> {
  const root = new RoutedPipelineSolver({ circuitJson, ibisSources }, { runSolver: async () => {
    throw new Error('admission needs no native solver')
  }, progress: () => undefined })
  root.solveUntilStage('RouteSectionsSolver')
  return root.stageOutput('RoutedAdmissionSolver').value[0].bindings
}
