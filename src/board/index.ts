/**
 * board — everything known about the physical board, read from Circuit JSON.
 * Owns: Circuit JSON admission (zod record schemas, subcircuit scope), stackup, port selection,
 * the channel copper scope, routed section geometry (RouteSectionsSolver) and board drawings.
 * Imports: kernel.
 */
export type { CircuitJson, SimulationExperiment, SimulationIbisModel, SimulationIbisPinState, SimulationDigitalStimulus } from './schema'
export { recordSchema, validateCircuitRecords } from './schema'
export { type BoardStackup, type CopperLayer, type DielectricLayer, stackupFromCircuitJson, defaultCopperConductivitySm } from './stackup'
export { subcircuitTree, type SubcircuitTree } from './subcircuit'
export { connectedSourceIds } from './connectivity'
export { channelCopperScope, type CopperScope } from './geometry/scope'
export type { PortSelector, LaneModeling, SourcePort, PcbTrace, RoutePoint, RoutedPoint, LaneMapping, CopperPoint, CopperPolygon } from './geometry/types'
export { selectPort, resolveRouteVias } from './geometry/ports'
export { polygonContains } from './geometry/polygon'

export type { SimulationSignalIntegrity, SimulationSignal, SignalEndpoint } from './signals'
export { isQuiet } from './signals'
export { segmentRoutes, routePosition, routeContactFrame, routeReferences, type SectionGeometry, type RouteWire, type RouteSlice, type RouteReference, type RouteXY } from './route-sections'

export { routeSectionSteps } from './route-sections'
export {
  routeTones, routeHue, routeBounds, routeDisplayItems, routeFrame, routeView, routeCanvas, routeStroke, routeNets, routeMarks, routeVia,
  routePortPoint, routeText, routePane, routeFailure, routeBoardBox, routeBoardDrawing, routePinDirection, routeBuffers, routeOutline, routeStrip, routeLengths, routeUnrolled, type RouteStripRow, type RouteNet, type RouteFrame, type RouteView,
} from './route-visual'
export { RouteSectionsSolver, type RouteSectionsInput, type RoutedSections } from './route-sections-solver'
