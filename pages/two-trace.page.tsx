import React from 'react'
import { TwoTraceBoard } from '../examples/routed/two-trace-board'
import { BoardPage } from '../site/debugger'

/** Keep the fixture callable so Cosmos 6 can load React 19 elements. */
export default function Page(): React.JSX.Element {
  return <BoardPage board-tree={<TwoTraceBoard />} models={['sn74lvc1g04.ibs']} />
}
