import { parseIbis, switchingWeights } from '@tscircuit/ibis-to-spice'

/** Inspect only the typical-corner buffers actually selected by the DDR3 write TSX. No solver. */
export function ddr3Waveforms(cpu: string, dram: string): object[] {
  const sources: Array<[string, string[]]> = [[cpu, ['Model_257', 'Model_579', 'Model_771']], [dram, ['ODT_off']]]
  return sources.flatMap(([text, names]) => {
    const document = parseIbis(text)
    return names.map(name => {
      const buffer = document.getBuffer(name)
      const body = text.split(/^\s*\[Model\]\s+/gmi).slice(1).find(section => section.split(/\s/)[0] === name)!
      return {
        model: name, corner: 'typical', type: buffer.type, voltage_v: buffer.voltage[0], capacitance_f: buffer.capacitance[0],
        ramp: body.split(/\r?\n/).filter(line => /^\s*(dV\/dt_[rf]|R_load)/i.test(line)),
        waveforms: buffer.waveforms.map(wave => {
          const data = wave.data.map(row => [row[0], row[1]!] as const)
          const final = data.at(-1)![1]
          const tolerance = .01 * Math.abs(final - data[0][1])
          let index = data.length - 1
          while (index > 0 && Math.abs(data[index - 1][1] - final) <= tolerance) index--
          return { edge: wave.kind, resistance_ohm: wave.resistance, fixture_voltage_v: wave.fixtureVoltage[0], samples: data.length,
            start_s: data[0][0], end_s: data.at(-1)![0], initial_v: data[0][1], final_v: final,
            tolerance_v: tolerance, settled_sample_s: data[index][0] }
        }),
        coefficients: (['rising', 'falling'] as const).filter(edge => buffer.waveforms.some(wave => wave.kind === edge)).map(edge => {
          const data = switchingWeights(buffer, 'typical', edge)
          const target = edge === 'rising' ? [1, 0] : [0, 1]
          let index = data.length
          while (index > 0 && Math.max(Math.abs(data[index - 1][1] - target[0]), Math.abs(data[index - 1][2] - target[1])) <= .01) index--
          return { edge, tolerance: .01, settled_sample_s: data[index]?.[0] ?? null, first: data[0], last: data.at(-1) }
        }),
      }
    })
  })
}
