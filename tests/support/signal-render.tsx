import React from 'react'
import type { CircuitJson } from '../../src/board'
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
