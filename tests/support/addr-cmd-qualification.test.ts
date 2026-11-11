import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { reducedCopperScope, withoutPackage, receiverTermination } from './addr-cmd-qualification'
import { fullBoardDdr3 } from './full-board-ddr3'
import { prepareBlocks } from '../../src/pipeline/signals'

test('reduced scope changes geometry admission while preserving real TSX quiet drivers and their complete physical paths', { skip: !process.env.SI_DDR3_BOARD || !process.env.IBIS_MODEL_DIR }, async () => {
  const names = ['A4', 'A5', 'A7', 'A9', 'A11', 'CASn']
  const circuit = await fullBoardDdr3(process.env.SI_DDR3_BOARD!, { block: 'DDR3_ADDR_CMD', activeNets: names })
  const signals = circuit.filter(record => record.type === 'simulation_signal')
  assert.equal(signals.length, 24)
  assert.equal(signals.filter(signal => signal.pattern === '0').length, 18)
  assert.ok(signals.filter(signal => names.includes(signal.name)).every(signal => signal.pattern === 'prbs7'))
  const sources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(`${process.env.IBIS_MODEL_DIR}/${file}`)])))
  const [block] = prepareBlocks(circuit, sources, '2d', 1)
  for (const signal of block.signals) {
    assert.ok('source_port_id' in signal.driver)
    const port = signal.driver.source_port_id
    const state = block.circuit.find(record => Reflect.get(record, 'type') === 'simulation_ibis_pin_state' && Reflect.get(record, 'source_port_id') === port)
    assert.ok(state)
    assert.equal(Reflect.get(state, 'is_output_enabled'), true, `${signal.name} must remain a driven channel, including constant-low controls`)
  }
  const original = block.settings.copperScope!
  const scope = reducedCopperScope(block, names, 1)
  assert.equal(scope.selectedPcbTraceIds.length, 6)
  assert.ok(scope.pcbTraceIds.length < original.pcbTraceIds.length)
  assert.ok(original.selectedPcbTraceIds.every(id => scope.pcbTraceIds.includes(id)))
  assert.equal(block.signals.length, 24)
  assert.strictEqual(block.settings.copperScope, original, 'scope construction must not change driver states or the prepared input')
  assert.throws(() => reducedCopperScope(block, ['unknown'], 1), /Unknown/)
  block.settings.copperScope = { ...original, selectedPcbTraceIds: [...original.selectedPcbTraceIds, 'missing-quiet-route'] }
  assert.throws(() => reducedCopperScope(block, names, 1), /omit a declared quiet channel/)
})

test('package-off keeps die capacitance, switching and rail sources while bypassing scalar and coupled package branches', () => {
  const source = ['VPDN24 DIE24 0 0', 'VPKGS0 PAD0 PKGS0 0', 'RPKG0 PKGS0 PKGR0 .2', 'LPKG0 PKGR0 PKGD0 5e-9',
    'KPKG0_1 LPKG0 LPKG1 .6', 'CPKG0a PAD0 DIE24 3e-13', 'HPKG0_1 PKGR0 PKGR0_1 VPKGS1 .01',
    'RPKGU24 REF0 PKGUR24 .16', 'LPKGU24 PKGUR24 PKGUL24 4e-9', 'VPKG24 PKGUL24 DIE24 0',
    'CCOMP PAD PD_REF 1.2e-12', 'BPD PAD PD_REF I=v(KD)*v(PAD)', 'VKD KD 0 PWL(0 1 1e-9 0)'].join('\n')
  const result = withoutPackage(source)
  assert.doesNotMatch(result, /^[CKHL]PKG/m)
  assert.match(result, /RIDEALLPKG0 PKGR0 PKGD0 1e-6/)
  assert.match(result, /RIDEALLPKGU24 PKGUR24 PKGUL24 1e-6/)
  for (const line of source.split('\n').filter(line => /^(V|CCOMP|BPD)/.test(line))) assert.ok(result.includes(line))
})

test('VTT loads actual receiver balls once and leaves both clock legs alone', () => {
  const result = receiverTermination('title\n.control\nquit\n.endc\n.end\n', [{ name: 'A4_0', signalNode: 'ball' }, { name: 'CK_0', signalNode: 'clock' }, { name: 'CKn_0', signalNode: 'clockn' }, { name: 'A4_1', signalNode: 'driver' }], 50)
  assert.match(result, /VWHATIFVTT whatifvtt 0 0.75/)
  assert.match(result, /RWHATIFVTT0 ball whatifvtt 50/)
  assert.doesNotMatch(result, /RWHATIFVTT[123]/)
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => receiverTermination(result, [], value))
  assert.throws(() => receiverTermination('incomplete', [], 50), /control/)
})
