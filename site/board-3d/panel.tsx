import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CadViewer } from '@tscircuit/3d-viewer'
import * as THREE from 'three'
import { stackupFromCircuitJson } from '../../src/board'
import type { RoutedPipelineSolver } from '../../src/pipeline'
import { fullCopper } from './copper'
import { stageOverlay } from './overlay'
import { dispose } from './primitives'
import { boardStageState } from './state'
import { Waveform } from './waveform'

type CameraController = NonNullable<Parameters<NonNullable<React.ComponentProps<typeof CadViewer>['onCameraControllerReady']>>[0]>

/** Attach overlay objects to the pinned viewer's existing Three.js root and render loop. */
export function Board3dPanel({ solver, step, revision }: { solver: RoutedPipelineSolver; step: number; revision: number }): React.JSX.Element {
  const circuit = solver.inputProblem.circuitJson
  const stack = useMemo(() => stackupFromCircuitJson(circuit), [circuit])
  const state = useMemo(() => boardStageState(solver, step), [solver, step, revision])
  const [root, setRoot] = useState<THREE.Object3D | null>(null)
  const [camera, setCamera] = useState<CameraController | null>(null)
  const [xray, setXray] = useState(true)
  const [sliceIndex, setSliceIndex] = useState(0)
  const [fraction, setFraction] = useState(.5)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const slices = step >= 3 ? state.fields.flatMap(field => field.slices) : state.sections.flatMap(section => section.geometry.slices)
  const duration = Math.max(0, ...state.captures.map(capture => capture.spatial?.timeSeconds.at(-1) ?? capture.timestampsSeconds.at(-1) ?? 0))
  const spatial = state.captures.some(capture => capture.spatial?.points.length)
  /** Manifold 0.0.650 exposes its root through this pinned scene handle; JSCAD also forwards ref. */
  const cameraReady = useCallback((controller: CameraController | null): void => {
    setCamera(controller)
    if (!controller) return
    const sceneRoot = (window as unknown as { __TSCIRCUIT_THREE_OBJECT?: THREE.Object3D }).__TSCIRCUIT_THREE_OBJECT
    if (sceneRoot?.parent?.type === 'Scene') setRoot(sceneRoot)
    controller.animateToPreset('Top Center Angled')
  }, [])
  useEffect(() => {
    if (!root) return
    const copper = fullCopper(circuit, stack)
    root.add(copper)
    return (): void => dispose(copper)
  }, [root, circuit, stack])
  useEffect(() => {
    if (!root) return
    const overlay = stageOverlay(circuit, stack, state, step, sliceIndex, fraction, time)
    root.add(overlay)
    return (): void => dispose(overlay)
  }, [root, circuit, stack, state, step, sliceIndex, fraction, time])
  useEffect(() => {
    if (!root) return
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
    /** Board assets load asynchronously; clone their materials without changing component models. */
    const apply = (): void => {
      root.traverse(object => {
        object.frustumCulled = false
        const mesh = object as THREE.Mesh
        let owner: THREE.Object3D | null = object
        while (owner && owner.name !== 'board') owner = owner.parent
        if (!owner || !mesh.material || originals.has(mesh)) return
        originals.set(mesh, mesh.material)
        const copy = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => {
          const clone = material.clone()
          if (xray) {
            clone.transparent = true
            clone.opacity = object.name.includes('texture') ? .2 : .15
            clone.depthWrite = false
          }
          return clone
        })
        mesh.material = Array.isArray(mesh.material) ? copy : copy[0]
      })
    }
    apply()
    const interval = window.setInterval(apply, 300)
    return (): void => {
      window.clearInterval(interval)
      for (const [mesh, original] of originals) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
        mesh.material = original
      }
    }
  }, [root, xray])
  useEffect(() => {
    if (!playing || duration <= 0 || step !== 6) return
    let previous = performance.now()
    let frame: number
    /** Play a complete capture over eight seconds, independent of sample spacing. */
    const advance = (now: number): void => {
      const elapsed = now - previous
      previous = now
      setTime(time => (time + elapsed / 8000 * duration) % duration)
      frame = requestAnimationFrame(advance)
    }
    frame = requestAnimationFrame(advance)
    return (): void => cancelAnimationFrame(frame)
  }, [playing, duration, step])
  const missingCad = circuit.filter(record => record.type === 'pcb_component' && !circuit.some(cad => cad.type === 'cad_component' && cad.pcb_component_id === record.pcb_component_id)).length
  const stageName = ['Full board', 'Admission', 'Sections', 'Fields', 'Bindings', 'Network', 'Transient'][step]
  const available = step === 0 || [state.scopes, state.sections, state.fields, state.bindings, state.networks, state.captures][step - 1].length > 0
  return <section className="board-3d" aria-label="Full board 3D simulation overlay">
    <header><strong>3D · {stageName}</strong><label><input type="checkbox" checked={xray} onChange={event => setXray(event.target.checked)} />X-ray board</label>
      <button onClick={() => camera?.animateToPreset('Top Center Angled')}>Fit full board</button><button onClick={() => camera?.animateToPreset('Top Down')}>Top</button></header>
    <div className="board-3d-canvas"><CadViewer circuitJson={circuit} autoRotateDisabled onCameraControllerReady={cameraReady} ref={setRoot} /></div>
    <p className="board-legend">All {circuit.filter(record => record.type === 'pcb_component').length} components · {stack.copperLayers.length} copper layers · blue selected · grey neighbours · green sections · amber slice · magenta ladder · red probes</p>
    {missingCad > 0 && <p>{missingCad} components have no CAD record; labelled wireframe bodies show their physical footprint.</p>}
    {!root && <p role="status">Loading board scene and component models…</p>}
    {!available && <p role="status">{stageName} has no completed output yet. Advance the solver using Solve or Step.</p>}
    {step >= 2 && slices.length > 0 && <div className="board-controls"><label>Slice <input aria-label="Slice" type="number" min={1} max={slices.length} value={sliceIndex % slices.length + 1} onChange={event => setSliceIndex(Math.max(0, Math.min(slices.length - 1, event.target.valueAsNumber - 1)) || 0)} /> / {slices.length}</label>
      <label>Position <input aria-label="Slice position" type="range" min={0} max={1} step={.001} value={fraction} onChange={event => setFraction(event.target.valueAsNumber)} /></label><span>Cross-section at true scale (mm)</span></div>}
    {step === 6 && <><div className="board-controls"><button disabled={!duration} onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
      <label>Time <input aria-label="Transient time" type="range" min={0} max={duration || 1} step={duration / 2000 || .001} value={Math.min(time, duration)} onChange={event => {
        setPlaying(false)
        setTime(event.target.valueAsNumber)
      }} /></label><output>{(time * 1e9).toPrecision(5)} ns</output></div>
      {spatial ? <p className="voltage-legend">Trace voltage: −1 V <span /> +5 V · nearest saved spatial node, linear time interpolation</p> : <p>Spatial native voltages are not available yet; trace colours remain stage highlights.</p>}
      <Waveform captures={state.captures} time={time} /></>}
  </section>
}
