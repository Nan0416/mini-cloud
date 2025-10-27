import { LoggerFactory } from '@sparrow/logging-js';
import { MessageHandlerImpl } from '../core/message';
import { Endpoints, IssueEndpoints, MessageEndpoints, TaskEndpoints } from '../endpoints';
import { FsVariableManager, MongoDBTaskDao, TaskAgentRequestBroadcasterImpl, TaskHandlerImpl } from '../core/task';
import { TaskAccessorImpl } from '../core/task/task-accessor-impl';
import { TaskAgent } from '../models';
import { DiscordIssueNotifier, IssueHandlerImpl, MongoDBIssueDao } from '../core/issue';
import { WebhookClient } from 'discord.js';
import { DiscordNotifierConfigs } from '../stage-config';

export interface Dependencies {
  readonly terminationCallback: () => Promise<void>;
  readonly issueEndpoints: Endpoints;
  readonly taskEndpoints: Endpoints;
  readonly messageEndpoints: Endpoints;
}

export interface DependencyFactoryProps {
  readonly messageWebsocketPort: number;
  readonly taskTopic: string;
  readonly fsVariablesPath: string;
  readonly taskAgents: TaskAgent[];
  readonly discordNotifierConfigs: DiscordNotifierConfigs;
}

const logger = LoggerFactory.getLogger('DependencyFactory');
export class DependencyFactory {
  private readonly props: DependencyFactoryProps;
  constructor(props: DependencyFactoryProps) {
    this.props = props;
  }
  async build(): Promise<Dependencies> {
    const discord = new WebhookClient({
      id: this.props.discordNotifierConfigs.webhookId,
      token: this.props.discordNotifierConfigs.webhookToken,
    });

    const notifier = new DiscordIssueNotifier(discord);
    const issueHandler = new IssueHandlerImpl(new MongoDBIssueDao(), notifier);
    const issueEndpoints = new IssueEndpoints(issueHandler);

    const messageHandler = new MessageHandlerImpl(this.props.messageWebsocketPort);
    const messageEndpoints = new MessageEndpoints(messageHandler);
    const taskAccessor = new TaskAccessorImpl(new MongoDBTaskDao(), true, true);
    const taskAgentRequestBroadcaster = new TaskAgentRequestBroadcasterImpl(this.props.taskTopic, messageHandler);
    const variableManager = new FsVariableManager(this.props.fsVariablesPath);

    const taskHandler = new TaskHandlerImpl({
      taskAccessor: taskAccessor,
      taskAgentRequestBroadcaster: taskAgentRequestBroadcaster,
      variableManager: variableManager,
      agentList: this.props.taskAgents,
      issueClient: issueHandler,
    });

    const taskEndpoints = new TaskEndpoints(taskHandler);

    return {
      terminationCallback: async () => {
        logger.info(`Terminating dependencies`);
        await messageHandler.terminate();
      },
      issueEndpoints: issueEndpoints,
      taskEndpoints: taskEndpoints,
      messageEndpoints: messageEndpoints,
    };
  }
}
