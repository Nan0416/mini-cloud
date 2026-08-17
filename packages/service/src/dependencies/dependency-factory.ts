import { LoggerFactory } from '@mini-cloud/shared';
import { ErrorRequestHandler, RequestHandler } from 'express';
import { Pool } from 'pg';
import { PgAgentDao } from '../data/pg-agent-dao';
import { PgTaskDao } from '../data/pg-task-dao';
import { PgTaskDynamicsDao } from '../data/pg-task-dynamics-dao';
import { PgTaskEventDao } from '../data/pg-task-event-dao';
import { PgTaskInstanceDao } from '../data/pg-task-instance-dao';
import { PgVariableDao } from '../data/pg-variable-dao';
import { HubAgentCommander } from '../facades/agent-commander';
import { MessageHub } from '../facades/message-hub';
import { Scheduler } from '../facades/scheduler';
import { TaskDispatcher } from '../facades/task-dispatcher';
import { bearerTokenAuth } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { requestLogger } from '../middleware/request-logger';
import { AgentEndpoints } from '../routes/agent-endpoints';
import { Endpoints } from '../routes/endpoints';
import { HealthEndpoints } from '../routes/health-endpoints';
import { PubSubEndpoints } from '../routes/pubsub-endpoints';
import { TaskEndpoints } from '../routes/task-endpoints';
import { AgentService } from '../services/agent-service';
import { TaskService } from '../services/task-service';
import { ServiceConfig } from '../stage-config';

const logger = LoggerFactory.getLogger('DependencyFactory');

export interface Dependencies {
  readonly middleware: ReadonlyArray<RequestHandler>;
  readonly endpoints: ReadonlyArray<Endpoints>;
  readonly errorHandler: ErrorRequestHandler;
  readonly scheduler: Scheduler;
  readonly taskService: TaskService;
  readonly agentService: AgentService;
}

export interface DependencyFactoryProps {
  readonly config: ServiceConfig;
  readonly pool: Pool;
  readonly messageHub: MessageHub;
}

/**
 * The one place the object graph is wired.
 *
 * Every component takes its collaborators as constructor arguments and nothing
 * reaches for a module-level singleton, so a test can substitute a fake DAO or hub by
 * building the same graph with different leaves.
 */
export class DependencyFactory {
  constructor(private readonly props: DependencyFactoryProps) {}

  build(): Dependencies {
    const { config, pool, messageHub } = this.props;
    logger.info('Building service dependencies.');

    const taskDao = new PgTaskDao(pool);
    const taskDynamicsDao = new PgTaskDynamicsDao(pool);
    const taskInstanceDao = new PgTaskInstanceDao(pool);
    const taskEventDao = new PgTaskEventDao(pool);
    const agentDao = new PgAgentDao(pool);
    const variableDao = new PgVariableDao(pool);

    const agentCommander = new HubAgentCommander(messageHub);
    const taskDispatcher = new TaskDispatcher({ taskInstanceDao, taskEventDao, agentCommander });

    const taskService = new TaskService({ taskDao, taskDynamicsDao, taskInstanceDao, taskEventDao, variableDao, agentCommander, taskDispatcher });
    const agentService = new AgentService({ agentDao, agentCommander });

    const scheduler = new Scheduler({
      taskDao,
      taskInstanceDao,
      taskEventDao,
      agentDao,
      variableDao,
      agentCommander,
      taskDispatcher,
      config: config.scheduler,
    });

    const middleware: RequestHandler[] = [requestLogger()];
    if (config.authToken !== undefined) {
      logger.info('Bearer token authentication is enabled.');
      middleware.push(bearerTokenAuth(config.authToken));
    } else {
      logger.warn('MINI_CLOUD_TOKEN is not set: the service is accepting unauthenticated requests.');
    }

    const endpoints: Endpoints[] = [
      new HealthEndpoints({ pool }),
      new TaskEndpoints({ taskService }),
      new AgentEndpoints({ agentService, taskService }),
      new PubSubEndpoints({ messageHub }),
    ];

    return { middleware, endpoints, errorHandler, scheduler, taskService, agentService };
  }
}
