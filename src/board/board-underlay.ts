import type { GraphicsObject, Line, Point, Viewbox } from 'graphics-debug'
import type { CircuitJson } from './schema'

/** Muted inner-layer colours; stage overlays use saturated colours on top. */
const innerColors = ['#9cc59a', '#c6a6d8', '#d6c27f', '#8fc9c9', '#d9a3b5', '#a9b8d9']

/** Copper layers top to bottom: the stackup's copper order, else the board's layer count; other layers used by records follow. */
export function boardLayers(circuit: CircuitJson): string[] {
  const stackup = circuit.find((record) => record.type === 'pcb_stackup')
  const board = circuit.find((record) => record.type === 'pcb_board')
  const count = Math.max(1, board?.type === 'pcb_board' ? (board.num_layers ?? 2) : 2)
  const declared =
    stackup?.type === 'pcb_stackup'
      ? stackup.layers.filter((layer) => layer.layer_type === 'copper').map((layer) => String(layer.layer))
      : count === 1
        ? ['top']
        : ['top', ...Array.from({ length: count - 2 }, (_, i) => `inner${i + 1}`), 'bottom']
  const used = circuit.flatMap((record) => ('layer' in record && typeof record.layer === 'string' ? [record.layer] : []))
  return [...new Set([...declared, ...used.filter((layer) => !declared.includes(layer))])]
}

/** Pale colour by stack position: first layer warm, last layer cool, layers between distinct. */
export function boardLayerColor(layers: readonly string[], layer: string): string {
  const index = Math.max(0, layers.indexOf(layer))
  if (index === 0) return '#e8a07a'
  if (index === layers.length - 1) return '#7fa7d6'
  return innerColors[(index - 1) % innerColors.length]
}

/** Paint order: the first (top) layer last, so the stack reads from above. */
function layerDepth(layers: readonly string[], layer: string): number {
  return -10 - Math.max(0, layers.indexOf(layer)) / Math.max(1, layers.length)
}

/** Board outline in mm: the declared outline, otherwise the centred rectangle. */
export function boardOutline(circuit: CircuitJson): Point[] {
  const board = circuit.find((record) => record.type === 'pcb_board')
  if (board?.type !== 'pcb_board') return []
  if (board.outline?.length) return board.outline.map((point) => ({ x: point.x, y: point.y }))
  const width = board.width ?? 0
  const height = board.height ?? 0
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => ({ x: board.center.x + (x * width) / 2, y: board.center.y + (y * height) / 2 }))
}

/** Width for route points that omit one: the board's minimum trace width, else 0.15 mm. */
export function boardTraceWidth(circuit: CircuitJson, width: number | undefined): number {
  if (width !== undefined && width > 0) return width
  const board = circuit.find((record) => record.type === 'pcb_board')
  return (board?.type === 'pcb_board' ? board.min_trace_width : undefined) ?? 0.15
}

/** Board bounds in mm (y up); a unit box when the board is missing. */
export function boardBounds(circuit: CircuitJson): Viewbox {
  const outline = boardOutline(circuit)
  if (!outline.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  const xs = outline.map((point) => point.x)
  const ys = outline.map((point) => point.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/** Closed copy of a polyline. */
function ring(points: readonly { x: number; y: number }[]): Point[] {
  return points.length ? [...points.map((point) => ({ x: point.x, y: point.y })), { x: points[0].x, y: points[0].y }] : []
}

/** Pure muted drawing of the whole board in board mm: outline, pours, copper, pads, vias, holes, bodies and silkscreen. */
export function boardUnderlay(circuit: CircuitJson, options: { textLimit?: number } = {}): GraphicsObject {
  const drawing: Required<Pick<GraphicsObject, 'lines' | 'rects' | 'circles' | 'polygons' | 'texts'>> & GraphicsObject = {
    coordinateSystem: 'cartesian',
    lines: [],
    rects: [],
    circles: [],
    polygons: [],
    texts: [],
  }
  const layers = boardLayers(circuit)
  /** Colour of a layer in this board's stack. */
  const color = (layer: string): string => boardLayerColor(layers, layer)
  /** Paint depth of a layer in this board's stack. */
  const depth = (layer: string): number => layerDepth(layers, layer)
  const bounds = boardBounds(circuit)
  const unit = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 100
  drawing.lines.push({ points: ring(boardOutline(circuit)), strokeColor: '#64748b', strokeWidth: unit * 0.25, zIndex: -20 })
  for (const pour of circuit) {
    if (pour.type !== 'pcb_copper_pour') continue
    const tint = color(pour.layer)
    if (pour.shape === 'brep') {
      drawing.polygons.push({ points: ring(pour.brep_shape.outer_ring.vertices).slice(0, -1), fill: `${tint}30` })
      for (const shape of [pour.brep_shape.outer_ring, ...pour.brep_shape.inner_rings])
        drawing.lines.push({ points: ring(shape.vertices), strokeColor: `${tint}90`, strokeWidth: unit * 0.15, zIndex: depth(pour.layer) })
    } else if (pour.shape === 'polygon') drawing.polygons.push({ points: pour.points.map((point) => ({ x: point.x, y: point.y })), fill: `${tint}30` })
    else drawing.rects.push({ center: pour.center, width: pour.width, height: pour.height, ccwRotationDegrees: pour.rotation, fill: `${tint}30` })
  }
  for (const trace of circuit) {
    if (trace.type !== 'pcb_trace') continue
    let run: { layer: string; width: number; points: Point[] } | undefined
    /** Merge consecutive wire points on one layer and width into one polyline. */
    const flush = (): void => {
      if (run && run.points.length > 1)
        drawing.lines.push({ points: run.points, strokeColor: `${color(run.layer)}d0`, strokeWidth: run.width, zIndex: depth(run.layer) })
      run = undefined
    }
    for (const point of trace.route) {
      if (point.route_type !== 'wire') {
        flush()
        continue
      }
      const width = boardTraceWidth(circuit, point.width)
      if (run && (run.layer !== point.layer || run.width !== width)) {
        const last = run.points.at(-1)!
        flush()
        run = { layer: point.layer, width, points: [last] }
      }
      run ??= { layer: point.layer, width, points: [] }
      run.points.push({ x: point.x, y: point.y })
    }
    flush()
  }
  for (const pad of circuit) {
    if (pad.type !== 'pcb_smtpad') continue
    const fill = `${color(pad.layer)}cc`
    if (pad.shape === 'circle') drawing.circles.push({ center: { x: pad.x, y: pad.y }, radius: pad.radius, fill })
    else if (pad.shape === 'polygon') drawing.polygons.push({ points: pad.points.map((point) => ({ x: point.x, y: point.y })), fill })
    else
      drawing.rects.push({
        center: { x: pad.x, y: pad.y },
        width: 'width' in pad ? pad.width : 0,
        height: 'height' in pad ? pad.height : 0,
        ccwRotationDegrees: 'ccw_rotation' in pad ? pad.ccw_rotation : undefined,
        fill,
      })
  }
  for (const hole of circuit) {
    if (hole.type !== 'pcb_plated_hole' && hole.type !== 'pcb_via' && hole.type !== 'pcb_hole') continue
    const record = hole as unknown as Record<string, number | undefined>
    const width = record.outer_diameter ?? record.outer_width ?? record.rect_pad_width ?? record.circle_diameter ?? 0
    const height = record.outer_diameter ?? record.outer_height ?? record.rect_pad_height ?? width
    const drill = record.hole_diameter ?? Math.min(record.hole_width ?? width / 2, record.hole_height ?? height / 2)
    const center = { x: hole.x, y: hole.y }
    const fill = hole.type === 'pcb_via' ? '#94a3b8' : `${color(layers[0])}cc`
    if (Math.abs(width - height) < 1e-9) drawing.circles.push({ center, radius: width / 2, fill })
    else drawing.rects.push({ center, width, height, ccwRotationDegrees: record.ccw_rotation, fill })
    drawing.circles.push({ center, radius: drill / 2, fill: '#ffffff', stroke: hole.type === 'pcb_hole' ? '#94a3b8' : undefined })
  }
  for (const component of circuit)
    if (component.type === 'pcb_component' && component.width > 0 && component.height > 0)
      drawing.rects.push({ center: component.center, width: component.width, height: component.height, ccwRotationDegrees: component.rotation, stroke: '#cbd5e1' })
  for (const path of circuit)
    if (path.type === 'pcb_silkscreen_path')
      drawing.lines.push({ points: path.route.map((point) => ({ x: point.x, y: point.y })), strokeColor: '#a8a29e', strokeWidth: path.stroke_width, zIndex: -9 })
  const labels = circuit.flatMap((record) => (record.type === 'pcb_silkscreen_text' && finite(record.anchor_position) ? [record] : []))
  if (labels.length <= (options.textLimit ?? 400))
    for (const label of labels)
      drawing.texts.push({ ...label.anchor_position, text: label.text, color: '#a8a29e', fontSize: label.font_size, rotation: label.ccw_rotation, anchorSide: 'center' })
  // Partial or unusual records must never break the whole frame: drop any primitive with a non-finite coordinate or size.
  drawing.lines = drawing.lines.filter((line) => line.points.length > 1 && line.points.every(finite) && Number.isFinite(line.strokeWidth ?? 0))
  drawing.polygons = drawing.polygons.filter((polygon) => polygon.points.length > 2 && polygon.points.every(finite))
  drawing.rects = drawing.rects.filter((rect) => finite(rect.center) && rect.width > 0 && rect.height > 0)
  drawing.circles = drawing.circles.filter((circle) => finite(circle.center) && circle.radius > 0)
  return drawing
}

/** A point whose coordinates are both finite numbers. */
function finite(point: { x?: number; y?: number } | undefined): boolean {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y)
}

const underlays = new WeakMap<CircuitJson, GraphicsObject>()

/** The underlay computed once per board; each caller gets fresh arrays to append its overlay to. */
export function boardUnderlayCopy(circuit: CircuitJson): GraphicsObject {
  const underlay = underlays.get(circuit) ?? boardUnderlay(circuit)
  underlays.set(circuit, underlay)
  return {
    coordinateSystem: 'cartesian',
    lines: [...underlay.lines!],
    rects: [...underlay.rects!],
    circles: [...underlay.circles!],
    polygons: [...underlay.polygons!],
    texts: [...underlay.texts!],
    points: [],
  }
}

/** A bright overlay line, painted above all underlay copper and fills. */
export function overlayLine(points: Point[], strokeColor: string, strokeWidth: number, label?: string): Line {
  return { points, strokeColor, strokeWidth, zIndex: 2, label }
}
