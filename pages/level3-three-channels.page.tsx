import React from 'react'
import Board from '../examples/level3-three-channels/level3-three-channels'
import { BoardPage } from '../site/debugger'

/** Keep the fixture callable so Cosmos 6 can load React 19 elements. */
export default function Page(): React.JSX.Element {
  return <BoardPage title="Level 3 · three channels" board-tree={<Board />} models={['sn74lvc1g04.ibs']} />
}
