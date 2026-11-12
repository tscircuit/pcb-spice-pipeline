import test from 'node:test'
import assert from 'node:assert/strict'
import { routedControl } from '../../src/simulation/routed-control'

test('routed decks declare saved vectors and transient analysis without interactive commands', () => {
  assert.deepEqual(routedControl('v(receiver) i(vdrive)', 1e-11, 4e-9), ['.save v(receiver) i(vdrive)', '.tran 1e-11 4e-9 0 1e-11', '.end'])
  assert.doesNotMatch(routedControl('v(n)', 1e-11, 4e-9).join('\n'), /control|wrdata|quit|resume|stop when/)
})
