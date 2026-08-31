# @mini-cloud/shared

Domain models, API contracts, error types and utilities shared by every
[mini-cloud](https://github.com/Nan0416/mini-cloud) package.

```bash
npm install @mini-cloud/shared
```

**You probably do not need to install this directly.** It is published because
[`@mini-cloud/reporter`](https://www.npmjs.com/package/@mini-cloud/reporter) depends on
it, and a dependency that is not on the registry is not installable. Install the
reporter and this comes with it.

It is worth having on its own only if you are talking to a mini-cloud service by hand
and want the request and response types the service actually implements, rather than
writing your own and finding out where they differ at runtime.

It imports nothing of ours and has no runtime dependencies.

## What is in it

| | |
| --- | --- |
| `models/` | `Task`, `TaskInstance`, `TaskEvent`, `TaskAgent`, the status vocabularies and their rank ordering |
| `api/` | One `Request` and one `Response` interface per operation — the contract the service implements and every client compiles against |
| `errors.ts` | `AppError` and its subclasses, each fixing a status code and an error code |
| `utils/` | Runtime assertions for data crossing a trust boundary, a logger, `${NAME}` variable substitution, a serial async queue |

## Errors

The reason these are shared rather than per-package: a caller can ask *"is this a
failure we expected?"* and *"which one?"* without matching on strings, and get the same
answer in the CLI, the agent and the browser console as the service gave.

```ts
import { NotFoundError, ServiceUnreachableError } from '@mini-cloud/shared';

try {
  await client.getTask({ taskId });
} catch (err) {
  if (err instanceof NotFoundError) {
    // The service answered, and said no.
  } else if (err instanceof ServiceUnreachableError) {
    // There was no service to ask. A different thing, and a different message.
  }
}
```

## Stability

Versioned together with the rest of mini-cloud and released in lockstep with
`@mini-cloud/reporter`. The models and the error hierarchy are the stable part; treat
everything under `utils/` as an implementation detail that may change.

## License

MIT
