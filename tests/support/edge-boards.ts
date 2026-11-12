import assert from 'node:assert/strict'
import { getBounds, type GraphicsObject } from 'graphics-debug'
import type { CircuitJson } from '../../src/board'

/** Synthetic edge-case boards built from plain records; no example names or sizes. */
export function edgeBoard(options: { layers?: number; outline?: boolean; pours?: boolean; parts?: boolean; widthless?: boolean } = {}): CircuitJson {
  const layers = options.layers ?? 2
  const names = layers === 1 ? ['top'] : ['top', ...Array.from({ length: layers - 2 }, (_, i) => `inner${i + 1}`), 'bottom']
  const records: Record<string, unknown>[] = [
    {
      type: 'pcb_board',
      pcb_board_id: 'b',
      center: { x: 3, y: -2 },
      num_layers: layers,
      thickness: 1,
      ...(options.outline
        ? { outline: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 20, y: 25 }, { x: 0, y: 10 }] }
        : { width: 30, height: 20 }),
    },
    ...names.map((layer, i) => ({
      type: 'pcb_trace',
      pcb_trace_id: `t${i}`,
      route: [
        { route_type: 'wire', x: -5, y: i, layer, ...(options.widthless ? {} : { width: 0.2 }) },
        { route_type: 'wire', x: 5, y: i, layer, ...(options.widthless ? {} : { width: 0.2 }) },
        { route_type: 'via', x: 5, y: i, from_layer: layer, to_layer: names.at(-1) },
      ],
    })),
    { type: 'pcb_via', pcb_via_id: 'v', x: 5, y: 0, outer_diameter: 0.6, hole_diameter: 0.3, layers: names },
  ]
  if (options.pours !== false)
    records.push(
      { type: 'pcb_copper_pour', pcb_copper_pour_id: 'p0', shape: 'polygon', layer: names.at(-1), points: [{ x: -8, y: -8 }, { x: 8, y: -8 }, { x: 0, y: 8 }] },
      { type: 'pcb_copper_pour', pcb_copper_pour_id: 'p1', shape: 'rect', layer: names[0], center: { x: 0, y: 0 }, width: 4, height: 2 },
      {
        type: 'pcb_copper_pour',
        pcb_copper_pour_id: 'p2',
        shape: 'brep',
        layer: names[0],
        brep_shape: { outer_ring: { vertices: [{ x: 9, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 3 }] }, inner_rings: [{ vertices: [{ x: 10, y: 1 }, { x: 11, y: 1 }, { x: 11, y: 2 }] }] },
      },
    )
  if (options.parts !== false)
    records.push(
      { type: 'pcb_component', pcb_component_id: 'c', center: { x: -5, y: 0 }, width: 2, height: 3, rotation: 90, layer: 'top' },
      { type: 'pcb_smtpad', pcb_smtpad_id: 's0', shape: 'rect', layer: 'top', x: -5, y: 0, width: 0.6, height: 0.4 },
      { type: 'pcb_smtpad', pcb_smtpad_id: 's1', shape: 'circle', layer: 'top', x: -5, y: 1, radius: 0.3 },
      { type: 'pcb_plated_hole', pcb_plated_hole_id: 'h0', shape: 'pill', x: 0, y: 4, outer_width: 1, outer_height: 2, hole_width: 0.5, hole_height: 1.4, layers: names },
      { type: 'pcb_plated_hole', pcb_plated_hole_id: 'h1', shape: 'circle', x: 2, y: 4, outer_diameter: 1, hole_diameter: 0.5, layers: names },
      { type: 'pcb_hole', pcb_hole_id: 'h2', hole_shape: 'circle', x: 4, y: 4, hole_diameter: 1 },
      { type: 'pcb_silkscreen_path', pcb_silkscreen_path_id: 'sp', layer: 'top', route: [{ x: -6, y: -1 }, { x: -4, y: -1 }], stroke_width: 0.1 },
      { type: 'pcb_silkscreen_text', pcb_silkscreen_text_id: 'st', layer: 'top', text: 'REF', anchor_position: { x: -5, y: 2 }, font_size: 0.6 },
    )
  return records as unknown as CircuitJson
}

/** Non-empty drawing with finite, non-degenerate bounds. */
export function assertDrawable(drawing: GraphicsObject, name: string): void {
  const count = Object.values(drawing).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0)
  assert.ok(count > 0, `${name}: empty`)
  const bounds = getBounds(drawing)
  assert.ok(Object.values(bounds).every(Number.isFinite), `${name}: nonfinite bounds`)
  assert.ok(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY, `${name}: degenerate bounds`)
  for (const line of drawing.lines ?? []) assert.ok(line.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) && Number.isFinite(line.strokeWidth ?? 1), `${name}: nonfinite line`)
}

