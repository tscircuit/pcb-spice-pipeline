/**
 * extraction — what the channel is electrically.
 * Owns: quasi-TEM 2D cross-section extraction (field solve, per-unit-length RLGC, causal loss),
 * per-route section lines and coupling (RouteFieldsSolver), and the matrix checks they need.
 * Imports: kernel, board.
 */
export type { Matrix } from './linalg'
export { validateMatrix, type MatrixCheck } from './checks'
export { sum, transpose, multiply, symmetrize } from './linalg'
export { solveCrossSection, solveSectionCapacitance, type CrossSection, type CrossSectionOptions, type CrossSectionResult, type SectionConductor, type SectionPlane, type SectionDielectric } from './cross-section'
export { referenceSeries, routeCrossSection, closestRoutePoints, type ExtractedRoutes, type ExtractedRouteSlice, type RouteMaterials, type RouteCoefficients } from './route-lines'
export { causalLossPoles, causalLossResponse, type LossPole } from './causal-loss'

export { RouteFieldsSolver, type RouteFieldsInput } from './route-fields-solver'
