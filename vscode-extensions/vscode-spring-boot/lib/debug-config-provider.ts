import { CancellationToken, DebugConfiguration, DebugConfigurationProvider, ProviderResult, WorkspaceFolder } from "vscode";
import * as path from "path";
import * as VSCode from "vscode";
import { Disposable } from "vscode";
import psList from 'ps-list';

const JMX_VM_ARG = '-Dspring.jmx.enabled='
const ADMIN_VM_ARG = '-Dspring.application.admin.enabled='
const BOOT_PROJECT_ARG = '-Dspring.boot.project.name=';

class SpringBootDebugConfigProvider implements DebugConfigurationProvider {

    resolveDebugConfigurationWithSubstitutedVariables(folder: WorkspaceFolder | undefined, debugConfiguration: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
        if (isAutoConnect() && isActuatorOnClasspath(debugConfiguration)) {
            if (debugConfiguration.vmArgs) {
                if (debugConfiguration.vmArgs.indexOf(JMX_VM_ARG) < 0) {
                    debugConfiguration.vmArgs += ` ${JMX_VM_ARG}true`;
                }
                if (debugConfiguration.vmArgs.indexOf(ADMIN_VM_ARG) < 0) {
                    debugConfiguration.vmArgs += ` ${ADMIN_VM_ARG}true`;
                }
                if (debugConfiguration.vmArgs.indexOf(BOOT_PROJECT_ARG) < 0) {
                    debugConfiguration.vmArgs += ` ${BOOT_PROJECT_ARG}${debugConfiguration.projectName}`;
                }
            } else {
                debugConfiguration.vmArgs = `${JMX_VM_ARG}true ${ADMIN_VM_ARG}true ${BOOT_PROJECT_ARG}${debugConfiguration.projectName}`;
            }
        }
        return debugConfiguration;
    }

}

interface ProcessEvent {
    type: string;
    pid: number;
    shellProcessId: number
}

export function startDebugSupport(): Disposable {
    VSCode.debug.onDidReceiveDebugSessionCustomEvent(handleCustomDebugEvent);
    return VSCode.debug.registerDebugConfigurationProvider('java', new SpringBootDebugConfigProvider(), VSCode.DebugConfigurationProviderTriggerKind.Initial);
}

async function handleCustomDebugEvent(e: VSCode.DebugSessionCustomEvent): Promise<void> {
    if (e.session?.type === 'java' && e?.body?.type === 'processid') {
        const debugConfiguration: DebugConfiguration = e.session.configuration;
        if (isBootAppWithJmxSetup(debugConfiguration)) {
            setTimeout(async () => {
                const pid = await getAppPid(e.body as ProcessEvent);
                const processKey = pid.toString();
                VSCode.commands.executeCommand('sts/livedata/connect', { processKey });
            }, 500);
        }
    }
}

async function getAppPid(e: ProcessEvent): Promise<number> {
    if (e.pid) {
        return e.pid;
    } else if (e.shellProcessId) {
        const processes = await psList();
        const appProcess = processes.find(p => p.ppid === e.shellProcessId);
        if (appProcess) {
            return appProcess.pid;
        }
        throw Error(`No child process found for parent shell process with pid = ${e.shellProcessId}`);
    } else {
        throw Error('No pid or parent shell process id available');
    }
}

function isActuatorOnClasspath(debugConfiguration: DebugConfiguration): boolean {
    if (Array.isArray(debugConfiguration.classPaths)) {
        return !!debugConfiguration.classPaths.find(isActuatorJarFile);
    }
    return false;
}

function isActuatorJarFile(f: string): boolean {
    const fileName = path.basename(f || "");
    if (/^spring-boot-actuator-\d+\.\d+\.\d+(.*)?.jar$/.test(fileName)) {
        return true;
    }
    return false;
}

function isBootAppWithJmxSetup(debugConfiguration: DebugConfiguration): boolean {
    return debugConfiguration.vmArgs.indexOf(`${JMX_VM_ARG}true`) >= 0
        && debugConfiguration.vmArgs.indexOf(`${ADMIN_VM_ARG}true`) >= 0
        && debugConfiguration.vmArgs.indexOf(`${BOOT_PROJECT_ARG}${debugConfiguration.projectName}`) >= 0
        && isActuatorOnClasspath(debugConfiguration);
}

function isAutoConnect(): boolean {
    return VSCode.workspace.getConfiguration("boot-java.live-information.automatic-connection")?.get('on');
}
