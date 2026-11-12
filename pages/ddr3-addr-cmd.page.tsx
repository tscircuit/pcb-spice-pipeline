import React from 'react'
import { withDdr3Signals } from '../examples/routed/ddr3-signals'
import { BoardPage, localAsset } from '../site/debugger'
import type { CircuitJson } from '../src/board'
import type { IbisSources } from '../src/buffers'

/** Keep the physical board local; preserve its copper while appending TSX addr/cmd declarations. */
async function loadBoard(sources: IbisSources): Promise<CircuitJson> {
  return withDdr3Signals(JSON.parse(await localAsset('ddr3-board.json')), sources, { block: 'DDR3_ADDR_CMD' })
}

/** Keep the fixture callable so Cosmos 6 can load React 19 elements. */
export default function Page(): React.JSX.Element {
  return (
    <BoardPage
      title="DDR3 · addr/cmd scope (24 nets)"
      load-board={loadBoard}
      models={['sprm552c.ibs', 'W631GG6MB-12.ibs']}
    />
  )
}
