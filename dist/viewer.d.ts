import { type ReportData } from './report.js';
import type { PipelineResult } from './general-pipeline.js';
import type { FileMap } from './solver.js';
/** Returns a self-contained HTML report and CSVs without reading or writing files. */
export declare function generateReport(result: PipelineResult): FileMap;
export declare function generateReportData(data: ReportData, title?: string): FileMap;
