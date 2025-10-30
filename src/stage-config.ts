import { getenv } from '@ultrasa/dev-kit';
import { TaskAgent } from '@ultrasa/mini-cloud-models';
import path from 'path';

export interface DiscordNotifierConfigs {
  readonly webhookId: string;
  readonly webhookToken: string;
}

export type Stage = 'beta' | 'prod';
export const STAGES: ReadonlyArray<Stage> = ['beta', 'prod'];

export interface StageConfig {
  readonly stage: Stage;
  readonly appName: string;
  readonly mongodbUri: string;
  readonly servicePort: number;
  readonly websocketPort: number;
  readonly taskTopic: string;
  readonly fsVariablesPath: string;
  readonly taskAgents: TaskAgent[];
  readonly discordNotifierConfigs: DiscordNotifierConfigs;
}

// todo: persist in database?
const BETA_AGENTS: TaskAgent[] = [
  {
    identifier: '00001',
    name: 'i-0080f7a1d29ad6261',
    status: 'offline',
  },
  {
    identifier: '00002',
    name: 'MacMini-1',
    status: 'offline',
  },
  {
    identifier: '00003',
    name: 'MacBookPro16',
    status: 'offline',
  },
];

const PROD_AGENTS: TaskAgent[] = [
  {
    identifier: '10001',
    name: 'i-0080f7a1d29ad6261',
    status: 'offline',
  },
  {
    identifier: '10002',
    name: 'MacMini-1',
    status: 'offline',
  },
  {
    identifier: '10003',
    name: 'MacBookPro16',
    status: 'offline',
  },
  {
    identifier: '10004',
    name: 'i-09b4767214eaf3b32',
    status: 'offline',
  },
];

function getStageConfig(stage: Stage): StageConfig {
  const dirPath = getenv('MINI_CLOUD_DIR');
  return {
    stage: stage,
    appName: getenv('APPLICATION_NAME'),
    mongodbUri: `mongodb://localhost:27017/mini-cloud-${stage}`,
    servicePort: 3000,
    websocketPort: 3050,
    taskTopic: '_task',
    fsVariablesPath: path.join(dirPath, 'task-variables.json'),
    taskAgents: stage === 'prod' ? PROD_AGENTS : BETA_AGENTS,
    discordNotifierConfigs: {
      webhookId: getenv('DISCORD_WEBHOOK_ID'),
      webhookToken: getenv('DISCORD_WEBHOOK_TOKEN'),
    },
  };
}

const config = getStageConfig(getenv('STAGE', STAGES));

export default config;
