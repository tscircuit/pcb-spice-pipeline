import test from 'node:test'
import assert from 'node:assert/strict'
import { withoutPackage, receiverTermination } from './addr-cmd-qualification'

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
