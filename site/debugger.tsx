import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Circuit } from '@tscircuit/core'
import { GenericSolverDebugger } from '@tscircuit/solver-utils/react'
import { CanvasGraphics } from 'graphics-debug/react'
import { computeTransformFromViewbox, getBounds, type GraphicsObject } from 'graphics-debug'
import { createHttpSolver } from '../src/adapters/browser'
import { RoutedPipelineSolver } from '../src/pipeline'
import { routeText, routeTextSize, type CircuitJson } from '../src/board'
import type { IbisSources } from '../src/buffers'

/** Fit the measured container and scale world-unit text exactly as in SVG exports. */
function RoutedAtlas({ graphics }: { graphics: GraphicsObject }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(container.current!)
    return (): void => observer.disconnect()
  }, [])
  const { minX, maxX, minY, maxY } = getBounds(graphics)
  const height = Math.min(620, Math.ceil(((width - 32) * (maxY - minY)) / Math.max(maxX - minX, 1) + 32))
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

/** An empty selector follows the active stage; row numbers and panel titles both start at one. */
function stageNumber(root: RoutedPipelineSolver, selected: number | undefined): number {
  return selected ?? Math.min(root.currentPipelineStageIndex + 1, root.pipelineDef.length)
}

/** Read retained stage state without running it or mutating completed solver inputs. */
function stageDrawing(root: RoutedPipelineSolver, selected: number | undefined): GraphicsObject {
  const number = stageNumber(root, selected)
  const definition = root.pipelineDef[number - 1]
  const solver = root.getSolver(definition.solverName)
  if (solver && solver.iterations > 0) return solver.visualize()
  const drawing: GraphicsObject = number === 1 ? root.initialVisualize() : { coordinateSystem: 'cartesian', texts: [] }
  if (!drawing.texts?.length) routeText(drawing, 2, 98, `${number} · ${definition.solverName}`, '#0f172a', routeTextSize.title)
  routeText(drawing, 2, 81, 'Not run yet', '#64748b')
  return drawing
}

/** Fit again when selecting a different stage or completing its solve. */
function renderStage(root: RoutedPipelineSolver, selected: number | undefined): React.JSX.Element {
  const number = stageNumber(root, selected)
  const solver = root.getSolver(root.pipelineDef[number - 1].solverName)
  return <RoutedAtlas key={`${number}:${solver?.solved}`} graphics={stageDrawing(root, selected)} />
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
  const [selectedStage, setSelectedStage] = useState<number>()
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
      {ready && !error && (
        <section
          className="routed-debugger"
          onClick={(event) => {
            const target = event.target as HTMLElement
            if (target.closest('button, summary, a, input')) return
            const row = target.closest('tbody > tr')
            if (!row) return
            const index = Array.from(row.parentElement!.children).indexOf(row)
            if (index >= 0 && index < 6) setSelectedStage(index + 1)
          }}
        >
          <div className="solver-selector">
            <label>
              Solver:{' '}
              <input
                aria-label="Solver"
                type="number"
                min={1}
                max={6}
                step={1}
                placeholder="current"
                value={selectedStage ?? ''}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber
                  setSelectedStage(Number.isFinite(value) ? Math.min(6, Math.max(1, Math.trunc(value))) : undefined)
                }}
              />
            </label>
            <button type="button" onClick={() => setSelectedStage(undefined)}>
              Current
            </button>
            <span>{selectedStage === undefined ? 'Following current stage' : `Viewing stage ${selectedStage}`}</span>
          </div>
          <GenericSolverDebugger
            key={ready.revision}
            customRenderer={{
              name: 'Routed stage',
              render: () => renderStage(ready.solver, selectedStage),
              getDownload: () => stageDrawing(ready.solver, selectedStage),
            }}
            solver={ready.solver as unknown as React.ComponentProps<typeof GenericSolverDebugger>['solver']}
          />
        </section>
      )}
    </>
  )
}
