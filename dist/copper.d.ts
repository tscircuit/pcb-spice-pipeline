import type { CircuitJson } from './schema.js';
import type { ExtractionSettings, Geometry, GeometryCell, LaneMapping, ResolvedModeling } from './geometry.js';
type Point = [number, number];
type XYZ = [number, number, number];
type Polygon = Point[][];
type Solid = {
    polygon: Polygon;
    zMinMm: number;
    zMaxMm: number;
    conductivitySm?: number;
};
type Segment = {
    conductivitySm?: number;
    a: XYZ;
    b: XYZ;
    widthMm: number;
    thicknessMm: number;
};
type Path = {
    segments: Segment[];
    terminals: [XYZ, XYZ];
    contactRadiusMm?: number;
};
export declare const copperCapacitanceScaleToFarads = 0.001;
export interface RoutedCopper {
    sourceNetId: string;
    sourceNetName: string;
    referenceSourcePortIds: string[];
    pours: Array<Solid & {
        pcbCopperPourId: string;
        layer: string;
    }>;
    signals: Path[];
    connections: Path[];
}
/** Resolve net membership through electrical connections, never copper proximity. */
export declare function connectedSourceIds(circuit: CircuitJson, seed: string): Set<string>;
export declare function routedCopperGeometry(circuit: CircuitJson, m: ResolvedModeling, mappings: LaneMapping[]): Geometry;
/** Same edge-strip discretization as a rectangular plane mesh, refined locally
 * around boundaries and finite contacts. Every retained cell lies inside copper.
 * Adjacent cells contribute half their transverse width to their shared edge.
 */
export declare function groundMesh(pour: Solid, meshMm: number, contacts: Array<{
    point: Point;
    radius: number;
}>, contactDivisions?: number): {
    points: Point[];
    edges: [number, number, number][];
    contacts: number[][];
};
/** FastHenry conductor mesh follows the selected polygon, including every cutout. */
export declare function copperFastHenryDeck(cell: GeometryCell, extraction: ExtractionSettings): string;
export declare function copperFasterCapDeck(cell: GeometryCell): Record<string, string>;
export {};
