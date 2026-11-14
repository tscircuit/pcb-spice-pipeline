import test from 'node:test'
import assert from 'node:assert/strict'
import { branchSaves } from '../../src/simulation'

test('IBIS branch dependencies survive receiver-only saves through hierarchy', () => {
  const source = '.subckt TOP a\nVREF a b 0\nXBUF b BUF\n.ends\n.subckt BUF a\nVSENSE a b 0\n.ends'
  assert.deepEqual(branchSaves(source, 'XIBIS0', 'TOP'), ['i(v.xibis0.vref)', 'i(v.xibis0.xbuf.vsense)'])
})
