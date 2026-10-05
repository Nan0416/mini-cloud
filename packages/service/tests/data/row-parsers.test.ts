import { InternalServiceError } from '@mini-cloud/shared';
import { toAgentStatus, toMonitorSeverity, toNotifierType, toTaskEventLevel, toTaskEventSource, toTaskInstanceStatus } from '../../src/data/row-parsers';

/**
 * These narrowers are the seam between a `TEXT` column and a TypeScript union. The
 * schema's CHECK constraints mean a value outside the union can only arrive if the
 * two have drifted apart, so what matters is that drift is loud rather than quietly
 * cast through.
 */
describe('toTaskInstanceStatus', () => {
  it('passes through every status the lifecycle defines', () => {
    expect(toTaskInstanceStatus('init', 'i1')).toBe('init');
    expect(toTaskInstanceStatus('running', 'i1')).toBe('running');
    expect(toTaskInstanceStatus('health_check_failure', 'i1')).toBe('health_check_failure');
    expect(toTaskInstanceStatus('exit_failure', 'i1')).toBe('exit_failure');
  });

  it('rejects a value the union does not contain, naming the row so the drift is findable', () => {
    expect(() => toTaskInstanceStatus('halfway', 'i1')).toThrow(InternalServiceError);
    expect(() => toTaskInstanceStatus('halfway', 'i1')).toThrow(/i1.*status.*halfway/);
  });

  it('does not accept a near miss', () => {
    // Case and whitespace both come straight from the column, so neither is fixed up.
    expect(() => toTaskInstanceStatus('RUNNING', 'i1')).toThrow(InternalServiceError);
    expect(() => toTaskInstanceStatus('running ', 'i1')).toThrow(InternalServiceError);
    expect(() => toTaskInstanceStatus('', 'i1')).toThrow(InternalServiceError);
  });
});

describe('toTaskEventSource', () => {
  it('accepts the three sources an event can carry', () => {
    expect(toTaskEventSource('service', 'e1')).toBe('service');
    expect(toTaskEventSource('agent', 'e1')).toBe('agent');
    expect(toTaskEventSource('task', 'e1')).toBe('task');
  });

  it('rejects anything else', () => {
    expect(() => toTaskEventSource('scheduler', 'e1')).toThrow(/e1.*source.*scheduler/);
  });
});

describe('toTaskEventLevel', () => {
  it('accepts the three levels', () => {
    expect(toTaskEventLevel('success', 'e1')).toBe('success');
    expect(toTaskEventLevel('warning', 'e1')).toBe('warning');
    expect(toTaskEventLevel('error', 'e1')).toBe('error');
  });

  it('rejects a level borrowed from the logger rather than the schema', () => {
    expect(() => toTaskEventLevel('info', 'e1')).toThrow(/e1.*level.*info/);
    expect(() => toTaskEventLevel('debug', 'e1')).toThrow(InternalServiceError);
  });
});

describe('toAgentStatus', () => {
  it('accepts the two states an agent can be in', () => {
    expect(toAgentStatus('online', 'a1')).toBe('online');
    expect(toAgentStatus('offline', 'a1')).toBe('offline');
  });

  it('rejects anything else', () => {
    expect(() => toAgentStatus('unknown', 'a1')).toThrow(/a1.*status.*unknown/);
  });
});

describe('toMonitorSeverity', () => {
  it('accepts 1 to 5 and rejects anything else, naming the monitor', () => {
    expect(toMonitorSeverity(1, 'nas-cpu')).toBe(1);
    expect(toMonitorSeverity(5, 'nas-cpu')).toBe(5);
    expect(() => toMonitorSeverity(6, 'nas-cpu')).toThrow(/nas-cpu.*severity 6/);
  });
});

describe('toNotifierType', () => {
  it('accepts the types there are senders for, and rejects anything else', () => {
    expect(toNotifierType('discord', 'ntf-a')).toBe('discord');
    expect(() => toNotifierType('email', 'ntf-a')).toThrow(InternalServiceError);
  });
});
