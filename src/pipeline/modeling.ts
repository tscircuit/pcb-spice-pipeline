import type { BoardModeling } from '../board'
import type { ExtractionModeling } from '../extraction'
import type { SimulationModeling } from '../simulation'
import type { DdrModeling } from '../ddr'
import type { BufferModeling } from '../buffers'
/** Private solver settings derived from the board and selected IBIS buffers. */
export type NumericalSettings = BoardModeling & ExtractionModeling & SimulationModeling & DdrModeling & BufferModeling
