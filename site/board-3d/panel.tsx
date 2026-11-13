import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CadViewer } from '@tscircuit/3d-viewer'
import * as THREE from 'three'
import { formatSiUnit } from 'format-si-unit'
import { stackupFromCircuitJson, boardViewerCircuit, boardCameraShot, boardPosition, boardSectionView, type BoardPosition } from '../../src/board'
import type { RoutedPipelineSolver } from '../../src/pipeline'
import { fullCopper, copperRoutes } from './copper'
import { stageOverlay } from './overlay'
import { dispose } from './primitives'
import { boardStageState, spatialVoltage, voltageColor } from './state'
import { physicalStack } from './stack'
import { routeVoltageAt, routeFirstEdge, routeVoltageRange } from '../../src/simulation'
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
  const range = useMemo(() => routeVoltageRange(state.captures), [state.captures])
  const section = step === 3 && slices[currentSliceIndex] ? boardSectionView(stack, slices[currentSliceIndex], aspect) : undefined
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
    camera.animateTo({ ...shot, durationMs: reducedMotion ? 0 : step === 1 ? 2200 : 850 })
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
    const overlay = stageOverlay(circuit, stack, state, step, currentSliceIndex, fraction, 0, shotProgress, aspect)
    overlayRef.current = overlay
    root.add(overlay)
    return (): void => {
      overlayRef.current = null
      dispose(overlay)
    }
  }, [root, circuit, stack, state, step, currentSliceIndex, fraction, shotProgress, aspect])
  useEffect(() => {
    overlayRef.current?.traverse((object) => {
      if (!object.userData.spatial) return
      const voltage = object.userData.blend
        ? routeVoltageAt(object.userData.spatial, object.userData.blend, time)
        : spatialVoltage(object.userData.spatial, object.userData.pointIndex, time)
      if (voltage !== undefined) ((object as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(voltageColor(voltage, range))
    })
  }, [time, range, root, state, step, currentSliceIndex, fraction, shotProgress, aspect])
  useEffect(() => {
    // Open Transient where something happens: the first probe crossing the middle of its swing.
    if (step === 6) setTime(routeFirstEdge(state.captures))
  }, [step, state.captures])
  useEffect(() => {
    if (step !== 1 || reducedMotion || !root) return
    const start = performance.now()
    let frame: number
    /** Pulse the selected-net halo three times, then hold it lit. */
    const pulse = (now: number): void => {
      const elapsed = (now - start) / 1000
      const lit = elapsed > 3.6 ? 0.45 : 0.15 + 0.55 * (0.5 - 0.5 * Math.cos((elapsed * 2 * Math.PI) / 1.2))
      overlayRef.current?.traverse((object) => {
        if (object.userData.pulse) ((object as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = lit
      })
      if (elapsed <= 3.6) frame = requestAnimationFrame(pulse)
    }
    frame = requestAnimationFrame(pulse)
    return (): void => cancelAnimationFrame(frame)
  }, [step, reducedMotion, root, state])
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
        while (owner && owner.name !== 'board') {
          if (owner.name === 'signal-integrity-overlay') return
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
          // The axial Fields shot sits inside the board; only the framed section remains.
          clone.visible = step !== 3
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
  const stageName = ['Full board', 'Admission', 'Sections', 'Fields', 'Bindings', 'Network', 'Transient'][step]
  const available =
    step === 0 || [state.scopes, state.sections, state.fields, state.bindings, state.networks, state.captures][step - 1].length > 0
  const chips = [
    !root && 'Loading',
    !available && 'Pending',
    step === 3 ? 'Components hidden' : step >= 2 && 'Components faded',
    section && section.exaggeration > 1 && `z exaggerated ×${section.exaggeration}`,
    section && section.gap.scale < 1 && 'Core compressed',
    step === 4 && (shotProgress < 0.5 ? 'Driver pads' : 'Receiver pads'),
  ].filter((chip): chip is string => Boolean(chip))
  return (
    <section className="board-3d" aria-label="Full board 3D simulation overlay">
      <header>
        <strong>{stageName}</strong>
        {chips.map((chip) => (
          <span key={chip} className="board-focus-chip">
            {chip}
          </span>
        ))}
      </header>
      <div className="board-3d-canvas" ref={canvasRef} aria-label="Scripted board camera">
        <CadViewer circuitJson={viewerCircuit} autoRotateDisabled onCameraControllerReady={cameraReady} ref={setRoot} />
      </div>
      {(step === 2 || step === 3) && slices.length > 0 && (
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
            <output>{formatSiUnit(Number(time.toPrecision(4)))}s</output>
            {spatial && (
              <span className="voltage-legend" aria-label="Trace voltage colour scale">
                {formatSiUnit(Number(range.low.toPrecision(3)))}V <span /> {formatSiUnit(Number(range.high.toPrecision(3)))}V
              </span>
            )}
          </div>
          <Waveform captures={state.captures} time={time} range={range} />
        </>
      )}
    </section>
  )
}
