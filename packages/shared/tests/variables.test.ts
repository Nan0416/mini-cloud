import { SubstitutableFields, substituteLaunchFields, substituteVariables } from '../src/utils/variables';

describe('substituteVariables', () => {
  it('replaces every occurrence of a known placeholder', () => {
    expect(substituteVariables('${DIR}/logs/${DIR}.log', { DIR: '/srv' })).toBe('/srv/logs//srv.log');
  });

  it('leaves unknown placeholders intact so the agent can resolve them later', () => {
    expect(substituteVariables('${PROJECT}/${HOME}/run', { PROJECT: '/opt/app' })).toBe('/opt/app/${HOME}/run');
  });

  it('does not re-expand placeholders that appear inside a substituted value', () => {
    // Without single-pass substitution this would recurse into VALUE and the result
    // would depend on which key was iterated first.
    expect(substituteVariables('${OUTER}', { OUTER: '${INNER}', INNER: 'expanded' })).toBe('${INNER}');
  });

  it('tolerates regex metacharacters in values', () => {
    expect(substituteVariables('${A}', { A: '$& (.*) [x]' })).toBe('$& (.*) [x]');
  });

  it('ignores placeholders that are not valid identifiers', () => {
    expect(substituteVariables('${not-an-identifier}', { 'not-an-identifier': 'x' })).toBe('${not-an-identifier}');
  });
});

describe('substituteLaunchFields', () => {
  const variables = { ROOT: '/srv/app', STAGE: 'beta' };

  it('substitutes across cmd, cwd, arguments, env and stdio paths', () => {
    const result = substituteLaunchFields(
      {
        cmd: '${ROOT}/bin/run',
        cwd: '${ROOT}',
        arguments: ['--stage', '${STAGE}'],
        env: { DATA_DIR: '${ROOT}/data', STATIC: 'unchanged' },
        stdout: '${ROOT}/out.log',
        stderr: '${ROOT}/err.log',
      },
      variables,
    );

    expect(result.cmd).toBe('/srv/app/bin/run');
    expect(result.cwd).toBe('/srv/app');
    expect(result.arguments).toEqual(['--stage', 'beta']);
    expect(result.env).toEqual({ DATA_DIR: '/srv/app/data', STATIC: 'unchanged' });
    expect(result.stdout).toBe('/srv/app/out.log');
    expect(result.stderr).toBe('/srv/app/err.log');
  });

  it('substitutes into a ping health check without touching a passive one', () => {
    const ping = substituteLaunchFields({ cmd: 'x', cwd: '/', healthCheck: { type: 'ping', domain: 'http://localhost:${PORT}', path: '/${STAGE}/ping' } }, { ...variables, PORT: '9000' });
    expect(ping.healthCheck).toEqual({ type: 'ping', domain: 'http://localhost:9000', path: '/beta/ping' });

    const passive = substituteLaunchFields({ cmd: 'x', cwd: '/', healthCheck: { type: 'passive', periodInMs: 5000 } }, variables);
    expect(passive.healthCheck).toEqual({ type: 'passive', periodInMs: 5000 });
  });

  it('leaves optional fields undefined rather than turning them into empty strings', () => {
    const fields: SubstitutableFields = { cmd: 'run', cwd: '/' };
    const result = substituteLaunchFields(fields, variables);
    expect(result.arguments).toBeUndefined();
    expect(result.env).toBeUndefined();
    expect(result.stdout).toBeUndefined();
    expect(result.healthCheck).toBeUndefined();
  });
});
