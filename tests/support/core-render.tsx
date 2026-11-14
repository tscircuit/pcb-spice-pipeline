import React from 'react'
import { readFile } from 'node:fs/promises'
import type { Circuit } from '@tscircuit/core'
import type { CircuitJson } from '../../src/board'

/** Render unchanged TSX through core, preserving partial records when core rejects it. No schema or copper adapter. */
export async function renderCoreSignals(tree: React.ReactElement): Promise<CircuitJson> {
  const { Circuit: Core } = await import(process.env.SI_CORE_MODULE ?? '@tscircuit/core') as { Circuit: typeof Circuit }
  const circuit = new Core({ platform: { partsEngineDisabled: true, platformFetch: async url =>
    new Response(await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/${String(url).split('/').at(-1)}`)) } })
  try {
    circuit.add(tree)
    await circuit.renderUntilSettled()
    const records = circuit.getCircuitJson()
    const errors = records.filter(record => record.type.endsWith('_error'))
    if (errors.length) throw new Error(JSON.stringify(errors))
    return records
  } catch (error) {
    throw Object.assign(error as Error, { circuitJson: circuit.db.toArray() })
  }
}
