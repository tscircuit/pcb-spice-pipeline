import { polygonContains, type GeometryCell, type ExtractionSettings, type CopperXYZ as XYZ } from '../board'
import { pathSolids, surfacePanels, copperPanelSizing } from './mesh'

/** Read a panel's vertices and outward unit normal. Copper and slab surfaces are outward wound. */
function panel(row: string): { points: XYZ[]; center: XYZ; normal: XYZ } {
  const values = row.split(' ').slice(2).map(Number)
  const points = Array.from({ length: values.length / 3 }, (_, i) => values.slice(i * 3, i * 3 + 3) as XYZ)
  const [a, b, c] = points
  const u = b.map((v, i) => v - a[i])
  const v = c.map((v, i) => v - a[i])
  const cross: XYZ = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const length = Math.hypot(...cross)
  return { points, center: [0, 1, 2].map(i => points.reduce((sum, p) => sum + p[i], 0) / points.length) as XYZ, normal: cross.map(v => v / length) as XYZ }
}

/** Physical finite-board dielectric interfaces; conductor faces are assigned their adjacent medium. */
export function layeredCapacitanceDeck(cell: GeometryCell, extraction?: Pick<ExtractionSettings, 'maxPanelLengthMm'>): Record<string, string> {
  const copper = (cell.routedCopper ?? cell.capacitanceCopper)!
  const dielectric = cell.dielectric!
  const files: Record<string, string> = {}
  const list = ['* Actual copper and finite layered dielectric in millimetres; raw capacitance * 0.001 = F']
  const solids = [...copper.signals.map(pathSolids), [...copper.pours, ...copper.connections.flatMap(pathSolids)]]
  const all = solids.flat()
  const layers = dielectric.layers
  if (layers.some(layer => !layer.relativePermittivity || layer.relativePermittivity < 1)) throw new Error('Every dielectric layer needs a physical relative permittivity')
  const cuts = layers.flatMap(layer => [layer.zMinMm, layer.zMaxMm])
  const sizing = extraction ? copperPanelSizing(copper, extraction.maxPanelLengthMm) : undefined
  const interfaceSizing = extraction ? copperPanelSizing({ ...copper, signals: [...copper.signals, ...copper.connections] }, extraction.maxPanelLengthMm) : undefined
  /** Material at a point just outside an oriented panel, including finite board edges. */
  const medium = (point: XYZ): number => polygonContains([point[0], point[1]], dielectric.polygon)
    ? layers.find(layer => point[2] > layer.zMinMm && point[2] < layer.zMaxMm)?.relativePermittivity ?? 1 : 1
  /** Offset by a sub-nanometre amount, far below the smallest declared copper thickness. */
  const beside = (center: XYZ, normal: XYZ, sign: number): XYZ => center.map((v, i) => v + sign * normal[i] * 1e-7) as XYZ
  solids.forEach((pieces, i) => {
    const name = i === copper.signals.length ? 'return' : `sig${i}`
    const groups = new Map<number, string[]>()
    for (const row of surfacePanels(pieces, name, sizing, [], cuts).split('\n').filter(row => /^[TQ] /.test(row))) {
      const { center, normal } = panel(row)
      const er = medium(beside(center, normal, 1))
      if (!groups.has(er)) groups.set(er, [])
      groups.get(er)!.push(row)
    }
    // '+' connects successive surface files into the same physical conductor.
    const entries = [...groups].sort(([a], [b]) => a - b)
    entries.forEach(([er, rows], j) => {
      const file = j ? `${name}-${j}.txt` : `${name}.txt`
      files[file] = '* Conductor faces in one adjacent medium; millimetres\n' + rows.join('\n') + '\n'
      list.push(`C ${file} ${er} 0 0 0${j < entries.length - 1 ? ' +' : ''}`)
    })
  })
  layers.forEach((layer, i) => {
    const groups = new Map<string, { rows: string[]; er: number; reference: XYZ }>()
    const slab = { ...layer, polygon: dielectric.polygon }
    for (const row of surfacePanels([slab], `diel${i}`, interfaceSizing, all, cuts).split('\n').filter(row => /^[TQ] /.test(row))) {
      const { center, normal } = panel(row)
      const outside = beside(center, normal, 1)
      // Copper/dielectric contacts are C faces, never duplicate D faces.
      if (all.some(s => outside[2] > s.zMinMm && outside[2] < s.zMaxMm && polygonContains([outside[0], outside[1]], s.polygon))) continue
      const er = medium(outside)
      if (er === layer.relativePermittivity) continue
      // An interface shared by two layers is emitted once, by the lower layer.
      if (er !== 1 && normal[2] < 0) continue
      const key = [er, ...normal, normal.reduce((sum, v, j) => sum + v * center[j], 0)].map(v => v.toFixed(8)).join(',')
      if (!groups.has(key)) groups.set(key, { rows: [], er, reference: center.map((v, j) => v - normal[j] * .01) as XYZ })
      groups.get(key)!.rows.push(row)
    }
    ;[...groups.values()].forEach(({ rows, er, reference }, j) => {
      const file = `dielectric-${i}-${j}.txt`
      files[file] = '* Dielectric interface only; millimetres\n' + rows.join('\n') + '\n'
      list.push(`D ${file} ${er} ${layer.relativePermittivity} 0 0 0 ${reference.join(' ')} -`)
    })
  })
  files['channel.lst'] = list.join('\n') + '\n'
  return files
}
