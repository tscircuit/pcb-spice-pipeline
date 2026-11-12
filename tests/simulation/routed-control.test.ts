import test from 'node:test'
import assert from 'node:assert/strict'
import { routedControl } from '../../src/simulation/routed-control'

test('long routed captures bound checkpoint writes while retaining the final sample', () => {
  for (const duration of [4e-9, 160e-9, 7.2e-6, 576e-6]) {
    const lines = routedControl([], 'v(receiver)', 5e-12, duration)
    const cuts = lines.filter(line => line.startsWith('echo SI_PROGRESS ')).map(line => Number(line.split(' ').at(-1)))
    assert.ok(cuts.length <= 8)
    assert.equal(cuts.at(-1), duration)
    assert.equal(cuts[0], 1e-12)
    assert.ok(cuts.every((time, i) => i === 0 || time > cuts[i - 1]))
    assert.equal(lines.filter(line => line.startsWith('wrdata ')).length, cuts.length)
  }
})
