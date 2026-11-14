import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePackageModel } from '../../src/buffers/package-model'

/** Small original fixture; numeric-looking names still follow the declared pin order. */
function fixture(data: string, pins: string[] = ['Z9', 'A1', '7']): string {
  return `[Define Package Model] Example package
[Manufacturer] Example Semiconductor
[OEM] Example Packaging
[Description] Original three-pin fixture
[Number Of Pins] ${pins.length}
[Pin Numbers]
${pins.join('\n')}
[Model Data]
${data}
[End Model Data]
[End Package Model]`
}

test('IBIS package matrices use named upper-triangle rows, exact widths and explicit section rejection', () => {
  const full = '[Row] Z9\n4nH 1n\n-0.5n\n[Row] A1\n3n 0.2n\n[Row] 7\n2n'
  const sparse = '[Row] Z9\n7 -0.5n\nZ9 4n\nA1 1n\n[Row] A1\n7 0.2n\nA1 3n\n[Row] 7\n7 2n'
  for (const [format, rows] of [['Full_matrix', full], ['Sparse_matrix', sparse], ['Banded_matrix', `[Bandwidth] 2\n${full}`]]) {
    const parsed = parsePackageModel(fixture(`[Inductance Matrix] ${format}\n${rows}\n[Capacitance Matrix] ${format}\n${rows}`), 'Example package')
    assert.deepEqual(parsed.pins, ['Z9', 'A1', '7'])
    const expected = [[4e-9, 1e-9, -5e-10], [1e-9, 3e-9, 2e-10], [-5e-10, 2e-10, 2e-9]]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(parsed.L[i][j] - expected[i][j]) < 1e-24)
    assert.deepEqual(parsed.R, Array.from({ length: 3 }, () => [0, 0, 0]), 'absent resistance is zero by spec')
    assert.equal(parsed.manufacturer, 'Example Semiconductor')
  }
  const band = '[Bandwidth] 1\n[Row] Z9\n4n 1n\n[Row] A1\n3n .2n\n[Row] 7\n2n'
  const ring = band + ' -.5n'
  for (const [rows, corner] of [[band, 0], [ring, -5e-10]] as const) {
    const parsed = parsePackageModel(fixture(`[Inductance Matrix] Banded_matrix\n${rows}\n[Capacitance Matrix] Banded_matrix\n${rows}`), 'Example package')
    assert.equal(parsed.L[0][2], corner, 'last row distinguishes truncated and wrap-around bands')
  }
  const valid = fixture(`[Resistance Matrix] Banded_matrix\n[Bandwidth] 0\n[Row] Z9\n1m\n[Row] A1\n2m\n[Row] 7\n3m\n[Inductance Matrix] Sparse_matrix\n${sparse}\n[Capacitance Matrix] Full_matrix\n${full}`)
  assert.equal(parsePackageModel(valid, 'Example package').R[1][1], .002)
  assert.deepEqual(parsePackageModel(valid.replace(/\[([^\]]+)\]/g, (_, key) => `[${key.replaceAll(' ', '_').toUpperCase()}]`), 'Example package').pins, ['Z9', 'A1', '7'])
  assert.deepEqual(parsePackageModel('[Comment Char] #_char\n' + valid.replace('7 -0.5n', '7 -0.5n # ignored column'), 'Example package').pins, ['Z9', 'A1', '7'])
  assert.deepEqual(parsePackageModel('[Comment Char] |_char\n' + valid.replace('[Model Data]', '[Comment Char] #_char\n[Model Data]'), 'Example package').pins, ['Z9', 'A1', '7'])
  for (const [text, error] of [
    [valid.replace('[OEM] Example Packaging\n', ''), /OEM/],
    [valid.replace('[End Model Data]', ''), /End Model Data/],
    [valid.replace('[End Package Model]', ''), /End Package Model/],
    [valid.replace('[Number Of Pins] 3', '[Number Of Pins] 4'), /pin count/i],
    [valid.replace('[Pin Numbers]', '[Number Of Sections] 1\n[Pin Numbers]'), /sections.*unsupported/i],
    [valid.replace('Z9\nA1', 'Z9 Len=0 L=1n/\nA1'), /section.*unsupported/i],
    [valid.replace('7 -0.5n', 'absent -0.5n'), /unknown.*column/i],
    [valid.replace('7 0.2n', 'Z9 0.2n'), /upper triangle/i],
    [valid.replace('7 -0.5n', '7 NA'), /numeric/i],
    [valid.replace('7 -0.5n', '7 1e999'), /finite/i],
    [valid.replace('7 -0.5n', '7 -0.5n\n7 1n'), /duplicate/i],
    [valid.replace('[Bandwidth] 0', '[Bandwidth] 3'), /bandwidth/i],
    [valid.replace('[Bandwidth] 0\n', ''), /Bandwidth/],
    [valid.replace('4nH 1n', '4nH'), /expected.*entries/],
    [valid.replace('[Capacitance Matrix] Full_matrix', '[Capacitance Matrix] Full_matrix\n[Bandwidth] 1'), /Bandwidth/],
    [valid.replace('[End Package Model]', '[End Package Model] extra'), /unexpected data/],
    [valid.replace('[Row] A1\n3n', '[Row] Z9\n3n'), /row order/i],
    [valid.replace('7 -0.5n', '7 -0.5n A1 1n'), /index.*value/i],
    [valid + '\n' + valid, /duplicate.*package/i],
  ] as const) assert.throws(() => parsePackageModel(text, 'Example package'), error)
  assert.throws(() => parsePackageModel(valid, 'missing'), /missing.*scalar fallback is forbidden/i)
  const five = ['z', 'a', '9', 'b', '0']
  const ringRows = five.map((pin, i) => `[Row] ${pin}\n${i + 10} ${i + 1} ${i + 2}`).join('\n')
  const ringModel = parsePackageModel(fixture(`[Inductance Matrix] Banded_matrix\n[Bandwidth] 2\n${ringRows}\n[Capacitance Matrix] Banded_matrix\n[Bandwidth] 2\n${ringRows}`, five), 'Example package')
  assert.deepEqual(ringModel.L, [[10, 1, 2, 5, 5], [1, 11, 2, 3, 6], [2, 2, 12, 3, 4], [5, 3, 3, 13, 4], [5, 6, 4, 4, 14]])
})
