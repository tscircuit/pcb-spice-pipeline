import { type RunSolver, type FileMap } from './solver.js';
import type { Geometry, Modeling } from './geometry.js';
type Matrix = number[][];
export interface ImpedanceSample {
    frequencyHz: number;
    R: Matrix;
    L: Matrix;
}
export interface MatrixCheck {
    matrix: Matrix;
    reciprocityResidual: number;
    cholesky: Matrix;
}
export interface CapacitanceCheck extends MatrixCheck {
    denominator: number;
    convention: string;
}
export interface RefinementCheck {
    coarseFilaments: number;
    refinedFilaments: number;
    coarseGroundMeshMm?: number;
    refinedGroundMeshMm?: number;
    frequencyHz: number;
    definition: string;
    tolerance: number;
    R: number;
    L: number;
}
export declare function extractChannel(geometry: Geometry, modeling: Modeling, files: FileMap, runSolver: RunSolver, onProgress?: (message: string) => void): Promise<{
    stage: number;
    profile: string;
    R: Matrix;
    L: Matrix;
    C: Matrix;
    units: {
        R: string;
        L: string;
        C: string;
    };
    frequencyHz: number;
    primitiveOrder: string[];
    primitiveImpedance: ImpedanceSample[];
    modelPrimitiveImpedance: ImpedanceSample;
    primitiveCapacitance: Matrix;
    checks: {
        R: MatrixCheck;
        L: MatrixCheck;
        C: CapacitanceCheck;
        primitiveC: MatrixCheck;
        convergence: RefinementCheck;
        capConvergence: number;
        analyticResistanceOhm: number[];
        analyticResistanceRelativeErrors: number[];
        analyticFrequencyHz: number;
        analyticLoopResistanceOhm: Matrix | null;
        dcLoopResidual: number | null;
        energyResidual: number;
        neutralityResidual: number;
    };
    conversions: {
        impedance: string;
        capacitance: string;
        capacitanceSolverCoordinateUnits: string;
        capacitanceScaleToFarads: number;
        neutralityDenominatorF: number;
    };
}[]>;
export {};
