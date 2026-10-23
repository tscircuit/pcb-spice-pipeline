import type { ConvertedIbisComponent } from '@tscircuit/ibis-to-spice';
export type Matrix = number[][];
export interface ChannelMatrices {
    R: Matrix;
    L: Matrix;
    C: Matrix;
}
type ConvertedSource = Pick<ConvertedIbisComponent, 'source' | 'spicePinMapping'>;
interface LegacyModeling {
    sections: number;
    lanes: Array<{
        port: string;
        driverPort?: string;
        receiverPort?: string;
    }>;
    driver: {
        power: {
            vdd: string;
            vss: string;
        };
    };
    receiver: {
        power: {
            vdd: string;
            vss: string;
        };
    };
    simulation: {
        supplyV: number;
        stepSeconds: number;
        durationSeconds: number;
    };
}
export declare function channelSpice(extracted: ChannelMatrices[], sections: number): string;
export declare function simulationSpice(modeling: LegacyModeling, extracted: ChannelMatrices[], driver: ConvertedSource, receiver: ConvertedSource): string;
export {};
