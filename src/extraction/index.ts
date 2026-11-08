/** 2D extraction: layered BEM, automatic mesh and passive frequency-dependent RLGC networks. */
export type { ExtractionModeling, ExtractedChannel, ExtractedStage, ChannelMatrices, Matrix, LossFit } from './types'
export { extractChannel } from './extract'
export { channelSpice, type StageMatrices } from './rlgc'
export { solveCrossSection, matrixResidual, epsilon0, mu0, type BemResult } from './bem'
export { fitLoss, fittedLoss } from './loss'
export { viaRlc } from './via'
export { validateMatrix, loopImpedance, referenceCapacitance, type MatrixCheck, type CapacitanceCheck } from './checks'
export { sum, scale, transpose, multiply, symmetrize, solve } from './linalg'
