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
import { corsMiddleware } from '../middleware/cors';
import { errorHandler } from '../middleware/error-handler';
import { notFoundHandler } from '../middleware/not-found';
import { requestLogger } from '../middleware/request-logger';
import { subnetFilter } from '../middleware/subnet-filter';
import { AgentEndpoints } from '../routes/agent-endpoints';
import { AgentReportEndpoints } from '../routes/agent-report-endpoints';
import { Endpoints } from '../routes/endpoints';
import { HealthEndpoints } from '../routes/health-endpoints';
import { PubSubEndpoints } from '../routes/pubsub-endpoints';
import { TaskEndpoints } from '../routes/task-endpoints';
import { AgentService } from '../services/agent-service';
import { TaskService } from '../services/task-service';
import { ServiceConfig } from '../stage-config';

const logger = LoggerFactory.getLogger('DependencyFactory');

/** What each listener serves, for the hint in the other one's 404. */
const INTERNAL_ROUTES: ReadonlyArray<string> = ['/agent-api/*', '/pubsub/*', '/ws'];
const PUBLIC_ROUTES: ReadonlyArray<string> = ['/tasks', '/instances', '/agents', '/variables'];

/** One express application's worth of wiring: what runs before the routes, and the routes. */
export interface PlaneDependencies {
  readonly middleware: ReadonlyArray<RequestHandler>;
  readonly endpoints: ReadonlyArray<Endpoints>;
  readonly notFound: RequestHandler;
}

export interface Dependencies {
  /** Agents and LAN programs: reports, the pub/sub hub, health. */
  readonly internal: PlaneDependencies;
  /** The console and the CLI: tasks, instances, the fleet, variables. */
  readonly public: PlaneDependencies;
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
 *
 * The two listeners are two express applications over *one* set of services, DAOs and
 * facades: the split decides what is reachable from where, not what exists. A route
 * belongs to exactly one of them, and which one is decided by who calls it — agents
 * report inward, people drive from outside.
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

    return {
      internal: {
        middleware: this.internalMiddleware(),
        endpoints: [
          new HealthEndpoints({ pool }),
          new AgentReportEndpoints({ agentService, taskService }),
          // Also on the public listener: the console shows hub status and can publish,
          // while programs on the LAN publish here without needing the operator's token.
          new PubSubEndpoints({ messageHub }),
        ],
        notFound: notFoundHandler({
          plane: 'internal',
          otherPlane: 'public',
          otherPlanePort: config.public.port,
          otherPlaneServes: PUBLIC_ROUTES,
        }),
      },
      public: {
        middleware: this.publicMiddleware(),
        endpoints: [new HealthEndpoints({ pool }), new TaskEndpoints({ taskService }), new AgentEndpoints({ agentService }), new PubSubEndpoints({ messageHub })],
        notFound: notFoundHandler({
          plane: 'public',
          otherPlane: 'internal',
          otherPlanePort: config.internal.port,
          otherPlaneServes: INTERNAL_ROUTES,
        }),
      },
      errorHandler,
      scheduler,
      taskService,
      agentService,
    };
  }

  /**
   * No CORS, deliberately. A browser cannot then read an answer from this listener,
   * which is the difference between "a page you visited reached your agents" and
   * "a page you visited was refused". The console never calls it.
   */
  private internalMiddleware(): ReadonlyArray<RequestHandler> {
    const { internal } = this.props.config;
    const middleware: RequestHandler[] = [requestLogger()];

    if (internal.trustedSubnets.length > 0) {
      logger.info(`The internal listener accepts connections from [${internal.trustedSubnets.join(', ')}].`);
      middleware.push(subnetFilter({ subnets: internal.trustedSubnets }));
    } else {
      logger.warn('MINI_CLOUD_TRUSTED_SUBNETS is empty: the internal listener accepts a connection from any address that can reach it.');
    }

    return middleware;
  }

  private publicMiddleware(): ReadonlyArray<RequestHandler> {
    const { public: publicConfig } = this.props.config;
    const middleware: RequestHandler[] = [requestLogger()];

    // Ahead of authentication on purpose: a browser preflight carries no bearer
    // token, so an auth-first ordering fails every cross-origin request.
    if (publicConfig.corsOrigins.length > 0) {
      // Warned rather than logged, for the same reason the missing token is: a
      // service any page can drive should say so on every start, not only in a
      // document someone has to go and read.
      if (publicConfig.corsOrigins.includes('*')) {
        logger.warn('MINI_CLOUD_CORS_ORIGINS allows any origin: any web page the operator visits can call the public listener. Set it to your console origin to narrow that.');
      } else {
        logger.info(`Cross-origin requests are allowed from [${publicConfig.corsOrigins.join(', ')}].`);
      }
      middleware.push(corsMiddleware({ origins: publicConfig.corsOrigins }));
    }

    // Refused here rather than on the way in from the environment, so the failure
    // lands when a listener is about to be built rather than when the package is
    // imported — the CLI imports it for every command, `--help` included.
    if (publicConfig.authToken === undefined) {
      throw new Error(
        'MINI_CLOUD_PUBLIC_TOKEN is not set. The public listener will not start without one: it is the listener a port forward points at, and anything that reaches it can launch programs on your machines.',
      );
    }
    logger.info('The public listener requires a bearer token.');
    middleware.push(bearerTokenAuth(publicConfig.authToken));

    return middleware;
  }
}
