import type { BoardProps } from '@tscircuit/props'

/** Deliberate example construction, in mm; these are board material data, not extraction settings. */
export const twoLayerStackup: NonNullable<BoardProps['pcbStackup']> = {plated_hole_copper_thickness:.025,layers:[
  {layer_type:'copper',layer:'top',thickness:.035,electrical_conductivity_s_per_m:5.8e7},
  {layer_type:'dielectric',thickness:1.53,relative_permittivity:4.1,loss_tangent:.02},
  {layer_type:'copper',layer:'bottom',thickness:.035,electrical_conductivity_s_per_m:5.8e7},
]}
/** Four-layer example includes the specified resin filling the etched internal copper layers. */
export const fourLayerStackup: NonNullable<BoardProps['pcbStackup']> = {plated_hole_copper_thickness:.025,layers:[
  twoLayerStackup.layers[0],
  {layer_type:'dielectric',thickness:.2,relative_permittivity:4.1,loss_tangent:.02},
  {layer_type:'copper',layer:'inner1',thickness:.018,electrical_conductivity_s_per_m:5.8e7,dielectric_fill_relative_permittivity:4.1,dielectric_fill_loss_tangent:.02},
  {layer_type:'dielectric',thickness:1.094,relative_permittivity:4.1,loss_tangent:.02},
  {layer_type:'copper',layer:'inner2',thickness:.018,electrical_conductivity_s_per_m:5.8e7,dielectric_fill_relative_permittivity:4.1,dielectric_fill_loss_tangent:.02},
  {layer_type:'dielectric',thickness:.2,relative_permittivity:4.1,loss_tangent:.02},
  twoLayerStackup.layers[2],
]}
