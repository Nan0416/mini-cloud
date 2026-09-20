import { LoggerFactory, PutMetricDataResponse } from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { MetricService } from '../services/metric-service';
import { parsePutMetricDataRequest } from '../utils/request-parsing';
import { Endpoints } from './endpoints';

const logger = LoggerFactory.getLogger('MetricReportEndpoints');

export interface MetricReportEndpointsProps {
  readonly metricService: MetricService;
}

/**
 * Where agents deliver metrics. Internal listener only, like every other report.
 *
 * Separate from `MetricEndpoints`, which serves queries to the console and the CLI,
 * because the split is by who calls: a class binds to exactly one listener, so one
 * holding both would have to put ingest on the internet-facing port or queries on the
 * one agents use.
 */
export class MetricReportEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: MetricReportEndpointsProps) {
    const { metricService } = props;
    this.router = Router();

    this.router.post('/agent-api/metrics', async (req, res) => {
      const request = parsePutMetricDataRequest(req.body);
      const response: PutMetricDataResponse = await metricService.putMetricData(request);
      if (response.duplicate) {
        logger.debug(`Agent ${request.agentId} replayed batch ${request.batchId}.`);
      } else {
        logger.debug(`Agent ${request.agentId} reported ${response.accepted} metric datum(s) in batch ${request.batchId}.`);
      }
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}
