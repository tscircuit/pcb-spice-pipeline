import { readFileSync, writeFileSync } from 'node:fs'
import { routedStages } from '../src/pipeline'

/** Generate both documentation views from the same tuple used by the debugger. */
export function routedStageDocumentation(): string {
  const table = ['| # | Stage solver |', '|---|---|', ...routedStages.map((stage, i) => `| ${i + 1} | ${stage.solverName} |`)].join('\n')
  const flow = ['flowchart LR', ...routedStages.map((stage, i) => `  s${i}["${stage.solverName}<br/>${i ? 'All admitted blocks, one item per step' : 'Admit one SI block per step'}"]`), ...routedStages.slice(1).map((_, i) => `  s${i} --> s${i + 1}`), `  s${routedStages.length - 1} <-->|"await RunSolver"| engine["local native ngspice"]`].join('\n')
  const states = ['stateDiagram-v2', `  [*] --> ${routedStages[0].solverName}`, ...routedStages.slice(1).map((stage, i) => `  ${routedStages[i].solverName} --> ${stage.solverName}: all blocks completed`), `  ${routedStages.at(-1)!.solverName} --> [*]`, ...routedStages.map(stage => `  ${stage.solverName} --> failed`), '  failed --> [*]'].join('\n')
  return `${table}\n\n\`\`\`mermaid\n${flow}\n\`\`\`\n\n\`\`\`mermaid\n${states}\n\`\`\`\n`
}

for (const path of ['README.md', 'docs/ARCHITECTURE.md']) {
  const text = readFileSync(path, 'utf8')
  writeFileSync(path, text.replace(/<!-- routed-stages:start -->[\s\S]*?<!-- routed-stages:end -->/, `<!-- routed-stages:start -->\n${routedStageDocumentation()}<!-- routed-stages:end -->`))
}
