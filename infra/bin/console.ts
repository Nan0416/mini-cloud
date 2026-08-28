#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { CERTIFICATE_REGION, loadConsoleConfig } from '../lib/config';
import { ConsoleStack } from '../lib/console-stack';

const config = loadConsoleConfig();
const app = new App();

const stack = new ConsoleStack(app, 'MiniCloudConsole', {
  ...config,
  // Explicit rather than environment-agnostic: the certificate has to be in
  // us-east-1, and a stack that silently follows whatever AWS_PROFILE happens to be
  // set is one `cdk deploy` away from creating this in the wrong account.
  env: { account: config.account, region: CERTIFICATE_REGION },
  description: `Static hosting for the mini-cloud console at ${config.domainName} (S3, CloudFront, ACM, Route 53).`,
});

Tags.of(stack).add('Project', 'mini-cloud');
