import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Circuit } from '@tscircuit/core'
import { GenericSolverDebugger } from '@tscircuit/solver-utils/react'
import type { GraphicsObject, Viewbox } from 'graphics-debug'
import { createHttpSolver } from '../src/adapters/browser'
import { RoutedPipelineSolver } from '../src/pipeline'
import type { CircuitJson } from '../src/board'
// Imported directly: circuit-to-svg is a development dependency and never enters the library bundle.
import { boardPicture, boardPictureView } from '../src/board/board-picture'
import type { IbisSources } from '../src/buffers'

/**
 * The real board under the stage drawing at the container's width.
 * Ctrl/⌘ + wheel zooms (1–20×) and dragging pans; after a pause the zoomed region is re-rendered crisply.
 * Hovering a net, curve or mark dims everything else that is labelled and names it.
 */
function RoutedAtlas({ circuit, graphics }: { circuit: CircuitJson; graphics: GraphicsObject }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [region, setRegion] = useState<Viewbox>()
  const [move, setMove] = useState({ x: 0, y: 0, zoom: 1 })
  const [hover, setHover] = useState<{ label: string; x: number; y: number }>()
  const camera = boardPictureView(circuit, graphics)
  const view = region ?? camera
  const height = Math.round(Math.min(720, Math.max(360, (width * (camera.maxY - camera.minY)) / Math.max(camera.maxX - camera.minX, 1e-9))))
  const total = useRef(1)
  total.current = ((camera.maxX - camera.minX) / (view.maxX - view.minX)) * move.zoom
  useEffect(() => {
    const element = container.current!
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    /** Zoom about the cursor only with ctrl/⌘, so the page still scrolls normally. */
    const zoom = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const factor = Math.min(20 / total.current, Math.max(1 / total.current, Math.exp(-event.deltaY * 0.002)))
      setMove(({ x, y, zoom }) => ({ zoom: zoom * factor, x: event.clientX - box.left - (event.clientX - box.left - x) * factor, y: event.clientY - box.top - (event.clientY - box.top - y) * factor }))
    }
    element.addEventListener('wheel', zoom, { passive: false })
    return (): void => {
      observer.disconnect()
      element.removeEventListener('wheel', zoom)
    }
  }, [])
  useEffect(() => {
    if (move.zoom === 1 && move.x === 0 && move.y === 0) return
    // Once interaction pauses, the visible part becomes the rendered region: sharp copper, same-size labels.
    const timer = setTimeout(() => {
      const scale = Math.min(width / (view.maxX - view.minX), height / (view.maxY - view.minY))
      const left = (width - (view.maxX - view.minX) * scale) / 2
      const top = (height - (view.maxY - view.minY) * scale) / 2
      /** The world point under a container pixel. */
      const world = (px: number, py: number): { x: number; y: number } => ({ x: view.minX + ((px - move.x) / move.zoom - left) / scale, y: view.maxY - ((py - move.y) / move.zoom - top) / scale })
      const [low, high] = [world(0, height), world(width, 0)]
      setRegion(high.x - low.x >= (camera.maxX - camera.minX) * 0.999 ? undefined : { minX: low.x, maxX: high.x, minY: low.y, maxY: high.y })
      setMove({ x: 0, y: 0, zoom: 1 })
    }, 250)
    return (): void => clearTimeout(timer)
  }, [move])
  const picture = useMemo(() => (width > 0 ? boardPicture(circuit, graphics, width, height, region) : undefined), [circuit, graphics, width, height, region])
  return (
    <div
      ref={container}
      className="routed-atlas"
      aria-label="Routed pipeline atlas"
      style={{ height }}
      onDoubleClick={() => {
        setRegion(undefined)
        setMove({ x: 0, y: 0, zoom: 1 })
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1 && total.current > 1) setMove((move) => ({ ...move, x: move.x + event.movementX, y: move.y + event.movementY }))
        const label = (event.target as Element).closest?.('[data-label]')?.getAttribute('data-label')
        const box = container.current!.getBoundingClientRect()
        setHover(label && label !== 'camera' ? { label, x: event.clientX - box.left, y: event.clientY - box.top } : undefined)
      }}
      onPointerLeave={() => setHover(undefined)}
    >
      {picture && (
        <div className="routed-atlas-layers" style={{ transform: `translate(${move.x}px, ${move.y}px) scale(${move.zoom})` }}>
          <div dangerouslySetInnerHTML={{ __html: picture.board }} />
          <div dangerouslySetInnerHTML={{ __html: picture.overlay }} />
        </div>
      )}
      {hover && (
        <>
          <style>{`.routed-atlas-layers [data-label]:not([data-label=""]):not([data-label="camera"]):not([data-label=${JSON.stringify(hover.label)}]) { opacity: 0.2 }`}</style>
          <span className="routed-atlas-label" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.label}
          </span>
        </>
      )}
    </div>
  )
}

const drawings = new WeakMap<RoutedPipelineSolver, { key: string; graphics: GraphicsObject }>()

/** Draw a stage once per solver state, not on every debugger re-render; the camera resets when the stage changes. */
function renderStage(root: RoutedPipelineSolver, number: number): React.JSX.Element {
  const solver = root.getSolver(root.pipelineDef[number - 1]?.solverName ?? '')
  const key = `${number}:${root.iterations}:${solver?.iterations}:${solver?.solved}:${solver?.failed}`
  const cached = drawings.get(root)
  const graphics = cached?.key === key ? cached.graphics : root.visualizeStage(number)
  drawings.set(root, { key, graphics })
  return <RoutedAtlas key={number} circuit={root.inputProblem.circuitJson} graphics={graphics} />
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
