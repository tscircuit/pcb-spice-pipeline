/* tslint:disable */
/* eslint-disable */

export class Mesh {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    complete: boolean;
    points: Float64Array;
    triangles: Uint32Array;
}

export function triangulate(xy: Float64Array, segments: Uint32Array, min_angle: number, max_area: number, budget: number): Mesh;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_mesh_complete: (a: number) => number;
    readonly __wbg_get_mesh_points: (a: number, b: number) => void;
    readonly __wbg_get_mesh_triangles: (a: number, b: number) => void;
    readonly __wbg_mesh_free: (a: number, b: number) => void;
    readonly __wbg_set_mesh_complete: (a: number, b: number) => void;
    readonly __wbg_set_mesh_points: (a: number, b: number, c: number) => void;
    readonly __wbg_set_mesh_triangles: (a: number, b: number, c: number) => void;
    readonly triangulate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
