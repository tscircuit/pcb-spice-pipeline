import { convertCircuitJsonToPcbSvg, type PcbColorOverrides } from 'circuit-to-svg'
import { getBounds, getSvgFromGraphicsObject, type GraphicsObject, type Viewbox } from 'graphics-debug'
import type { CircuitJson } from './schema'
import { routeBoardBox, routeBounds } from './route-visual'

/** Dark, desaturated board colours so bright stage overlays stand out on a realistic top view. */
export const boardColors = {
  background: '#0c0f12',
  overrides: {
    copper: { top: '#8c7a4e', bottom: '#8c7a4e' },
    drill: '#07090a',
    silkscreen: { top: '#5d665f', bottom: '#5d665f' },
    boardOutline: '#58665e',
    soldermask: { top: '#0f2a1e', bottom: '#0f2a1e' },
    soldermaskOverCopper: { top: '#1d4532', bottom: '#1d4532' },
    soldermaskWithCopperUnderneath: { top: '#163a29', bottom: '#163a29' },
  } satisfies PcbColorOverrides,
}

export interface BoardPicture {
  /** The real board from circuit-to-svg, cropped to the camera and letterboxed. */
  board: string
  /** The stage drawing with a transparent background, pixel-aligned with the board. */
  overlay: string
}

/** The camera: the drawing's `camera` frame, else its bounds with a margin, else the whole board. */
export function boardPictureView(circuit: CircuitJson, drawing: GraphicsObject): Viewbox {
  const frame = drawing.rects?.find((rect) => rect.label === 'camera')
  if (frame) return { minX: frame.center.x - frame.width / 2, maxX: frame.center.x + frame.width / 2, minY: frame.center.y - frame.height / 2, maxY: frame.center.y + frame.height / 2 }
  const empty = !(['lines', 'rects', 'circles', 'polygons', 'points', 'texts'] as const).some((key) => drawing[key]?.length)
  const box = empty ? routeBoardBox(circuit) : getBounds(drawing)
  const margin = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-3) * 0.04
  return { minX: box.minX - margin, maxX: box.maxX + margin, minY: box.minY - margin, maxY: box.maxY + margin }
}

/** Every coordinate a record carries, whatever its shape. */
function recordPoints(record: object): { x: number; y: number }[] {
  const value = record as Record<string, unknown>
  /** Whether a value is a point with numeric x and y. */
  const point = (item: unknown): item is { x: number; y: number } => typeof item === 'object' && item !== null && typeof (item as { x?: unknown }).x === 'number' && typeof (item as { y?: unknown }).y === 'number'
  return [value, value.center, value.anchor_position, ...[value.route, value.points, value.outline].flatMap((list) => (Array.isArray(list) ? list : []))].filter(point)
}

const crops = new WeakMap<CircuitJson, Map<string, CircuitJson>>()

/** Only records near the camera reach circuit-to-svg, and silkscreen text never does, so the board layer stays small and wordless. */
function cropCircuit(circuit: CircuitJson, view: Viewbox): CircuitJson {
  const key = JSON.stringify(view)
  const cache = crops.get(circuit) ?? new Map<string, CircuitJson>()
  crops.set(circuit, cache)
  const margin = Math.max(view.maxX - view.minX, view.maxY - view.minY) * 0.1
  const cropped =
    cache.get(key) ??
    circuit.filter((record) => {
      if (record.type === 'pcb_silkscreen_text' || record.type.startsWith('pcb_fabrication_note')) return false
      if (!record.type.startsWith('pcb_') || record.type === 'pcb_board' || record.type === 'pcb_copper_pour') return true
      const box = routeBounds(recordPoints(record))
      return !box || (box.maxX >= view.minX - margin && box.minX <= view.maxX + margin && box.maxY >= view.minY - margin && box.minY <= view.maxY + margin)
    })
  cache.set(key, cropped)
  if (cache.size > 6) cache.delete(cache.keys().next().value!)
  return cropped
}

const boards = new WeakMap<CircuitJson, Map<string, string>>()

/** circuit-to-svg is the slow part on large boards, so keep the last few cameras per board. */
function boardSvg(circuit: CircuitJson, view: Viewbox, width: number, height: number): string {
  const cache = boards.get(circuit) ?? new Map<string, string>()
  boards.set(circuit, cache)
  const key = JSON.stringify([view, width, height])
  const svg =
    cache.get(key) ??
    convertCircuitJsonToPcbSvg(cropCircuit(circuit, view) as Parameters<typeof convertCircuitJsonToPcbSvg>[0], {
      width,
      height,
      viewport: view,
      layer: 'top',
      showSolderMask: true,
      showFabricationNotes: false,
      backgroundColor: boardColors.background,
      colorOverrides: boardColors.overrides,
    })
  cache.set(key, svg)
  if (cache.size > 6) cache.delete(cache.keys().next().value!)
  return svg
}

/**
 * The real board under a stage drawing, both cropped to one camera and letterboxed in width × height.
 * `region` zooms into part of the camera; labels keep their on-screen size.
 */
export function boardPicture(circuit: CircuitJson, drawing: GraphicsObject, width: number, height: number, region?: Viewbox): BoardPicture {
  const camera = boardPictureView(circuit, drawing)
  const view = region ?? camera
  const scale = Math.min(width / (view.maxX - view.minX), height / (view.maxY - view.minY))
  const pictureWidth = (view.maxX - view.minX) * scale
  const pictureHeight = (view.maxY - view.minY) * scale
  const left = (width - pictureWidth) / 2
  const top = (height - pictureHeight) / 2
  const zoom = (view.maxX - view.minX) / (camera.maxX - camera.minX)
  const frame = { center: { x: (view.minX + view.maxX) / 2, y: (view.minY + view.maxY) / 2 }, width: view.maxX - view.minX, height: view.maxY - view.minY, fill: 'none', stroke: 'none', label: 'camera' }
  const raw = getSvgFromGraphicsObject(
    { ...drawing, rects: [...(drawing.rects ?? []).filter((rect) => rect.label !== 'camera'), frame], texts: drawing.texts?.map((text) => ({ ...text, fontSize: (text.fontSize ?? 1) * zoom })) },
    { svgWidth: pictureWidth, svgHeight: pictureHeight, backgroundColor: null },
  )
  // Wherever graphics-debug placed the frame, crop the overlay to it: objects outside the camera never move it.
  const rect = /<rect[^>]*data-label="camera"[^>]*>/.exec(raw)![0]
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) => Number(new RegExp(` ${name}="([^"]+)"`).exec(rect)![1]))
  const unit = w / pictureWidth
  const overlay = raw.replace(/^<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x - left * unit} ${y - top * unit} ${width * unit} ${height * unit}">`)
  const board = boardSvg(circuit, view, pictureWidth, pictureHeight).replace(/^<svg /, `<svg x="${left}" y="${top}" `)
  return {
    board: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${boardColors.background}"/>${board}</svg>`,
    overlay,
  }
}

/** Both layers as one standalone SVG, for PNG renders and snapshots. */
export function boardPictureSvg(circuit: CircuitJson, drawing: GraphicsObject, width: number, height: number): string {
  const picture = boardPicture(circuit, drawing, width, height)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${picture.board}${picture.overlay}</svg>`
}
