import React, { useEffect, useRef, useState } from 'react'
import type { RoutedPipelineSolver } from '../src/pipeline'
import { Board3dPanel } from './board-3d/panel'

/** Six static rows and serial stepping share one retained solver and one physical 3D scene. */
export function Stages({ solver }: { solver: RoutedPipelineSolver }): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [revision, setRevision] = useState(0)
  const [slice, setSlice] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const running = useRef(false)
  useEffect(
    () => (): void => {
      running.current = false
    },
    [solver],
  )
  /** Yield between domain iterations so both the scene and the native execution status remain inspectable. */
  const advance = async (mode: 'step' | 'stage' | 'solve', target: number = solver.currentPipelineStageIndex): Promise<void> => {
    if (running.current || solver.solved || solver.failed) return
    running.current = true
    setBusy(true)
    try {
      do {
        await solver.stepAsync()
        setRevision(value => value + 1)
        setStep(Math.min(solver.currentPipelineStageIndex + 1, 6))
        await new Promise<void>(resolve => window.setTimeout(resolve, 0))
      } while (running.current && !solver.solved && !solver.failed && mode !== 'step' && (mode === 'solve' || solver.currentPipelineStageIndex <= target))
      if (solver.failed) setError(solver.error ?? 'Stage failed')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      running.current = false
      setBusy(false)
      setRevision(value => value + 1)
    }
  }
  /** Download the exact constructor input already retained by this stage. */
  const download = (name: string): void => {
    const stage = solver.getSolver(name)
    if (!stage) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(stage.getConstructorParams(), null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${name}.input.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  return <section className="routed-debugger">
    <div className="stage-controls">
      <label>Step: <input aria-label="Step" type="number" min={0} max={6} value={step} onChange={event => setStep(Math.max(0, Math.min(6, Math.trunc(event.target.valueAsNumber))) || 0)} /></label>
      <button disabled={busy || solver.solved || solver.failed} onClick={() => void advance('step')}>Step</button>
      <button disabled={busy || solver.solved || solver.failed} onClick={() => void advance('stage')}>Next Stage</button>
      <button disabled={busy || solver.solved || solver.failed} onClick={() => void advance('solve')}>Solve</button>
      {busy && <button onClick={() => {
        running.current = false
      }}>Stop after current step</button>}
      <span>Iterations: {solver.iterations}</span>
    </div>
    {error && <p role="alert">{error}</p>}
    <Board3dPanel solver={solver} step={step} revision={revision} sliceIndex={slice} onSliceChange={setSlice} />
    <section className="pipeline-stages" aria-label="Pipeline Stages">
      <h3>Pipeline Stages</h3>
      <table><thead><tr><th>Stage</th><th>Status</th><th>i<sub>0</sub></th><th>Iterations</th><th>Progress</th><th>Time</th><th>Stats</th><th>Input</th></tr></thead>
        <tbody>{solver.pipelineDef.map((definition, index) => {
          const stage = solver.getSolver(definition.solverName)
          const status = stage?.failed ? 'Failed' : stage?.solved ? 'Completed' : stage ? 'Running' : 'Not Started'
          const seconds = (solver.timeSpentOnStage[definition.solverName] ?? 0) / 1000
          return <tr key={definition.solverName} aria-selected={step === index + 1} onClick={() => setStep(index + 1)}>
            <td><span>{String(index + 1).padStart(2, '0')} </span><button aria-label={`Step until ${definition.solverName} completes`} disabled={busy || solver.solved || solver.failed || index < solver.currentPipelineStageIndex} onClick={event => {
              event.stopPropagation()
              void advance('stage', index)
            }}>▶</button> {definition.solverName}</td>
            <td>{status}</td><td>{solver.firstIterationOfStage[definition.solverName] ?? ''}</td><td>{stage?.iterations ?? 0}</td>
            <td>{stage ? `${Math.round(stage.progress * 100)}%` : ''}</td><td>{seconds.toFixed(2)}s</td>
            <td>{Object.entries(stage?.stats ?? {}).map(([name, value]) => `${name}: ${String(value)}`).join(', ') || '-'}</td>
            <td>{stage && <button onClick={event => {
              event.stopPropagation()
              download(definition.solverName)
            }}>Input</button>}</td>
          </tr>
        })}</tbody>
      </table>
    </section>
  </section>
}
