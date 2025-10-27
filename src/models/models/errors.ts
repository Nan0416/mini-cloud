import { ErrorConstructor, HttpError } from '@sparrow/standard-error';

const nameToConstructor: Map<string, ErrorConstructor> = new Map();

export class InternalServiceError extends HttpError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = 'InternalServiceError';
  }
}
nameToConstructor.set('InternalServiceError', InternalServiceError);

export class InvalidRequestError extends InternalServiceError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'InvalidRequestError';
  }
}
nameToConstructor.set('InvalidRequestError', InvalidRequestError);

export class TaskNotFoundError extends InternalServiceError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'TaskNotFoundError';
  }
}
nameToConstructor.set('TaskNotFoundError', TaskNotFoundError);

export class TaskInstanceNotFoundError extends InternalServiceError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'TaskInstanceNotFoundError';
  }
}
nameToConstructor.set('TaskInstanceNotFoundError', TaskInstanceNotFoundError);

export class IssueNotFoundError extends InternalServiceError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'IssueNotFoundError';
  }
}
nameToConstructor.set('IssueNotFoundError', IssueNotFoundError);

export class NotImplementedError extends InternalServiceError {
  constructor(message: string) {
    super(message, 501);
    this.name = 'NotImplementedError';
  }
}
nameToConstructor.set('NotImplementedError', NotImplementedError);

export const ERROR_NAME_TO_CONSTRUCTOR: ReadonlyMap<string, ErrorConstructor> = nameToConstructor;
