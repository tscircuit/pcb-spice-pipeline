/**
 * board — everything known about the physical board, read from Circuit JSON.
 * Owns: Circuit JSON admission (zod record schemas, subcircuit scope), stackup, port selection,
 * lane -> route resolution, and 3D routed copper geometry (with a guarded parallel-bar reduction,
 * stackup-derived returns; routed copper as UNMESHED mm polygons/paths). Never writes a deck:
 * meshing and decks are extraction's (they depend on ExtractionSettings and refinement).
 * Artifacts: inputs/circuit.json, geometry.json (today's `Geometry` bytes).
 * Imports: kernel. (Was: schema.ts, circuit-schema.mjs, stackup.ts, subcircuit-scope.ts,
 * geometry.ts minus decks, copper.ts minus meshing/decks, stage-returns.ts.)
 */
export type { CircuitJson, SimulationExperiment, SimulationIbisModel, SimulationIbisPinState, SimulationDigitalStimulus } from './schema'
export { parseRecord, recordSchema, validateCircuitRecords } from './schema'
export { type Board, admitBoard, preparedBoard, circuitArtifact } from './model'
export { type BoardStackup, type CopperLayer, type DielectricLayer, stackupFromCircuitJson, defaultCopperConductivitySm } from './stackup'
export { subcircuitTree, type SubcircuitTree } from './subcircuit'
export { connectedSourceIds } from './connectivity'
export { channelCopperScope, copperScopeRejections, type CopperScope } from './geometry/scope'
export type {
  PortSelector, ExtractionSettings, LaneModeling, BoardModeling, Modeling, ResolvedModeling,
  RouteStage, SourcePort, PcbTrace, RoutePoint, RoutedPoint, LaneMapping, Conductor, GeometryCell, Geometry, ChannelGeometry,
  RoutedCopper, CopperPoint, CopperXYZ, CopperPolygon, CopperSolid, CopperSegment, CopperPath, CopperPour,
} from './geometry/types'
export { selectPort, resolveRouteVias } from './geometry/ports'
export { polygonContains, ringArea, closeRing } from './geometry/polygon'
export { validateModeling, geometryFromCircuitJson, channelGeometry } from './geometry'

export type { SimulationSignalIntegrity, SimulationSignal, SignalEndpoint, SignalResult } from './signals'
export { isQuiet } from './signals'
export { segmentRoutes, routePosition, routeContactFrame, routeReferences, type SectionGeometry, type RouteWire, type RouteSlice, type RouteReference, type RouteXY } from './route-sections'

export { routeSectionSteps } from './route-sections'
export {
  routeTones, routeHue, routeBounds, routeDisplayItems, routeFrame, routeView, routeCanvas, routeStroke, routeNets, routeMarks, routeVia,
  routePortPoint, routeText, routePane, routeFailure, routeBoardBox, routeBoardDrawing, routePinDirection, routeBuffers, routeOutline, routeStrip, routeLengths, routeUnrolled, type RouteStripRow, type RouteNet, type RouteFrame, type RouteView,
} from './route-visual'
export { RouteSectionsSolver, type RouteSectionsInput, type RoutedSections } from './route-sections-solver'
