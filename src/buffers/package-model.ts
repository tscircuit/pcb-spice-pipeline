/** IBIS section 7 lumped package data; matrix order is exactly [Pin Numbers]. */
export interface PackageModel {
  name: string; manufacturer: string; oem: string; description: string; pins: string[]
  R: number[][]; L: number[][]; C: number[][]
}
interface Section { key: string; argument: string; lines: string[] }

/** Read the named local definition without splitting a large vendor file into lines. */
export function parsePackageModel(text: string, name: string): PackageModel {
  let body: string | undefined
  let active: string | undefined
  let start = 0
  let comment = '|'
  let initialComment = '|'
  // Comment changes outside the selected definition still affect its contents.
  for (const match of text.matchAll(/^[ \t]*\[(define[ _]package[ _]model|end[ _]package[ _]model|comment[ _]char)\][ \t]*([^\r\n]*)/gmi)) {
    const key = match[1].toLowerCase().replace(/_/g, ' ')
    if (key === 'comment char') {
      const next = /^(.)_char(?:\s|$)/i.exec(match[2])
      if (!next) throw new Error(`${name}: invalid [Comment Char]`)
      comment = next[1]
      continue
    }
    if (key === 'define package model') {
      if (active) throw new Error(`${active}: missing [End Package Model]`)
      active = match[2].split(comment)[0].trim()
      if (active === name && body !== undefined) throw new Error(`${name}: duplicate package definition`)
      if (active === name) initialComment = comment
      start = match.index! + match[0].length
      continue
    }
    if (key === 'end package model') {
      if (active === name && match[2].split(comment)[0].trim()) throw new Error(`${name}: unexpected data after [End Package Model]`)
      if (active === name) body = text.slice(start, match.index)
      active = undefined
      continue
    }
  }
  if (active === name) throw new Error(`${name}: missing [End Package Model]`)
  if (body === undefined) throw new Error(`${name}: [Define Package Model] missing in IBIS source; external .pkg lookup is unsupported; scalar fallback is forbidden`)
  if (!name || name.length > 40) throw new Error(`${name}: invalid package name`)
  const sections: Section[] = []
  comment = initialComment
  for (const raw of body.split(/\r?\n/)) {
    const change = /^\s*\[comment[ _]char\]\s*(.)_char/i.exec(raw)
    if (change) {
      comment = change[1]
      continue
    }
    const line = raw.split(comment)[0].trim()
    if (!line) continue
    const header = /^\[([^\]]+)\]\s*(.*)$/.exec(line)
    const key = header?.[1].toLowerCase().replace(/_/g, ' ')
    if (key === 'number of sections') throw new Error(`${name}: package sections are unsupported ([Number Of Sections]); scalar fallback is forbidden`)
    if (header) sections.push({ key: key!, argument: header[2], lines: [] })
    else {
      if (!sections.length) throw new Error(`${name}: data before package metadata`)
      sections.at(-1)!.lines.push(line)
    }
  }
  const metadata: Record<string, string> = {}
  const pins: string[] = []
  const matrices: Partial<Pick<PackageModel, 'R' | 'L' | 'C'>> = {}
  let count = 0
  let phase: 'metadata' | 'pins' | 'data' | 'end' = 'metadata'
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    const { key, argument, lines } = section
    if (['manufacturer', 'oem', 'description', 'number of pins'].includes(key)) {
      if (phase !== 'metadata' || key in metadata || lines.length) throw new Error(`${name}: invalid or duplicate [${key}]`)
      metadata[key] = argument
      if (key === 'number of pins') {
        if (!/^\d+$/.test(argument) || Number(argument) < 1 || !Number.isSafeInteger(Number(argument))) throw new Error(`${name}: invalid [Number Of Pins]`)
        count = Number(argument)
      } else if (!argument || argument.length > (key === 'description' ? 59 : 40)) throw new Error(`${name}: invalid [${key}]`)
    } else if (key === 'pin numbers') {
      if (phase !== 'metadata' || !count || argument) throw new Error(`${name}: [Number Of Pins] must precede [Pin Numbers]`)
      for (const line of lines) {
        if (/\s|[=/]/.test(line) || /^(fork|endfork)$/i.test(line)) throw new Error(`${name}: package section syntax is unsupported in [Pin Numbers]`)
        if (line.length > 5 || pins.includes(line)) throw new Error(`${name}: invalid or duplicate package pin ${line}`)
        pins.push(line)
      }
      if (pins.length !== count) throw new Error(`${name}: package pin count ${pins.length} differs from [Number Of Pins] ${count}`)
      phase = 'pins'
    } else if (key === 'model data') {
      if (phase !== 'pins' || argument || lines.length) throw new Error(`${name}: invalid [Model Data]`)
      phase = 'data'
    } else if (key === 'end model data') {
      if (phase !== 'data' || argument || lines.length) throw new Error(`${name}: invalid [End Model Data]`)
      phase = 'end'
    } else {
      const fields: Record<string, 'R' | 'L' | 'C' | undefined> = { 'resistance matrix': 'R', 'inductance matrix': 'L', 'capacitance matrix': 'C' }
      const field = fields[key]
      if (!field || phase !== 'data' || matrices[field]) throw new Error(`${name}: unexpected or duplicate [${key}]`)
      let end = i + 1
      while (end < sections.length && ['bandwidth', 'row'].includes(sections[end].key)) end++
      matrices[field] = parseMatrix(sections.slice(i, end), pins, `${name} [${key}]`)
      i = end - 1
    }
  }
  for (const key of ['manufacturer', 'oem', 'description']) if (!(key in metadata)) throw new Error(`${name}: required [${key.toUpperCase()}] missing`)
  if (phase !== 'end') throw new Error(`${name}: missing [End Model Data]`)
  if (!matrices.L || !matrices.C) throw new Error(`${name}: required inductance/capacitance matrix missing`)
  return { name, manufacturer: metadata.manufacturer, oem: metadata.oem, description: metadata.description, pins, R: matrices.R ?? pins.map(() => pins.map(() => 0)), L: matrices.L, C: matrices.C }
}

/** Require a finite standard IBIS number; suffix characters after the scale denote units. */
function matrixNumber(token: string, label: string): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([TGMkmunpf]?)[a-zA-Z]*$/.exec(token)
  if (!match) throw new Error(`${label}: invalid numeric matrix value ${token}`)
  const scales: Record<string, number> = { '': 1, T: 1e12, G: 1e9, M: 1e6, k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 }
  const value = Number(match[1]) * scales[match[2]]
  if (!Number.isFinite(value)) throw new Error(`${label}: finite matrix value required: ${token}`)
  return value
}

/** Expand upper-triangle storage, including the spec's optional circular band. */
function parseMatrix(sections: Section[], pins: string[], label: string): number[][] {
  const format = sections[0].argument.toLowerCase()
  if (!['full_matrix', 'banded_matrix', 'sparse_matrix'].includes(format) || sections[0].lines.length) throw new Error(`${label}: invalid matrix format`)
  const banded = format === 'banded_matrix'
  const band = sections[1]?.key === 'bandwidth' ? sections[1] : undefined
  if (banded !== Boolean(band) || (band && (!/^\d+$/.test(band.argument) || band.lines.length))) throw new Error(`${label}: [Bandwidth] required only for Banded_matrix before rows`)
  const width = band ? Number(band.argument) : pins.length - 1
  if (!Number.isSafeInteger(width) || width >= pins.length) throw new Error(`${label}: invalid bandwidth ${width}`)
  const rows = sections.slice(band ? 2 : 1)
  if (rows.length !== pins.length || rows.some((row, i) => row.key !== 'row' || row.argument !== pins[i])) throw new Error(`${label}: row order must match [Pin Numbers] exactly`)
  const values = rows.map(row => row.lines.flatMap(line => line.split(/\s+/)))
  const circular = banded && width > 0 && values.every(row => row.length === width + 1)
  if (circular && width > Math.floor((pins.length - 1) / 2)) throw new Error(`${label}: circular bandwidth creates redundant entries`)
  const matrix = pins.map(() => pins.map(() => 0))
  const indices = new Map(pins.map((pin, i) => [pin, i]))
  for (let i = 0; i < rows.length; i++) {
    if (format === 'sparse_matrix') {
      const seen = new Set<number>()
      for (const line of rows[i].lines) {
        const tokens = line.split(/\s+/)
        if (tokens.length !== 2) throw new Error(`${label} ${pins[i]}: each sparse (index, value) pair needs its own line`)
        const j = indices.get(tokens[0])
        if (j === undefined) throw new Error(`${label}: unknown sparse column pin ${tokens[0]}`)
        if (j < i) throw new Error(`${label}: sparse entries must use the upper triangle in [Pin Numbers] order`)
        if (seen.has(j)) throw new Error(`${label}: duplicate sparse column ${tokens[0]}`)
        seen.add(j)
        matrix[i][j] = matrix[j][i] = matrixNumber(tokens[1], label)
      }
    } else {
      const count = circular ? width + 1 : Math.min(width + 1, pins.length - i)
      if (values[i].length !== count) throw new Error(`${label} ${pins[i]}: expected ${count} entries, got ${values[i].length}; inconsistent bandwidth or truncated row`)
      for (let k = 0; k < count; k++) {
        const j = (i + k) % pins.length
        matrix[i][j] = matrix[j][i] = matrixNumber(values[i][k], label)
      }
    }
  }
  return matrix
}
