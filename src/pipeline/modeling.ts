import type { CopperScope, LaneModeling } from '../board'
import type { SimulationModeling } from '../simulation'
/** Private routed admission settings derived from the board and selected IBIS buffers. */
export type NumericalSettings = SimulationModeling & { lanes: LaneModeling[]; copperScope: CopperScope }
