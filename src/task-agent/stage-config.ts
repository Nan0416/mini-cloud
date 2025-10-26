import { getenv, stage } from '@sparrow/utilities';
import { VariableReplacementConfig } from './facade/variable-replacement';
import path from 'path';

interface StageConfig {
  readonly appName: string;
  readonly authTokenEndpoint: string;
  readonly port: number;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly streamDomain: string;
  readonly taskDomain: string;
  readonly taskTopic: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly offlineReportPath: string;
  readonly variableReplacementConfig: VariableReplacementConfig;
  readonly passiveHealthCheckToleranceBuffer: number;
}

function getStageConfig(stage: 'beta' | 'prod'): StageConfig {
  const stdErrDir = path.join(getenv('HOME'), 'task-outputs', stage, 'stderr');
  const stdOutDir = path.join(getenv('HOME'), 'task-outputs', stage, 'stdout');
  const offlineReportPath = path.join(getenv('HOME'), 'task-outputs', stage, `offline-reports.reports`);

  const temp = process.env['PASSIVE_HEALTH_CHECK_TOLERANCE_BUFFER'];
  let passiveHealthCheckToleranceBuffer = 2000;
  if (typeof temp === 'string') {
    passiveHealthCheckToleranceBuffer = Number(temp);
    if (Number.isNaN(passiveHealthCheckToleranceBuffer) || Math.round(passiveHealthCheckToleranceBuffer) !== passiveHealthCheckToleranceBuffer || passiveHealthCheckToleranceBuffer < 2000) {
      throw new Error(`invalid passiveHealthCheckToleranceBuffer ${temp}`);
    }
  }

  return {
    appName: getenv(APPLICATION_NAME_KEY),
    authTokenEndpoint: authTokenEndpoint[stage].domain,
    port: taskAgent[stage].port,
    accessKey: getenv('ACCESS_KEY'),
    secretKey: getenv('SECRET_KEY'),
    streamDomain: stream[stage].domain,
    taskDomain: tasks[stage].domain,
    taskTopic: taskTopic[stage].topic,
    agentId: getenv('AGENT_ID'),
    agentName: getenv('AGENT_NAME'),
    offlineReportPath: offlineReportPath,
    passiveHealthCheckToleranceBuffer: passiveHealthCheckToleranceBuffer,
    variableReplacementConfig: {
      home: getenv('HOME'),
      projectDir: `${getenv('HOME')}/${stage}`,
      stderrDir: stdErrDir,
      stdoutDir: stdOutDir,
    },
  };
}

const config = getStageConfig(stage());

export default config;
