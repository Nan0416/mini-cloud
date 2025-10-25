import { ErrorConstructor, HttpError } from '@sparrow/standard-error';

const nameToConstructor: Map<string, ErrorConstructor> = new Map();

export class InternalServiceError extends HttpError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = 'InternalServiceError';
  }
}
nameToConstructor.set('AccountServiceError', InternalServiceError);

export class InvalidRequestError extends InternalServiceError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'InvalidRequestError';
  }
}
nameToConstructor.set('InvalidRequestError', InvalidRequestError);

export class AccountNotFoundError extends InternalServiceError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'AccountNotFoundError';
  }
}
nameToConstructor.set('AccountNotFoundError', AccountNotFoundError);

export class NotImplementedError extends InternalServiceError {
  constructor(message: string) {
    super(message, 501);
    this.name = 'NotImplementedError';
  }
}
nameToConstructor.set('NotImplementedError', NotImplementedError);

export const ERROR_NAME_TO_CONSTRUCTOR: ReadonlyMap<string, ErrorConstructor> = nameToConstructor;
