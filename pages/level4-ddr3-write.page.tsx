import React from 'react'
import Board from '../examples/level4-ddr3-write/level4-ddr3-write'
import { BoardPage } from '../site/debugger'

/** Keep the fixture callable so Cosmos 6 can load React 19 elements. */
export default function Page(): React.JSX.Element {
  return <BoardPage board-tree={<Board />} models={['sprm552c.ibs', 'W631GG6MB-12.ibs']} />
}
