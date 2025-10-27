import { APPLICATION_NAME_KEY } from '@sparrow/standard-error';
import { getenv, STAGE, stage } from '@sparrow/utilities';

export interface DDBTableNames {
  readonly userProfileTableName: string;
  readonly canonicalUserIdMappingTableName: string;
  readonly cognitoUserRecoveryCodeTableName: string;
}

export interface DiscordNotifierConfigs {
  readonly webhookId: string;
  readonly webhookToken: string;
}

export interface StageConfig {
  readonly stage: STAGE;
  readonly appName: string;
  readonly servicePort: number;
  readonly websocketPort: number;
  readonly discordNotifierConfigs: DiscordNotifierConfigs;
}

function getStageConfig(stage: STAGE): StageConfig {
  return {
    stage: stage,
    appName: getenv(APPLICATION_NAME_KEY),
    servicePort: 3000,
    websocketPort: 3050,
  };
}

const config = getStageConfig(stage());

export default config;
