import React from 'react'
import Board from '../examples/level1-single-ended/level1-single-ended'
import { BoardPage } from '../site/debugger'

/** Keep the fixture callable so Cosmos 6 can load React 19 elements. */
export default function Page(): React.JSX.Element {
  return <BoardPage board-tree={<Board />} models={['sn74lvc1g04.ibs']} />
}
