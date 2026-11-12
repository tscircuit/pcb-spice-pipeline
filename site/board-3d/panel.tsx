import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CadViewer } from '@tscircuit/3d-viewer'
import * as THREE from 'three'
import { stackupFromCircuitJson, boardViewerCircuit, boardCameraShot, boardPosition, type BoardPosition } from '../../src/board'
import type { RoutedPipelineSolver } from '../../src/pipeline'
import { fullCopper, copperRoutes } from './copper'
import { stageOverlay } from './overlay'
import { dispose } from './primitives'
import { boardStageState, spatialVoltage, voltageColor } from './state'
import { physicalStack } from './stack'
import { routeVoltageAt } from '../../src/simulation'
import { Waveform } from './waveform'

type CameraController = NonNullable<Parameters<NonNullable<React.ComponentProps<typeof CadViewer>['onCameraControllerReady']>>[0]>

/** Attach overlay objects to the pinned viewer's existing Three.js root and render loop. */
export function Board3dPanel({
  solver,
  step,
  revision,
  sliceIndex,
  onSliceChange,
}: {
  solver: RoutedPipelineSolver
  step: number
  revision: number
  sliceIndex: number
  onSliceChange: (index: number) => void
}): React.JSX.Element {
  const circuit = solver.inputProblem.circuitJson
  // The viewer indexes its input array; solver snapshots remain immutable.
  const viewerCircuit = useMemo(() => boardViewerCircuit(circuit), [circuit])
  const stack = useMemo(() => stackupFromCircuitJson(circuit), [circuit])
  const state = useMemo(() => boardStageState(solver, step), [solver, step, revision])
  const overlayRef = useRef<THREE.Group | null>(null)
  const [root, setRoot] = useState<THREE.Object3D | null>(null)
  const [camera, setCamera] = useState<CameraController | null>(null)
  const [shotProgress, setShotProgress] = useState(1)
  const [aspect, setAspect] = useState(2.4)
  const [reducedMotion, setReducedMotion] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [fraction, setFraction] = useState(0.5)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const slices = step >= 3 ? state.fields.flatMap((field) => field.slices) : state.sections.flatMap((section) => section.geometry.slices)
  // Until a slice is chosen, show the longest uniform section rather than a short fanout piece.
  const longest = slices.reduce((best, slice, index) => (slice.end - slice.start > slices[best].end - slices[best].start ? index : best), 0)
  const currentSliceIndex = sliceIndex < 0 ? longest : Math.min(sliceIndex, Math.max(0, slices.length - 1))
  const duration = Math.max(
    0,
    ...state.captures.map((capture) => capture.spatial?.timeSeconds.at(-1) ?? capture.timestampsSeconds.at(-1) ?? 0),
  )
  const spatial = state.captures.some((capture) => capture.spatial?.points.length)
  /** Manifold 0.0.650 exposes its root through this pinned scene handle; JSCAD also forwards ref. */
  const cameraReady = useCallback(
    (controller: CameraController | null): void => {
      setCamera(controller)
      if (!controller) return
      const sceneRoot = (window as unknown as { __TSCIRCUIT_THREE_OBJECT?: THREE.Object3D }).__TSCIRCUIT_THREE_OBJECT
      if (sceneRoot?.parent?.type === 'Scene') setRoot(sceneRoot)
    },
    [circuit],
  )
  const stageReady =
    step === 0 || [state.scopes, state.sections, state.fields, state.bindings, state.networks, state.captures][step - 1].length > 0
  const focus = useMemo((): BoardPosition[] => {
    if (step === 4) {
      const mapping = state.bindings.flatMap((binding) => binding.mappings)[0]
      const points = mapping
        ? [mapping.from, mapping.to].flatMap((id) => {
            const port = circuit.find((record) => record.type === 'pcb_port' && record.source_port_id === id)
            return port?.type === 'pcb_port' ? [boardPosition(stack, port.x, port.y, port.layers[0])] : []
          })
        : []
      if (points.length) return points
    }
    const selected = new Set(state.scopes.flatMap((scope) => scope.selectedPcbTraceIds))
    const routes = copperRoutes(circuit)
    const first = routes.find((route) => selected.has(route.trace)) ?? routes[0]
    const track = routes.filter((route) => route.trace === first?.trace)
    return track.length
      ? [boardPosition(stack, ...track[0].a, track[0].layer), ...track.map((route) => boardPosition(stack, ...route.b, route.layer))]
      : []
  }, [circuit, stack, state, step])
  useEffect(() => {
    /** The stock viewer's global camera shortcuts must not override the stage script. */
    const lockCamera = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, button') || ['Tab', 'Enter', ' '].includes(event.key)) return
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', lockCamera, true)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    /** Respect changes to the user's system motion preference. */
    const change = (): void => setReducedMotion(media.matches)
    change()
    media.addEventListener('change', change)
    const observer = new ResizeObserver(([entry]) => setAspect(entry.contentRect.width / Math.max(1, entry.contentRect.height)))
    if (canvasRef.current) observer.observe(canvasRef.current)
    return (): void => {
      window.removeEventListener('keydown', lockCamera, true)
      media.removeEventListener('change', change)
      observer.disconnect()
    }
  }, [])
  useEffect(() => {
    // Sections' fly-through leaves its last slice selected; Fields opens on the longest section instead.
    if (step === 3) onSliceChange(-1)
  }, [step, onSliceChange])
  useEffect(() => {
    setShotProgress(reducedMotion || step === 0 || step === 3 || step === 6 ? 1 : 0)
    if (reducedMotion || !stageReady) return
    const phases = step === 2 || step === 5 ? [0.2, 0.4, 0.6, 0.8, 1] : step === 1 || step === 4 ? [1] : []
    const timers = phases.map((progress, index) =>
      window.setTimeout(
        () => {
          setShotProgress(progress)
          if (step === 2 && slices.length) onSliceChange(Math.round(progress * (slices.length - 1)))
        },
        (index + 1) * (step === 4 ? 1800 : 1000),
      ),
    )
    return (): void => timers.forEach((timer) => window.clearTimeout(timer))
  }, [step, stageReady, reducedMotion, root, slices.length, onSliceChange])
  useEffect(() => {
    if (!camera) return
    const shot = boardCameraShot(circuit, stack, {
      stage: step,
      progress: shotProgress,
      focus,
      slice: slices[currentSliceIndex]
        ? {
            ...slices[currentSliceIndex],
            start: slices[currentSliceIndex].start + (slices[currentSliceIndex].end - slices[currentSliceIndex].start) * fraction,
            end: slices[currentSliceIndex].start + (slices[currentSliceIndex].end - slices[currentSliceIndex].start) * fraction,
          }
        : undefined,
      aspect,
    })
    camera.animateTo({ ...shot, durationMs: reducedMotion ? 0 : 850 })
  }, [camera, circuit, stack, step, shotProgress, focus, currentSliceIndex, fraction, aspect, reducedMotion])
  useEffect(() => {
    if (!root) return
    const copper = fullCopper(circuit, stack)
    copper.add(physicalStack(circuit, stack))
    root.add(copper)
    return (): void => dispose(copper)
  }, [root, circuit, stack])
  useEffect(() => {
    if (!root) return
    const overlay = stageOverlay(circuit, stack, state, step, currentSliceIndex, fraction, 0, shotProgress)
    overlayRef.current = overlay
    root.add(overlay)
    return (): void => {
      overlayRef.current = null
      dispose(overlay)
    }
  }, [root, circuit, stack, state, step, currentSliceIndex, fraction, shotProgress])
  useEffect(() => {
    overlayRef.current?.traverse((object) => {
      if (!object.userData.spatial) return
      const voltage = object.userData.blend
        ? routeVoltageAt(object.userData.spatial, object.userData.blend, time)
        : spatialVoltage(object.userData.spatial, object.userData.pointIndex, time)
      if (voltage !== undefined) ((object as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(voltageColor(voltage))
    })
  }, [time, root, state, step, currentSliceIndex, fraction, shotProgress])
  useEffect(() => {
    // Placeholder names explain the full-board shots; focus shots hide them behind the visible fade chip.
    root?.traverse((object) => {
      if (object.userData.placeholder) object.visible = step < 2
    })
  }, [root, step, circuit])
  useEffect(() => {
    if (!root) return
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
    /** Board assets load asynchronously; clone their materials without changing component models. */
    const apply = (): void => {
      root.traverse((object) => {
        object.frustumCulled = false
        const mesh = object as THREE.Mesh
        let owner: THREE.Object3D | null = object
        let physical = false
        while (owner && owner.name !== 'board') {
          if (owner.name === 'signal-integrity-overlay') return
          physical ||= owner.name === 'physical-board-stack'
          owner = owner.parent
        }
        if (!mesh.material || originals.has(mesh) || object.userData.spatial || object.parent?.name === 'signal-integrity-overlay') return
        if (owner && /board-geom|texture-plane|^via-/.test(object.name)) {
          object.visible = false
          return
        }
        originals.set(mesh, mesh.material)
        const copy = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => {
          const clone = material.clone()
          const opacity = mesh.type === 'Sprite' && step === 3 ? 0 : step === 0 || step === 1 ? 1 : owner ? (step === 3 ? 0.035 : 0.18) : step === 3 ? 0.08 : step === 4 ? 0.18 : 0.4
          // The axial Fields shot sits inside the board; only the dielectric slabs and the true-scale section remain.
          clone.visible = step !== 3 || physical
          if (opacity < 1) {
            clone.transparent = true
            clone.opacity = opacity
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
  }, [root, step])
  useEffect(() => {
    if (!playing || duration <= 0 || step !== 6) return
    let previous = performance.now()
    let frame: number
    /** Play a complete capture over eight seconds, independent of sample spacing. */
    const advance = (now: number): void => {
      const elapsed = now - previous
      previous = now
      setTime((time) => (time + (elapsed / 8000) * duration) % duration)
      frame = requestAnimationFrame(advance)
    }
    frame = requestAnimationFrame(advance)
    return (): void => cancelAnimationFrame(frame)
  }, [playing, duration, step])
  const missingCad = circuit.filter(
    (record) =>
      record.type === 'pcb_component' &&
      !circuit.some((cad) => cad.type === 'cad_component' && cad.pcb_component_id === record.pcb_component_id && (cad.model_obj_url || cad.model_stl_url || cad.model_gltf_url || cad.model_jscad || cad.footprinter_string)),
  ).length
  const stageName = ['Full board', 'Admission', 'Sections', 'Fields', 'Bindings', 'Network', 'Transient'][step]
  const available =
    step === 0 || [state.scopes, state.sections, state.fields, state.bindings, state.networks, state.captures][step - 1].length > 0
  return (
    <section className="board-3d" aria-label="Full board 3D simulation overlay">
      <header>
        <strong>3D · {stageName}</strong>
        <span className="board-shot">Automatic camera · orbit / pan / zoom locked</span>
        {step >= 2 && (
          <span className="board-focus-chip">{step === 3 ? 'Components hidden · stack translucent' : 'Components faded · upper layers translucent'}</span>
        )}
        {step === 4 && <span className="board-focus-chip">{shotProgress < 0.5 ? 'Driver pads' : 'Receiver pads'}</span>}
      </header>
      <div className="board-3d-canvas" ref={canvasRef} aria-label="Scripted board camera">
        <CadViewer circuitJson={viewerCircuit} autoRotateDisabled onCameraControllerReady={cameraReady} ref={setRoot} />
      </div>
      <p className="board-legend">
        All {circuit.filter((record) => record.type === 'pcb_component').length} components · {stack.copperLayers.length} copper layers ·
        blue selected · grey neighbours · green sections · amber slice · magenta ladder · red probes
      </p>
      {missingCad > 0 && <p>{missingCad} components have no 3D model; labelled wireframe bodies show their physical footprint.</p>}
      {!root && <p role="status">Loading board scene and component models…</p>}
      {!available && <p role="status">{stageName} has no completed output yet. Advance the solver using Solve or Step.</p>}
      {step >= 2 && slices.length > 0 && (
        <div className="board-controls">
          <label>
            Slice{' '}
            <input
              aria-label="Slice"
              type="number"
              min={1}
              max={slices.length}
              value={currentSliceIndex + 1}
              onChange={(event) => onSliceChange(Math.max(0, Math.min(slices.length - 1, event.target.valueAsNumber - 1)) || 0)}
            />{' '}
            / {slices.length}
          </label>
          <label>
            Position{' '}
            <input
              aria-label="Slice position"
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={fraction}
              onChange={(event) => setFraction(event.target.valueAsNumber)}
            />
          </label>
          <span>Cross-section at true scale (mm)</span>
        </div>
      )}
      {step === 6 && (
        <>
          <div className="board-controls">
            <button disabled={!duration} onClick={() => setPlaying(!playing)}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <label>
              Time{' '}
              <input
                aria-label="Transient time"
                type="range"
                min={0}
                max={duration || 1}
                step={duration / 2000 || 0.001}
                value={Math.min(time, duration)}
                onChange={(event) => {
                  setPlaying(false)
                  setTime(event.target.valueAsNumber)
                }}
              />
            </label>
            <output>{(time * 1e9).toPrecision(5)} ns</output>
          </div>
          {spatial ? (
            <p className="voltage-legend">
              Trace voltage: −1 V <span /> +5 V · linear interpolation along the physical route and native time grid
            </p>
          ) : (
            <p>Spatial native voltages are not available yet; trace colours remain stage highlights.</p>
          )}
          <Waveform captures={state.captures} time={time} />
        </>
      )}
    </section>
  )
}
