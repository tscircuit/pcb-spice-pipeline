import React, { useEffect, useRef, useState } from 'react'
import { Circuit } from '@tscircuit/core'
import { GenericSolverDebugger } from '@tscircuit/solver-utils/react'
import { InteractiveGraphics } from 'graphics-debug/react'
import { createHttpSolver } from '../src/adapters/browser'
import { RoutedPipelineSolver } from '../src/pipeline'
import type { CircuitJson } from '../src/board'
import type { IbisSources } from '../src/buffers'

type DebuggerSolver = NonNullable<React.ComponentProps<typeof GenericSolverDebugger>['solver']>

// graphics-debug keeps its initial camera when graphics change. Fit again at
// stage boundaries so the later cross-section and waveform panels stay visible.
const renderer = {
  name: 'Routed atlas',
  /** Preserve pan/zoom within a stage, then fit the next stage's actual drawing. */
  render(solver: DebuggerSolver): React.JSX.Element {
    let stage = solver
    while (stage.activeSubSolver) stage = stage.activeSubSolver
    return <InteractiveGraphics key={`${stage.getSolverName()}:${stage.solved}`} graphics={solver.visualize()} />
  },
  /** Download the same graphics shown in the debugger. */
  getDownload(solver: DebuggerSolver): ReturnType<DebuggerSolver['visualize']> {
    return solver.visualize()
  },
}

export interface BoardPageProps {
  title: string
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
export function BoardPage({
  title,
  'board-tree': boardTree,
  'load-board': loadBoard,
  models,
}: BoardPageProps): React.JSX.Element {
  const revision = useRef(0)
  const [backend, setBackend] = useState('Checking local ngspice…')
  const [native, setNative] = useState<boolean>()
  const [sources, setSources] = useState<IbisSources>({})
  const [ready, setReady] = useState<{ solver: RoutedPipelineSolver; revision: number }>()
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState('Ready to step through the pipeline')
  useEffect(() => {
    let cancelled = false
    void fetch('/api/solvers')
      .then(async (response) => {
        if (!response.ok) throw new Error('Local backend unavailable')
        const solvers = (await response.json()) as { ngspice: { available: boolean; version?: string } }
        if (cancelled) return
        setNative(solvers.ngspice.available)
        setBackend(
          solvers.ngspice.available ? `Local backend · ${solvers.ngspice.version}` : 'ngspice not found on PATH',
        )
      })
      .catch(() => {
        if (!cancelled) setBackend('Local backend unavailable; start bun dev')
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
    setProgress('Loading local assets and rendering board…')
    /** Finish IO and TSX rendering before handing immutable inputs to solver-utils. */
    const load = async (): Promise<void> => {
      const assets: IbisSources = { ...sources }
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
        solver: new RoutedPipelineSolver(
          { circuitJson, ibisSources: assets, scopeDistanceMm: 1 },
          { runSolver, progress: setProgress },
        ),
        revision: ++revision.current,
      })
      setProgress(`Ready · ${circuitJson.length} Circuit JSON records · local ngspice`)
    }
    void load().catch((cause: unknown) => {
      if (!cancelled) setError((cause as Error).message)
    })
    return (): void => {
      cancelled = true
      controller.abort()
    }
  }, [boardTree, loadBoard, models, sources])
  return (
    <>
      <header>
        <h1>{title}</h1>
        <p>Inspect the routed SI pipeline stage by stage. Stage 5 runs a live ngspice transient.</p>
      </header>
      <section className="controls">
        <span role={native === false ? 'alert' : undefined}>{backend}</span>
        <details>
          <summary>Local IBIS upload</summary>
          <label>
            Override model files{' '}
            <input
              type="file"
              multiple
              accept=".ibs"
              onChange={(event) => {
                void Promise.all(
                  Array.from(event.target.files ?? []).map(async (file) => [`models/${file.name}`, await file.text()]),
                )
                  .then((entries) => setSources((previous) => ({ ...previous, ...Object.fromEntries(entries) })))
                  .catch((cause) => setError(String(cause)))
              }}
            />
          </label>
        </details>
      </section>
      {error ? <p role="alert">{error}</p> : <p role="status">{progress}</p>}
      {ready && (
        <GenericSolverDebugger
          key={ready.revision}
          customRenderer={renderer}
          solver={ready.solver as unknown as React.ComponentProps<typeof GenericSolverDebugger>['solver']}
        />
      )}
    </>
  )
}
