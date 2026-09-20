import { GetMetricDataResponse, ListMetricDimensionsResponse, ListMetricNamesResponse, ListMetricNamespacesResponse } from '@mini-cloud/shared';
import { Router } from 'express';
import type { Express } from 'express';
import { MetricService } from '../services/metric-service';
import { parseGetMetricDataRequest, parseListMetricDimensionsRequest, parseListMetricNamesRequest } from '../utils/request-parsing';
import { Endpoints } from './endpoints';

export interface MetricEndpointsProps {
  readonly metricService: MetricService;
}

/**
 * Reading metrics: what exists, and what a series did over a range.
 *
 * All four are reads, so all four are GETs with the query in the query string. The
 * dimension set is the awkward one — it is a map, and a map has no natural query-string
 * form — so it travels as repeated `dimension=Name:Value` parameters rather than as
 * something JSON-encoded a person could not type by hand.
 */
export class MetricEndpoints implements Endpoints {
  private readonly router: Router;

  constructor(props: MetricEndpointsProps) {
    const { metricService } = props;
    this.router = Router();

    this.router.get('/metrics/namespaces', async (_req, res) => {
      const response: ListMetricNamespacesResponse = await metricService.listNamespaces({});
      res.status(200).json(response);
    });

    this.router.get('/metrics/names', async (req, res) => {
      const request = parseListMetricNamesRequest(req.query);
      const response: ListMetricNamesResponse = await metricService.listMetricNames(request);
      res.status(200).json(response);
    });

    this.router.get('/metrics/dimensions', async (req, res) => {
      const request = parseListMetricDimensionsRequest(req.query);
      const response: ListMetricDimensionsResponse = await metricService.listDimensions(request);
      res.status(200).json(response);
    });

    this.router.get('/metrics/data', async (req, res) => {
      const request = parseGetMetricDataRequest(req.query);
      const response: GetMetricDataResponse = await metricService.getMetricData(request);
      res.status(200).json(response);
    });
  }

  bind(app: Express): void {
    app.use(this.router);
  }
}
