import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderCoreSignals } from '../support/core-render'
import {
  boardFrame,
  boardViewerCircuit,
  boardPosition,
  boardSlicePose,
  boardSlicePosition,
  stackupFromCircuitJson,
  segmentRoutes,
} from '../../src/board'
import { routedCopper } from '../support/routed-fixture'

test('viewer keeps off-centre PCB x/y, z-up millimetres and every real layer depth', async () => {
  const circuit = await renderCoreSignals(
    <board width={12} height={8} pcbX={17} pcbY={-9} layers={4} fabricatorPreset="jlcpcb_standard" routeRemaining={false} />,
  )
  const stack = stackupFromCircuitJson(circuit)
  const frame = boardFrame(stack)
  for (const layer of stack.copperLayers) {
    assert.deepEqual(boardPosition(stack, 17, -9, layer.name), [17, -9, (layer.zMinMm + layer.zMaxMm) / 2 - frame.center])
  }
  assert.ok(boardPosition(stack, 0, 0, 'top')[2] > boardPosition(stack, 0, 0, 'inner1')[2])
  assert.ok(boardPosition(stack, 0, 0, 'inner1')[2] > boardPosition(stack, 0, 0, 'bottom')[2])
  assert.throws(() => boardPosition(stack, 0, 0, 'missing'), /Unknown copper/)
})

test('slice plane intersects real TSX copper at true width and stack height, including rotated routes', async () => {
  const { circuitJson, scope } = await routedCopper()
  const geometry = segmentRoutes(circuitJson, scope)
  const slice = geometry.slices[0]
  assert.ok(slice)
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const wire = { ...slice.wires[0], u: [Math.cos(angle), Math.sin(angle)] as [number, number], transverse: 2 }
    const rotated = { ...slice, wires: [wire], start: 3, end: 7 }
    const pose = boardSlicePose(geometry.stack, rotated)
    const dot = pose.transverse.reduce((sum, value, i) => sum + value * pose.normal[i], 0)
    assert.ok(Math.abs(dot) < 1e-12)
    const layer = geometry.stack.copperLayers.find((layer) => layer.name === wire.layer)!
    const point = boardSlicePosition(pose, 0, (layer.zMinMm + layer.zMaxMm) / 2)
    assert.deepEqual(point, boardPosition(geometry.stack, wire.u[0] * 5 - wire.u[1] * 2, wire.u[1] * 5 + wire.u[0] * 2, wire.layer))
    const across = boardSlicePosition(pose, wire.width, layer.zMinMm)
    const start = boardSlicePosition(pose, 0, layer.zMinMm)
    assert.ok(Math.abs(Math.hypot(...across.map((value, i) => value - start[i])) - wire.width) < 1e-12)
    assert.deepEqual(boardSlicePose(geometry.stack, rotated, -1), boardSlicePose(geometry.stack, rotated, 0))
    assert.deepEqual(boardSlicePose(geometry.stack, rotated, 2), boardSlicePose(geometry.stack, rotated, 1))
  }
})

test('viewer copies frozen input and keeps CAD on the physical stack surfaces when nominal thickness differs', async () => {
  const circuit = await renderCoreSignals(
    <board width={12} height={8} layers={4} fabricatorPreset="jlcpcb_standard" routeRemaining={false}>
      <resistor name="TOP" resistance="1k" footprint="0603" pcbX={-3} />
      <resistor name="BOTTOM" resistance="1k" footprint="0603" pcbX={3} layer="bottom" />
    </board>,
  )
  const before = JSON.stringify(circuit)
  Object.freeze(circuit)
  const copy = boardViewerCircuit(circuit)
  const frame = boardFrame(stackupFromCircuitJson(circuit))
  const oldBoard = circuit.find((record) => record.type === 'pcb_board')!
  const board = copy.find((record) => record.type === 'pcb_board')!
  assert.equal(board.thickness, frame.top - frame.bottom)
  assert.notEqual(copy, circuit)
  assert.equal(JSON.stringify(circuit), before)
  for (const cad of copy.filter((record) => record.type === 'cad_component')) {
    const previous = circuit.find((record) => record.type === 'cad_component' && record.cad_component_id === cad.cad_component_id)!
    if (previous.type !== 'cad_component') throw new Error('Missing CAD')
    const component = copy.find((record) => record.type === 'pcb_component' && record.pcb_component_id === cad.pcb_component_id)!
    if (component.type !== 'pcb_component') throw new Error('Missing component')
    const sign = component.layer === 'bottom' ? -1 : 1
    assert.ok(Math.abs(cad.position.z - (sign * board.thickness) / 2 - (previous.position.z - (sign * oldBoard.thickness) / 2)) < 1e-12)
  }
})
