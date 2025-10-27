import { APPLICATION_NAME_KEY } from '@sparrow/standard-error';
import { getenv, STAGE, stage } from '@sparrow/utilities';
import path from 'path';
import { VariableReplacementConfig } from './task-agent-core';

export interface StageConfig {
  readonly appName: string;
  readonly serviceBaseUrl: string;
  readonly websocketBaseUrl: string;
  readonly agentPort: number;
  readonly taskTopic: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly offlineReportPath: string;
  readonly variableReplacementConfig: VariableReplacementConfig;
  readonly passiveHealthCheckToleranceBuffer: number;
}

function getStageConfig(stage: STAGE): StageConfig {
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
    serviceBaseUrl: 'http://localhost:3000',
    websocketBaseUrl: 'ws://localhost:3050',
    agentPort: 4000,
    taskTopic: '_task',
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
