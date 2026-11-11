import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { addrCmdPins, fullBoardDdr3 } from './full-board-ddr3'
import { prepareBlocks } from '../../src/pipeline/signals'

const path = process.env.SI_DDR3_BOARD

test('real DDR3 TSX declarations preserve copper and select the intended write and addr/cmd models', { skip: !path || !process.env.IBIS_MODEL_DIR }, async () => {
  const circuit = await fullBoardDdr3(path!)
  assert.equal(circuit.filter(record => record.type === 'simulation_signal').length, 10)
  assert.equal(circuit.filter(record => record.type === 'pcb_trace').length, 651)
  assert.equal(circuit.filter(record => record.type === 'pcb_via').length, 1210)
  const sources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR}/${file}`)])))
  assert.throws(() => prepareBlocks(circuit, sources), error => {
    const rejected = error as Error & { copperScope: import('../../src/board').CopperScope; warnings: string[] }
    assert.equal(rejected.message, 'Signal "RN5_INPUT_SYS4_CPU_PULL": branched routed graphs are not implemented yet.')
    assert.ok(rejected.warnings.some(warning => warning.includes('models/sprm552c.ibs SHA-256 23011a68eb8ff35562615b5b108edcb9f017c5e61f4f68e32f35c5fb88f163be') && warning.includes('negated 30450')))
    assert.equal(rejected.copperScope.selectedPcbTraceIds.length, 11)
    assert.ok(rejected.copperScope.omitted.traces > 400)
    assert.ok(rejected.copperScope.pcbTraceIds.length > 11, 'physically relevant neighbours must stay')
    return true
  })
  const addr = await fullBoardDdr3(path!, { block: 'DDR3_ADDR_CMD' })
  const original = JSON.parse(await readFile(path!, 'utf8')) as typeof addr
  assert.deepEqual(addr.slice(0, original.length), original)
  assert.equal(addr.filter(record => record.type === 'simulation_signal').length, 24)
  const [block] = prepareBlocks(addr, sources, '2d')
  assert.equal(block.block.name, 'DDR3_ADDR_CMD')
  assert.equal(block.duration, 8e-9)
  const [local] = prepareBlocks(addr, sources, '2d', 1)
  assert.equal(local.settings.copperScope!.lateralDistanceMm, 1)
  assert.deepEqual(local.settings.copperScope!.selectedPcbTraceIds, block.settings.copperScope!.selectedPcbTraceIds)
  assert.equal(local.settings.lanes.length, 24)
  assert.ok(local.settings.copperScope!.pcbTraceIds.length < block.settings.copperScope!.pcbTraceIds.length)
  for (const distance of [0, -1, NaN, Infinity, 33]) assert.throws(() => prepareBlocks(addr, sources, '2d', distance), /scope distance/)
  assert.deepEqual(new Set(block.signals.map(signal => signal.name)), new Set(addrCmdPins.map(([name]) => name)))
  for (const signal of block.signals) {
    assert.ok('source_port_id' in signal.driver)
    assert.equal(block.pins.get(signal.driver.source_port_id)!.buffer.name, signal.name === 'CK' || signal.name === 'CKn' ? 'Model_343' : 'Model_352')
    assert.ok('source_port_id' in signal.receivers[0])
    assert.equal(block.pins.get(signal.receivers[0].source_port_id)!.buffer.name, 'CMD')
  }
  const stack = addr.find(record => record.type === 'pcb_stackup')!
  assert.equal(stack.layers.filter(layer => layer.layer_type === 'copper').length, 8)
  assert.deepEqual(stack.layers.filter(layer => layer.layer_type === 'dielectric').map(layer => layer.thickness), [.0994, .2, .1088, .2, .1088, .2, .0994])
  assert.equal(stack.plated_hole_copper_thickness, .018)
})
