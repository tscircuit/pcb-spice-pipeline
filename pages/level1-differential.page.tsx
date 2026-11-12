import React from 'react'
import Board from '../examples/level1-differential/level1-differential'
import { BoardPage } from '../site/debugger'

/** Keep the fixture callable so Cosmos 6 can load React 19 elements. */
export default function Page(): React.JSX.Element {
  return <BoardPage title="Level 1 · differential" board-tree={<Board />} models={['sn65hvd72.ibs']} />
}
