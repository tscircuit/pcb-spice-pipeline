export function waveformRows(text: any): any;
export function measureWaveform(rows: any, s: any, eye?: {
    endpoint: string;
    differentialColumn: number;
    polarity: number;
    name: string;
}): {
    kind: string;
    name: string;
    probeEndpoint: string;
    probePolarity: number;
    samples: any;
    receiverTransitions: any;
    eyeTransitions: any;
    steadyStateStartSeconds: any;
    uiSeconds: any;
    eyePhaseSeconds: any;
    differentialRangeV: number[];
    eyeHeightAtCenterV: number;
    propagationMedianSeconds: any;
    propagationRangeSeconds: any[];
    crossingIntervalRangeSeconds: number[];
    simulatedDurationSeconds: any;
    limitations: string[];
};
export function foldEye(rows: any, metrics: any, eye: any, pointsPerWindow?: number, limits?: {}): {
    samples: number[][];
    windows: number;
    pointsPerWindow: number;
};
export function probeWaveformRows(text: any, probes: any): any;
export function foldProbeEye(rows: any, eye: any, pointsPerWindow?: number, limits?: {}): {
    samples: any[][];
    windows: number;
    pointsPerWindow: number;
    windowOriginsSeconds: any[];
    boundaryIndices: number[];
    metrics: {
        kind: string;
        alignment: string;
        samples: any;
        voltageRangeV: any;
        unitIntervalSeconds: any;
        timeOriginSeconds: any;
        measurementStartSeconds: any;
        measurementEndSeconds: any;
        observedStartSeconds: any;
        observedEndSeconds: any;
        windows: number;
        limitations: string[];
    };
};
