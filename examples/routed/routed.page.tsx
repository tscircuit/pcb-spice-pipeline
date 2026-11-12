import React, { useEffect, useRef, useState } from 'react'
import { Circuit } from '@tscircuit/core'
import { GenericSolverDebugger } from '@tscircuit/solver-utils/react'
import { createWasmSolver } from '../../src/adapters/browser'
import { RoutedPipelineSolver } from '../../src/pipeline'
import type { CircuitJson } from '../../src/board'
import type { IbisSources } from '../../src/buffers'
import { TwoTraceBoard } from './two-trace-board'
import { withDdr3Signals } from './ddr3-signals'

type BoardSource = { 'board-tree'?: React.ReactElement; 'load-board'?: never } | { 'board-tree'?: never; 'load-board': () => Promise<CircuitJson> }
const demo = <TwoTraceBoard bit-rate="50Mbps" duration-seconds={40e-9} />

/** Rendering and local asset IO finish before constructing the live solver. */
export function RoutedDebugger({ 'board-tree': boardTree = demo, 'load-board': loadBoard, 'ibis-sources': ibisSources }: BoardSource & { 'ibis-sources': IbisSources }): React.JSX.Element {
  const revision = useRef(0)
  const [ready, setReady] = useState<{ solver: RoutedPipelineSolver; revision: number }>()
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState('Ready for live transient')
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setReady(undefined)
    setError(undefined)
    const load = async (): Promise<void> => {
      let circuitJson: CircuitJson
      if (loadBoard) circuitJson = await loadBoard()
      else {
        const core = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async url => {
          const file = `models/${String(url).split('/').at(-1)}`
          const bytes = ibisSources[file]
          if (bytes === undefined) throw new Error(`Missing local vendor asset ${file}`)
          return new Response(typeof bytes === 'string' ? bytes : new Uint8Array(bytes).buffer)
        } } })
        core.add(boardTree)
        await core.renderUntilSettled()
        circuitJson = core.getCircuitJson() as CircuitJson
      }
      const errors = circuitJson.filter(record => record.type.endsWith('_error'))
      if (errors.length) throw new Error(JSON.stringify(errors))
      if (!cancelled) setReady({ solver: new RoutedPipelineSolver({ circuitJson, ibisSources, scopeDistanceMm: 1 }, { runSolver: createWasmSolver({ signal: controller.signal, progress: setProgress }), progress: setProgress }), revision: ++revision.current })
    }
    void load().catch((cause: unknown) => {
      if (!cancelled) setError(String(cause))
    })
    return (): void => {
      cancelled = true
      controller.abort()
    }
  }, [boardTree, loadBoard, ibisSources])
  if (error) return <p role="alert">{error}</p>
  if (!ready) return <p>Rendering board…</p>
  // PR #62 emits separate BaseSolver declarations for /react and the root entry.
  // Their private stepping field is nominally incompatible despite one runtime class.
  const debuggerSolver = ready.solver as unknown as React.ComponentProps<typeof GenericSolverDebugger>['solver']
  return <><p role="status">{progress}</p><GenericSolverDebugger key={ready.revision} solver={debuggerSolver} /></>
}

/** Local files stay in the browser. DDR physical copper is imported, never fabricated. */
export default function RoutedPage(): React.JSX.Element {
  const [kind, setKind] = useState('two-trace')
  const [sources, setSources] = useState<IbisSources>({})
  const [physical, setPhysical] = useState<CircuitJson>()
  const [loadBoard, setLoadBoard] = useState<(() => Promise<CircuitJson>)>()
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<string>()
  return <main>
    <h1>Routed 2.5D stages</h1>
    <p>Step through extraction and run a live ngspice transient in the browser. Large DDR3 runs can take several minutes; each run has a 15 minute limit.</p>
    <select aria-label="Board" value={kind} onChange={event => { setKind(event.target.value)
      setStarted(false) }}>
      <option value="two-trace">Two TSX traces</option><option value="ddr3">DDR3 addr/cmd: 24 nets from imported physical board</option>
    </select>
    <label>Local vendor IBIS files<input type="file" multiple accept=".ibs" onChange={event => {
      setStarted(false)
      void Promise.all(Array.from(event.target.files ?? []).map(async file => [`models/${file.name}`, await file.text()])).then(entries => setSources(Object.fromEntries(entries))).catch(cause => setError(String(cause)))
    }} /></label>
    {kind === 'ddr3' && <label>Physical board JSON<input type="file" accept=".json" onChange={event => {
      setStarted(false)
      const file = event.target.files?.[0]
      if (file) void file.text().then(text => setPhysical(JSON.parse(text))).catch(cause => setError(String(cause)))
    }} /></label>}
    <button onClick={() => {
      setError(undefined)
      if (kind === 'ddr3' && !physical) {
        setError('Select the real 1.2 mm eight-layer DDR3 physical board')
        return
      }
      setLoadBoard(kind === 'ddr3' ? () => () => withDdr3Signals(physical!, sources, { block: 'DDR3_ADDR_CMD' }) : undefined)
      setStarted(true)
    }}>Inspect stages</button>
    {error && <p role="alert">{error}</p>}
    {started && (loadBoard ? <RoutedDebugger load-board={loadBoard} ibis-sources={sources} /> : <RoutedDebugger ibis-sources={sources} />)}
  </main>
}
