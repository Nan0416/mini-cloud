import { APPLICATION_NAME_KEY } from '@sparrow/standard-error';
import { getenv, STAGE, stage } from '@sparrow/utilities';

export interface DDBTableNames {
  readonly userProfileTableName: string;
  readonly canonicalUserIdMappingTableName: string;
  readonly cognitoUserRecoveryCodeTableName: string;
}

export interface StageConfig {
  readonly stage: STAGE;
  readonly appName: string;
  readonly region: 'us-east-1';
  readonly firstPartyCognitoUserPoolId: string;
  readonly ddbTableNames: DDBTableNames;
  readonly localPort: number;
}

function getStageConfig(stage: STAGE): StageConfig {
  return {
    stage: stage,
    appName: getenv(APPLICATION_NAME_KEY),
    region: 'us-east-1',
    firstPartyCognitoUserPoolId: getenv('FIRST_PARTY_COGNITO_USER_POOL_ID'),
    localPort: 3000,
    ddbTableNames: {
      userProfileTableName: getenv('UserProfileTableName'),
      canonicalUserIdMappingTableName: getenv('CanonicalUserIdMappingTableName'),
      cognitoUserRecoveryCodeTableName: getenv('CognitoUserRecoveryCodeTableName'),
    },
  };
}

const config = getStageConfig(stage());

export default config;
