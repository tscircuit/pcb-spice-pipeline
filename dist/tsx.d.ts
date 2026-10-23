import type { Board, Group } from '@tscircuit/core';
import type { ReactNode } from 'react';
import type { BoardProps } from '@tscircuit/props';
export { serializeSimulation } from './tsx-render.js';
export type { IbisModelDefinition } from '@tscircuit/props';
export interface SavedRecord {
    type: string;
    [key: string]: unknown;
}
export declare const importedBoardRecords: unique symbol;
export declare const importedBoardDeclarations: unique symbol;
export type ImportedBoardInstance = Board & {
    [importedBoardRecords]?: SavedRecord[];
    [importedBoardDeclarations]?: Group;
};
export declare function savedRecords(circuitJson: readonly unknown[]): SavedRecord[];
export interface ImportedBoardProps extends Pick<BoardProps, 'fabricatorPreset' | 'material'> {
    circuitJson: readonly unknown[];
    children?: ReactNode;
}
/** Preserves a routed board while core renders native simulation declarations. */
export declare function ImportedBoard({ circuitJson, children, fabricatorPreset, material }: ImportedBoardProps): import("react").FunctionComponentElement<import("react").FragmentProps>;
