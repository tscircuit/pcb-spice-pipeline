import type { Geometry, GeometryCell } from './types'

/** Reduce verified straight parallel copper to bars using its actual coordinates, never signal order. */
export function parallelCopperGeometry(geometry: Geometry): Geometry {
  const copper = geometry.cells[0]?.routedCopper
  if (!copper || copper.pours.length !== 1 || copper.connections.some(path => path.segments.length)) return geometry
  const pour = copper.pours[0]
  if (pour.polygon.length !== 1 || pour.polygon[0].length !== 4) return geometry
  const paths = copper.signals.map(path => path.segments)
  if (paths.some(path => path.length !== 1 || Math.abs(path[0].a[1] - path[0].b[1]) > 1e-8 || Math.abs(path[0].a[2] - path[0].b[2]) > 1e-8)) return geometry
  const x = pour.polygon[0].map(p => p[0])
  const y = pour.polygon[0].map(p => p[1])
  const minX = Math.min(...x)
  const maxX = Math.max(...x)
  const minY = Math.min(...y)
  const maxY = Math.max(...y)
  if (pour.polygon[0].some(p => ![minX, maxX].includes(p[0]) || ![minY, maxY].includes(p[1]))) return geometry
  if (paths.some(([path]) => Math.abs(path.a[0] - minX) > 1e-4 || Math.abs(path.b[0] - maxX) > 1e-4)) return geometry
  if (copper.connections.length !== 2 || Math.abs(copper.connections[0].terminals[0][0] - minX) > 1e-4 || Math.abs(copper.connections[1].terminals[0][0] - maxX) > 1e-4) return geometry
  const cell: GeometryCell = { ...geometry.cells[0], profile: 'parallel-routed-copper', conductors: paths.map(([path], index) => ({ name: `sig${index}`,
    lengthM: (maxX - minX) / 1000, widthM: path.widthMm / 1000, thicknessM: path.thicknessMm / 1000,
    yM: path.a[1] / 1000, zM: path.a[2] / 1000, conductivitySm: path.conductivitySm })) }
  cell.capacitanceCopper = cell.routedCopper
  delete cell.routedCopper
  cell.conductors.push({ name: 'return', lengthM: (maxX - minX) / 1000, widthM: (maxY - minY) / 1000,
    thicknessM: (pour.zMaxMm - pour.zMinMm) / 1000, yM: (minY + maxY) / 2000, zM: (pour.zMinMm + pour.zMaxMm) / 2000, conductivitySm: pour.conductivitySm })
  return { ...geometry, cells: [cell], approximations: [
    'Automatically verified straight parallel traces and rectangular return with matching endpoints; bar dimensions and positions are the actual routed copper coordinates',
    'Uniform current injection across each return end; finite pad contact crowding omitted by the automatic parallel-bar reduction',
    'Finite layered dielectric for capacitance, constant-frequency R/L and uniform pi sections; dielectric loss, roughness and frequency dispersion are not fitted',
  ] }
}
