import { BaseRequestAssertions } from '@sparrow/common-express-middlewares';
import { JSONSchemaType } from 'ajv';
import { InvalidRequestError, ReportEventRequest, ReportExitRequest, ReportPassiveHealthCheckRequest, ReportPidRequest, ReportTerminationRequest, TASK_EVENT_LEVELS } from '../../models';

export class TaskAgentRequestAssertions extends BaseRequestAssertions {
  constructor() {
    super(InvalidRequestError);
    this.ajv.addSchema(this.provideReportPidRequestSchema(), 'ReportPidRequest');
    this.ajv.addSchema(this.provideReportTerminationRequestSchema(), 'ReportTerminationRequest');
    this.ajv.addSchema(this.provideReportExitRequestSchema(), 'ReportExitRequest');
    this.ajv.addSchema(this.provideReportEventRequestSchema(), 'ReportEventRequest');
    this.ajv.addSchema(this.provideReportPassiveHealthCheckRequesttSchema(), 'ReportPassiveHealthCheckRequest');
  }

  assert(model: 'ReportPidRequest', request: any): ReportPidRequest;
  assert(model: 'ReportTerminationRequest', request: any): ReportTerminationRequest;
  assert(model: 'ReportExitRequest', request: any): ReportExitRequest;
  assert(model: 'ReportEventRequest', request: any): ReportEventRequest;
  assert(model: 'ReportPassiveHealthCheckRequest', request: any): ReportPassiveHealthCheckRequest;

  assert<T>(model: string, request: T): T {
    return super.assert(model, request);
  }

  private provideReportPidRequestSchema(): JSONSchemaType<ReportPidRequest> {
    return {
      type: 'object',
      properties: {
        taskInstanceId: { type: 'string', minLength: 1 },
        pid: { type: 'number' },
      },
      required: ['taskInstanceId', 'pid'],
      additionalProperties: false,
    };
  }

  private provideReportTerminationRequestSchema(): JSONSchemaType<ReportTerminationRequest> {
    return {
      type: 'object',
      properties: {
        taskInstanceId: { type: 'string', minLength: 1 },
      },
      required: ['taskInstanceId'],
      additionalProperties: false,
    };
  }

  private provideReportExitRequestSchema(): JSONSchemaType<ReportExitRequest> {
    return {
      type: 'object',
      properties: {
        taskInstanceId: { type: 'string', minLength: 1 },
        code: { type: 'number', nullable: true },
      },
      required: ['taskInstanceId'],
      additionalProperties: false,
    };
  }

  private provideReportEventRequestSchema(): JSONSchemaType<ReportEventRequest> {
    return {
      type: 'object',
      properties: {
        taskInstanceId: { type: 'string', minLength: 1 },
        timestamp: { type: 'number' },
        level: { type: 'string', enum: TASK_EVENT_LEVELS },
        payload: {} as any,
      },
      required: ['taskInstanceId', 'timestamp', 'level', 'payload'],
      additionalProperties: false,
    };
  }

  private provideReportPassiveHealthCheckRequesttSchema(): JSONSchemaType<ReportPassiveHealthCheckRequest> {
    return {
      type: 'object',
      properties: {
        taskInstanceId: { type: 'string', minLength: 1 },
      },
      required: ['taskInstanceId'],
      additionalProperties: false,
    };
  }
}
