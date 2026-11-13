import { convertCircuitJsonToPcbSvg, type PcbColorOverrides } from 'circuit-to-svg'
import { getBounds, getSvgFromGraphicsObject, type GraphicsObject, type Viewbox } from 'graphics-debug'
import type { CircuitJson } from './schema'

/** graphics-debug's fixed SVG margin in pixels; the camera reproduces its projection exactly. */
const overlayMargin = 40

/** Dark, desaturated board colours so bright stage overlays stand out on a realistic top view. */
export const boardColors = {
  background: '#0c0f12',
  overrides: {
    copper: { top: '#8c7a4e', bottom: '#8c7a4e' },
    drill: '#07090a',
    silkscreen: { top: '#8d968f', bottom: '#8d968f' },
    boardOutline: '#58665e',
    soldermask: { top: '#0f2a1e', bottom: '#0f2a1e' },
    soldermaskOverCopper: { top: '#1d4532', bottom: '#1d4532' },
    soldermaskWithCopperUnderneath: { top: '#163a29', bottom: '#163a29' },
  } satisfies PcbColorOverrides,
}

export interface BoardPicture {
  /** The real board, from circuit-to-svg, cropped to the camera. */
  board: string
  /** The stage drawing with a transparent background, pixel-aligned with the board. */
  overlay: string
}

/** Region worth showing: the drawing's bounds with a small margin, else the whole board outline. */
export function boardPictureView(circuit: CircuitJson, drawing: GraphicsObject): Viewbox {
  const empty = !['lines', 'rects', 'circles', 'polygons', 'points', 'texts'].some((key) => (drawing[key as keyof GraphicsObject] as unknown[] | undefined)?.length)
  const board = circuit.find((record) => record.type === 'pcb_board')
  const outline = board?.outline?.length
    ? board.outline
    : board
      ? [-1, 1].map((sign) => ({ x: board.center.x + (sign * (board.width ?? 0)) / 2, y: board.center.y + (sign * (board.height ?? 0)) / 2 }))
      : [{ x: -1, y: -1 }, { x: 1, y: 1 }]
  const bounds = empty
    ? { minX: Math.min(...outline.map((p) => p.x)), maxX: Math.max(...outline.map((p) => p.x)), minY: Math.min(...outline.map((p) => p.y)), maxY: Math.max(...outline.map((p) => p.y)) }
    : getBounds(drawing)
  const margin = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-3) * 0.04
  return { minX: bounds.minX - margin, maxX: bounds.maxX + margin, minY: bounds.minY - margin, maxY: bounds.maxY + margin }
}

/** The copper side to look at: the one carrying more of the drawing's layered lines. */
function boardSide(drawing: GraphicsObject): 'top' | 'bottom' {
  /** Lines drawn on one copper layer. */
  const count = (layer: string): number => (drawing.lines ?? []).filter((line) => line.layer === layer).length
  return count('bottom') > count('top') ? 'bottom' : 'top'
}

const boards = new WeakMap<CircuitJson, Map<string, string>>()

/** circuit-to-svg is the slow part on large boards, so keep the last few cameras per board. */
function boardSvg(circuit: CircuitJson, view: Viewbox, width: number, height: number, side: 'top' | 'bottom'): string {
  const cache = boards.get(circuit) ?? new Map<string, string>()
  boards.set(circuit, cache)
  const key = JSON.stringify([view, width, height, side])
  const cached = cache.get(key)
  if (cached) return cached
  const svg = convertCircuitJsonToPcbSvg(circuit as Parameters<typeof convertCircuitJsonToPcbSvg>[0], {
    width,
    height,
    viewport: view,
    layer: side,
    showSolderMask: true,
    backgroundColor: boardColors.background,
    colorOverrides: boardColors.overrides,
  })
  cache.set(key, svg)
  if (cache.size > 6) cache.delete(cache.keys().next().value!)
  return svg
}

/** The real board under a stage drawing: one camera in board mm (y up) for both layers. */
export function boardPicture(circuit: CircuitJson, drawing: GraphicsObject, width: number, height: number): BoardPicture {
  const content = boardPictureView(circuit, drawing)
  const scale = Math.min((width - 2 * overlayMargin) / (content.maxX - content.minX), (height - 2 * overlayMargin) / (content.maxY - content.minY))
  const center = { x: (content.minX + content.maxX) / 2, y: (content.minY + content.maxY) / 2 }
  // graphics-debug fits its bounds inside a fixed pixel margin; an invisible frame makes those bounds the camera.
  const frame = { center, width: (width - 2 * overlayMargin) / scale, height: (height - 2 * overlayMargin) / scale, fill: 'none', stroke: 'none' }
  const view = { minX: center.x - width / 2 / scale, maxX: center.x + width / 2 / scale, minY: center.y - height / 2 / scale, maxY: center.y + height / 2 / scale }
  return {
    board: boardSvg(circuit, view, width, height, boardSide(drawing)),
    overlay: getSvgFromGraphicsObject({ ...drawing, rects: [...(drawing.rects ?? []), frame] }, { svgWidth: width, svgHeight: height, backgroundColor: null }),
  }
}

/** Both layers as one standalone SVG, for PNG renders and snapshots. */
export function boardPictureSvg(circuit: CircuitJson, drawing: GraphicsObject, width: number, height: number): string {
  const picture = boardPicture(circuit, drawing, width, height)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${picture.board}${picture.overlay}</svg>`
}
