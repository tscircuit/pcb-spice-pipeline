/** @param {string} code @param {string} message @returns {never} */
export function fail(code: string, message: string): never;
export function validateMatrix(a: any, name: any, tolerance?: number): {
    matrix: any;
    reciprocityResidual: number;
    cholesky: any;
};
export function loopImpedance(a: any): any;
export function referenceCapacitance(c: any): {
    denominator: any;
    convention: string;
    matrix: any;
    reciprocityResidual: number;
    cholesky: any;
};
export function parseFastHenry(text: any): {
    frequencyHz: number;
    R: any;
    L: any;
}[];
export function parseFasterCap(text: any): {
    names: any[];
    matrix: any;
    units: string;
};
export class Diagnostic extends Error {
    constructor(code: any, message: any);
    code: any;
}
export function sum(xs: any): any;
export function scale(a: any, k: any): any;
export function transpose(a: any): any;
export function multiply(a: any, b: any): any;
export function symmetrize(a: any): any;
