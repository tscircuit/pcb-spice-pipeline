import type { Board, Group } from '@tscircuit/core'

// Global symbols let an ImportedBoard from any package copy be recognized by a
// serializer bundled elsewhere (for example inside the tscircuit CLI).
export interface SavedRecord { type: string; [key: string]: unknown }
export const importedBoardRecords = Symbol.for('pcb-spice-pipeline.imported-board.v2')
export const importedBoardDeclarations = Symbol.for('pcb-spice-pipeline.imported-board-declarations.v2')
export type ImportedBoardInstance = Board & { [importedBoardRecords]?: SavedRecord[]; [importedBoardDeclarations]?: Group }
