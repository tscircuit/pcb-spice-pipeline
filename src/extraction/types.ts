import type { GeometryCell, SegmentPort } from '../board'
import type { BemResult } from './bem'
import type { Matrix } from './linalg'
export type { Matrix }
/** Derived from IBIS edges and declared bit timing, never a public extraction setting. */
export interface ExtractionModeling { riseTimeSeconds: number; bitRateHz: number }
export interface LossFit { poles: number[]; weights: number[]; relativeRms: number; maxRelative: number }
export interface ExtractedStage {
  stage: number; profile: string; lengthM: number; ports: SegmentPort[]; cells: number
  R: Matrix; L: Matrix; C: Matrix; C0: Matrix; G: Matrix
  units: { R: 'ohm'; L: 'H'; C: 'F'; G: 'S' }; frequencyHz: number
  band: ExtractionModeling; frequenciesHz: number[]
  spectrum: { frequencyHz: number; R: Matrix; L: Matrix; C: Matrix; G: Matrix }[]
  skin: { terms: { matrix: Matrix; fit: LossFit; thicknessM?: number; conductivitySm?: number }[] }; dielectric: { matrix: Matrix; fit: LossFit }
  mesh: BemResult['steps']
  sliceHash: string; geometry: GeometryCell
}
export type ChannelMatrices = ExtractedStage[]
export interface ExtractedChannel { readonly matrices: ChannelMatrices; readonly spice: string }
