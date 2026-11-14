import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const src = join(repo, 'src')

// Pinned diagnostic codes.
const RAISED = [
  'artifact_collision', 'artifact_path', 'channel_fanout', 'channel_model', 'channel_net',
  'channel_short', 'circuit_schema', 'electrical_input', 'file_path', 'floating_source',
  'ibis_asset', 'ibis_asset_missing', 'ibis_contract', 'ibis_mapping', 'ibis_model',
  'ibis_state', 'matrix_format', 'matrix_zero', 'mesh_convergence', 'model_frequency',
  'native_declaration', 'native_geometry', 'native_output', 'native_solver', 'native_timeout',
  'passive_capability', 'passive_reference', 'passivity', 'pin_mapping', 'probe_reference',
  'reciprocity', 'route_type', 'simulation_capability', 'simulation_duration', 'simulation_experiment',
  'simulation_id', 'simulation_probe', 'simulation_reference', 'simulation_scope', 'simulation_start',
  'simulation_timing', 'solver_result', 'source_capability', 'source_edge', 'stackup',
  'stimulus_coverage', 'stimulus_duplicate', 'stimulus_missing', 'stimulus_pattern', 'stimulus_state',
  'supply_missing', 'supply_reference', 'supply_short', 'via_geometry', 'waveform',
].sort()

/** Reads the DiagnosticCode union from src/modules.generated.ts as a list of its literal members. */
function diagnosticCodeUnion(): string[] {
  const text = readFileSync(join(src, 'modules.generated.ts'), 'utf8')
  const sf = ts.createSourceFile('modules.generated.ts', text, ts.ScriptTarget.Latest, true)
  const alias = sf.statements.find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === 'DiagnosticCode')
  assert.ok(alias, 'src/modules.generated.ts declares DiagnosticCode')
  const codes: string[] = []
  /** Collects every string literal type found under the union node. */
  const visit = (n: ts.Node): void => {
    if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) codes.push(n.literal.text)
    ts.forEachChild(n, visit)
  }
  visit(alias.type)
  return codes
}

/** Every TS/JS source file under a directory, skipping .d.ts files and the top-level src/legacy folder. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'legacy' && dir === src ? [] : sources(path)
    return /\.(?:[cm]?ts|[cm]?js)$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

/** String literals a call can pass as a code: 'x', or either branch of `cond ? 'x' : 'y'`. */
const literals = (e: ts.Expression | undefined): string[] => {
  if (!e) return []
  if (ts.isStringLiteralLike(e)) return [e.text]
  if (ts.isConditionalExpression(e)) return [...literals(e.whenTrue), ...literals(e.whenFalse)]
  if (ts.isParenthesizedExpression(e)) return literals(e.expression)
  return []
}

/** Literal codes passed to fail(code, ...) or new Diagnostic(domain, code, ...) anywhere in non-legacy src/. */
function literalRaises(): Map<string, string[]> {
  const raised = new Map<string, string[]>()
  for (const file of sources(src)) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    /** Records that this file raises each of the given codes. */
    const add = (codes: string[]): void => {
      for (const c of codes) raised.set(c, [...(raised.get(c) ?? []), relative(repo, file)])
    }
    /** Walks the file's AST looking for fail(...) and new Diagnostic(...) calls with literal codes. */
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'fail') add(literals(n.arguments[0]))
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Diagnostic' && (n.arguments?.length ?? 0) >= 3)
        add(literals(n.arguments![1]))
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return raised
}

test('DiagnosticCode in src/modules.generated.ts equals the pinned set of raisable codes', () => {
  const union = diagnosticCodeUnion()
  assert.equal(new Set(union).size, union.length, 'no duplicate literals')
  assert.deepEqual([...union].sort(), RAISED)
})

test('every literal code raised in non-legacy src/ is in the pinned set', () => {
  const pinned = new Set(RAISED)
  const raised = literalRaises()
  const unknown = [...raised].filter(([code]) => !pinned.has(code)).map(([code, files]) => `${code} (${[...new Set(files)].join(', ')})`)
  assert.deepEqual(unknown, [])
  assert.ok(raised.size >= 55, `scanner found ${raised.size} codes; removed legacy API paths must still leave the active diagnostics scanned`)
})
