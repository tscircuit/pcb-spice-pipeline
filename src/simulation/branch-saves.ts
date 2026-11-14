/** Expand voltage-source branch names through a compiled IBIS library without storing all ladder states. */
export function branchSaves(source: string, instance: string, wrapper: string): string[] {
  const definitions = new Map<string, string[]>()
  let current: string[] = []
  for (const line of source.split(/\r?\n/)) {
    const header = /^\.subckt\s+(\S+)/i.exec(line)
    if (header) {
      current = []
      definitions.set(header[1].toLowerCase(), current)
    } else if (!/^\.ends/i.test(line)) current.push(line)
  }
  const saved: string[] = []
  /** ngspice prefixes subcircuit voltage devices with v.<instance path>.<device name>. */
  const walk = (name: string, path: string, depth: number): void => {
    if (depth > 12) throw new Error('Recursive/deep SPICE library cannot be saved safely')
    for (const line of definitions.get(name.toLowerCase()) ?? []) {
      const tokens = line.trim().split(/\s+/)
      if (/^v/i.test(tokens[0])) saved.push(`i(v.${path}.${tokens[0].toLowerCase()})`)
      if (/^x/i.test(tokens[0])) walk(tokens.at(-1)!, `${path}.${tokens[0].toLowerCase()}`, depth + 1)
    }
  }
  walk(wrapper, instance.toLowerCase(), 0)
  return saved
}
