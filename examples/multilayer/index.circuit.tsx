import { makeBoard, modeling as three } from '../crosstalk/index.circuit'
export const modeling = { ...three, lanes: [three.lanes[0]] }
export const circuitJson = await makeBoard(false, true)
