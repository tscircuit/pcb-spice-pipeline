import { readFile } from 'node:fs/promises'
import type { CircuitJson } from '../../src/board'
import { withDdr3Signals, type Ddr3Options } from '../../examples/routed/ddr3-signals'
export { addrCmdPins } from '../../examples/routed/ddr3-signals'
export type { Ddr3Options } from '../../examples/routed/ddr3-signals'

/** Node file loading delegates all TSX declarations and identity remapping to the browser-safe fixture. */
export async function fullBoardDdr3(path: string, options: Ddr3Options = {}): Promise<CircuitJson> {
  const board: CircuitJson = JSON.parse(await readFile(path, 'utf8'))
  const sources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/${file}`)])))
  return withDdr3Signals(board, sources, options)
}
