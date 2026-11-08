import type { CircuitJson } from 'circuit-json'
import { numerics } from '../kernel'
import { fail } from './diagnostics'

export interface CopperLayer { name: string; zMinMm: number; zMaxMm: number; conductivitySm: number }
export interface DielectricLayer { material?: string; zMinMm: number; zMaxMm: number; relativePermittivity: number; lossTangent: number }
export interface BoardStackup {
  pcbBoardId: string; copperLayers: CopperLayer[]; dielectrics: DielectricLayer[]; relativePermittivity: number; viaPlatingMm?: number
}
/** Validates a physical construction field without substituting a guessed material. */
function field(value: unknown, code: 'stackup_permittivity' | 'stackup_loss' | 'stackup_conductivity', label: string, zero: boolean = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (zero ? value < 0 : value <= 0)) fail(code, `pcb_stackup: ${label} is required`)
  return value
}
/** Validates thickness before it contributes to the physical coordinate origin or any layer boundary. */
function layerThickness(layer: { layer_type:string; thickness?:number }): number {
  if (typeof layer.thickness !== 'number' || !Number.isFinite(layer.thickness) || layer.thickness <= 0) fail('stackup', `${layer.layer_type}: positive finite physical thickness required`)
  return layer.thickness
}
/** Reads the original record: upstream schema parsers strip newer material fields. z=0 is bottom copper's upper face. */
export function stackupFromCircuitJson(circuit: CircuitJson): BoardStackup {
  const boards = circuit.filter(r => r.type === 'pcb_board')
  const records = circuit.filter(r => r.type === 'pcb_stackup')
  if (records.length !== 1 || boards.length !== 1 || records[0].pcb_board_id !== boards[0].pcb_board_id) fail('stackup', 'Expected one board and its pcb_stackup; set fabricatorPreset or supply physical construction')
  const record = records[0]
  const copper = record.layers.filter(r => r.layer_type === 'copper')
  if (copper.length !== boards[0].num_layers || new Set(copper.map(l => l.layer)).size !== copper.length) fail('stackup', 'Distinct copper layers must match pcb_board.num_layers')
  const bottom = record.layers.findLastIndex(layer => layer.layer_type === 'copper')
  let z = -record.layers.slice(bottom).reduce((sum, layer) => sum + layerThickness(layer), 0)
  const copperLayers: CopperLayer[] = []
  const dielectrics: DielectricLayer[] = []
  for (const layer of [...record.layers].reverse()) {
    const thicknessMm = layerThickness(layer)
    const lo = z
    z = Math.round((z + thicknessMm) * 10 ** numerics.stackupCoordinateDigits) / 10 ** numerics.stackupCoordinateDigits
    if (layer.layer_type === 'copper') copperLayers.push({ name: layer.layer, zMinMm: lo, zMaxMm: z,
      conductivitySm: field(layer.electrical_conductivity_s_per_m, 'stackup_conductivity', `${layer.layer}.electrical_conductivity_s_per_m`) })
    if (layer.layer_type === 'copper' && layer.layer !== 'top' && layer.layer !== 'bottom') dielectrics.push({material:'etched-layer fill',zMinMm:lo,zMaxMm:z,
      relativePermittivity:field(Reflect.get(layer,'dielectric_fill_relative_permittivity'),'stackup_permittivity',`${layer.layer}.dielectric_fill_relative_permittivity`),
      lossTangent:field(Reflect.get(layer,'dielectric_fill_loss_tangent'),'stackup_loss',`${layer.layer}.dielectric_fill_loss_tangent`,true)})
    else if (layer.layer_type !== 'copper') dielectrics.push({ material: layer.layer_type === 'dielectric' ? layer.material_name : 'soldermask', zMinMm: lo, zMaxMm: z,
      relativePermittivity: field(layer.relative_permittivity, 'stackup_permittivity', `${layer.layer_type}.relative_permittivity`),
      lossTangent: field(Reflect.get(layer, 'dielectric_loss_tangent') ?? Reflect.get(layer, 'loss_tangent'), 'stackup_loss', `${layer.layer_type}.dielectric_loss_tangent`, true) })
  }
  if (!dielectrics.length) fail('stackup_permittivity', 'pcb_stackup must contain dielectric construction')
  const thickness = dielectrics.reduce((s, d) => s + d.zMaxMm - d.zMinMm, 0)
  return { pcbBoardId: record.pcb_board_id, copperLayers, dielectrics, viaPlatingMm: record.plated_hole_copper_thickness,
    relativePermittivity: dielectrics.reduce((s, d) => s + d.relativePermittivity * (d.zMaxMm - d.zMinMm), 0) / thickness }
}
