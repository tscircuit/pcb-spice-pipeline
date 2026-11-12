import React, { useEffect, useRef, useState } from 'react'
import { Circuit } from '@tscircuit/core'
import { createHttpSolver } from '../src/adapters/browser'
import { RoutedPipelineSolver } from '../src/pipeline'
import { Stages } from './stages'
import type { CircuitJson } from '../src/board'
import type { IbisSources } from '../src/buffers'

interface BoardPageProps {
  'board-tree'?: React.ReactElement
  'load-board'?: (sources: IbisSources) => Promise<CircuitJson>
  models: string[]
}

/** Read a fixed local asset via the dev backend; vendor bytes stay outside the repository. */
export async function localAsset(name: string): Promise<string> {
  const response = await fetch(`/api/local-assets/${encodeURIComponent(name)}`)
  const body = (await response.json()) as { text?: string; error?: string }
  if (!response.ok || body.text === undefined) throw new Error(body.error ?? `missing local asset: ${name}`)
  return body.text
}

/** Render the original example TSX with exact local model bytes before mounting the solver. */
async function renderBoard(tree: React.ReactElement, sources: IbisSources): Promise<CircuitJson> {
  const circuit = new Circuit({
    platform: {
      partsEngineDisabled: true,
      platformFetch: async (url) => {
        const path = `models/${String(url).split('/').at(-1)}`
        const bytes = sources[path]
        if (bytes === undefined) throw new Error(`missing local asset: ${path}`)
        return new Response(typeof bytes === 'string' ? bytes : new Uint8Array(bytes).buffer)
      },
    },
  })
  circuit.add(tree)
  await circuit.renderUntilSettled()
  const records = circuit.getCircuitJson() as CircuitJson
  const errors = records.filter((record) => record.type.endsWith('_error'))
  if (errors.length) throw new Error(JSON.stringify(errors))
  return records
}

/** Show a fixture's routed stages using the local ngspice HTTP execution port. */
export function BoardPage({ 'board-tree': boardTree, 'load-board': loadBoard, models }: BoardPageProps): React.JSX.Element {
  const revision = useRef(0)
  const [ready, setReady] = useState<{ solver: RoutedPipelineSolver; revision: number }>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    void fetch('/api/solvers')
      .then(async (response) => {
        if (!response.ok) throw new Error('Local backend unavailable')
        const solvers = (await response.json()) as { ngspice: { available: boolean } }
        if (cancelled) return
        if (!solvers.ngspice.available) setError('ngspice not found on PATH')
      })
      .catch(() => {
        if (!cancelled) setError('Local ngspice backend unavailable')
      })
    return (): void => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setReady(undefined)
    setError(undefined)
    /** Finish IO and TSX rendering before handing immutable inputs to solver-utils. */
    const load = async (): Promise<void> => {
      const assets: IbisSources = {}
      for (const model of models) if (!assets[`models/${model}`]) assets[`models/${model}`] = await localAsset(model)
      const circuitJson = loadBoard ? await loadBoard(assets) : await renderBoard(boardTree!, assets)
      if (cancelled) return
      const runSolver = createHttpSolver({ signal: controller.signal })
      for (const record of circuitJson)
        if (record.type === 'simulation_ibis_model') {
          const path = record.ibis_model_asset.project_relative_path
          assets[path] ??= assets[`models/${path.split('/').at(-1)}`]
        }
      setReady({
        solver: new RoutedPipelineSolver({ circuitJson, ibisSources: assets, scopeDistanceMm: 1 }, { runSolver, progress: (): void => undefined }),
        revision: ++revision.current,
      })
    }
    void load().catch((cause: unknown) => {
      if (!cancelled) setError((cause as Error).message)
    })
    return (): void => {
      cancelled = true
      controller.abort()
    }
  }, [boardTree, loadBoard, models])
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {ready && !error && <Stages key={ready.revision} solver={ready.solver} />}
    </>
  )
}
