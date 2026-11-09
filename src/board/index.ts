/** Physical board admission, material construction, connectivity and whole-board slices. */
export type { CircuitJson, SimulationExperiment, SimulationIbisModel, SimulationIbisPinState, SimulationDigitalStimulus } from './schema'
export { parseRecord, recordSchema, validateCircuitRecords } from './schema'
export { type Board, admitBoard, circuitArtifact } from './model'
export { type BoardStackup, type CopperLayer, type DielectricLayer, stackupFromCircuitJson } from './stackup'
export { subcircuitTree, type SubcircuitTree } from './subcircuit'
export { connectedSourceIds } from './connectivity'
export type { PortSelector, LaneModeling, BoardModeling, Modeling, RouteStage, SourcePort, PcbTrace, RoutePoint, RoutedPoint,
  LaneMapping, GeometryCell, Geometry, ChannelGeometry, CopperPoint, CopperXYZ, CopperPolygon, CrossSection, SliceConductor, SliceDielectric, SegmentPort, ViaModel } from './geometry/types'
export { selectPort, resolveRouteVias } from './geometry/ports'
export { polygonContains, ringArea, closeRing } from './geometry/polygon'
export { validateModeling, geometryFromCircuitJson, channelGeometry, boardGround } from './geometry'
export { sliceIntervals, wirePolygon, mergeConductors } from './geometry/slices'

export { channelIntent } from './schema'
