/** 2D extraction: layered BEM, automatic mesh and passive frequency-dependent RLGC networks. */
export type { ExtractionModeling, ExtractedChannel, ExtractedStage, ChannelMatrices, Matrix, LossFit } from './types'
export { extractChannel } from './extract'
export { channelSpice, type StageMatrices } from './rlgc'
export { solveCrossSection, matrixResidual, epsilon0, mu0, type BemResult } from './bem'
export { fitLoss, fittedLoss, fittedStorage } from './loss'
export { viaRlc } from './via'
export { validateMatrix, reciprocityResidual, type MatrixCheck } from './checks'
export { sum, maxAbs, scale, transpose, multiply, symmetrize, solve } from './linalg'
