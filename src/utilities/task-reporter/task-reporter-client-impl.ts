import { LoggerFactory } from '@sparrow/logging-js';
import {
  ReportEventRequest,
  ReportEventResponse,
  ReportExitRequest,
  ReportExitResponse,
  ReportPassiveHealthCheckRequest,
  ReportPassiveHealthCheckResponse,
  ReportPidRequest,
  ReportPidResponse,
  ReportTerminationRequest,
  ReportTerminationResponse,
  TaskReporterClient,
} from '../../models';

const logger = LoggerFactory.getLogger('TaskReporterClientImpl');

/**
 * Run inside task process.
 */

export class TaskReporterClientImpl implements TaskReporterClient {
  reportPid(request: ReportPidRequest): Promise<ReportPidResponse> {
    throw new Error('Method not implemented.');
  }
  reportTermination(request: ReportTerminationRequest): Promise<ReportTerminationResponse> {
    throw new Error('Method not implemented.');
  }
  reportExit(request: ReportExitRequest): Promise<ReportExitResponse> {
    throw new Error('Method not implemented.');
  }
  reportEvent(request: ReportEventRequest): Promise<ReportEventResponse> {
    throw new Error('Method not implemented.');
  }
  reportPassiveHealthCheck(request: ReportPassiveHealthCheckRequest): Promise<ReportPassiveHealthCheckResponse> {
    throw new Error('Method not implemented.');
  }
}
