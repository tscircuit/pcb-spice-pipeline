import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Circuit } from '@tscircuit/core'
import { GenericSolverDebugger } from '@tscircuit/solver-utils/react'
import { CanvasGraphics } from 'graphics-debug/react'
import { computeTransformFromViewbox, getBounds } from 'graphics-debug'
import { createHttpSolver } from '../src/adapters/browser'
import { RoutedPipelineSolver } from '../src/pipeline'
import type { CircuitJson, StageDrawing } from '../src/board'
import type { IbisSources } from '../src/buffers'

/** Start the camera on the stage's focus (the region its current step works on), else fit everything. */
function RoutedAtlas({ graphics }: { graphics: StageDrawing }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(container.current!)
    return (): void => observer.disconnect()
  }, [])
  const { minX, maxX, minY, maxY } = graphics.focus ?? getBounds(graphics)
  const height = Math.min(620, Math.max(360, Math.ceil(((width - 32) * (maxY - minY)) / Math.max(maxX - minX, 1e-9) + 32)))
  const transform = useMemo(
    () => computeTransformFromViewbox({ minX, maxX, minY, maxY }, width, height, { padding: 16, yFlip: true }),
    [minX, maxX, minY, maxY, width, height],
  )
  return (
    <div ref={container} className="routed-atlas" aria-label="Routed pipeline atlas">
      {width > 0 && (
        <CanvasGraphics key={`${width}:${height}`} graphics={graphics} width={width} height={height} initialTransform={transform} withGrid={false} />
      )}
    </div>
  )
}

/** Move the camera whenever the stage or its focus changes. */
function renderStage(root: RoutedPipelineSolver, number: number): React.JSX.Element {
  const graphics = root.visualizeStage(number)
  return <RoutedAtlas key={`${number}:${JSON.stringify(graphics.focus)}`} graphics={graphics} />
}

export interface BoardPageProps {
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
  const [step, setStep] = useState(0)
  const debuggerElement = useRef<HTMLElement>(null)
  const [ready, setReady] = useState<{ solver: RoutedPipelineSolver; revision: number }>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!ready || !debuggerElement.current) return
    setStep(0)
    let iteration = ready.solver.iterations
    let index = ready.solver.currentPipelineStageIndex
    // solver-utils owns step actions and rerenders their progress; synchronize the input after each advance.
    const observer = new MutationObserver(() => {
      if (iteration === ready.solver.iterations && index === ready.solver.currentPipelineStageIndex) return
      iteration = ready.solver.iterations
      index = ready.solver.currentPipelineStageIndex
      setStep(iteration === 0 ? 0 : Math.min(index + 1, 6))
    })
    observer.observe(debuggerElement.current, { childList: true, subtree: true, characterData: true })
    return (): void => observer.disconnect()
  }, [ready])
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
      {ready && !error && (
        <section
          className="routed-debugger"
          ref={debuggerElement}
          onClick={(event) => {
            const target = event.target as HTMLElement
            if (target.closest('button, summary, a, input')) return
            const row = target.closest('tbody > tr')
            if (!row) return
            const index = Array.from(row.parentElement!.children).indexOf(row)
            if (index >= 0 && index < 6) setStep(index + 1)
          }}
        >
          <label className="step-selector">
            Step:{' '}
            <input
              aria-label="Step"
              type="number"
              min={0}
              max={6}
              step={1}
              value={step}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber
                setStep(Number.isFinite(value) ? Math.min(6, Math.max(0, Math.trunc(value))) : 0)
              }}
            />
          </label>
          <GenericSolverDebugger
            key={ready.revision}
            customRenderer={{
              name: 'Routed stage',
              render: () => renderStage(ready.solver, step),
              getDownload: () => ready.solver.visualizeStage(step),
            }}
            solver={ready.solver as unknown as React.ComponentProps<typeof GenericSolverDebugger>['solver']}
          />
        </section>
      )}
    </>
  )
}
