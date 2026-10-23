import { fail } from './matrices.mjs';
export function jsonFile(files, path, value) {
    files[path] = JSON.stringify(value, null, 2) + '\n';
}
export async function executeSolver(runSolver, artifacts, directory, request) {
    const supplied = { ...request.files };
    const result = await runSolver({ ...request, files: { ...supplied }, args: [...request.args], outputFiles: [...request.outputFiles] });
    if (!result || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || !result.files || typeof result.files !== 'object')
        fail('solver_result', `${request.solver}: expected stdout, stderr and files`);
    if (result.exitCode !== undefined && result.exitCode !== 0)
        fail('native_solver', `${request.solver}: exited ${result.exitCode}\n${result.stdout}\n${result.stderr}`);
    for (const file of request.outputFiles)
        if (!Object.hasOwn(result.files, file) || typeof result.files[file] !== 'string')
            fail('native_output', `${request.solver}: missing ${file}`);
    for (const [path, body] of Object.entries({ ...supplied, ...result.files })) {
        if (typeof body !== 'string')
            fail('solver_result', `${request.solver}: ${path} must be a string`);
        artifacts[`${directory}/${path}`] = body;
    }
    artifacts[`${directory}/${request.solver}.stdout.log`] = result.stdout;
    artifacts[`${directory}/${request.solver}.stderr.log`] = result.stderr;
    jsonFile(artifacts, `${directory}/${request.solver}.request.json`, request);
    return result;
}
