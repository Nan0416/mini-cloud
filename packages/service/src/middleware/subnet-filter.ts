import { ForbiddenError, LoggerFactory } from '@mini-cloud/shared';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Subnet, describeUntrustedAddress, isTrustedAddress, parseSubnets } from '../utils/subnet';

const logger = LoggerFactory.getLogger('SubnetFilter');

export interface SubnetFilterOptions {
  /** CIDR blocks allowed to reach this listener. Parsed here, so a typo fails at startup. */
  readonly subnets: ReadonlyArray<string>;
}

/**
 * Restricts a listener to a set of source networks — the home LAN, for the internal
 * listener that carries agent traffic.
 *
 * Two deliberate choices. The address comes from `req.socket.remoteAddress`, never
 * from `req.ip` or `X-Forwarded-For`: those are caller-supplied, so a filter reading
 * them admits anyone willing to send a header, which is worse than no filter at all
 * because it looks like protection. And the rule is an allow-list rather than a
 * deny-list of public ranges, so an address nobody anticipated is refused instead of
 * admitted.
 *
 * This is defence in depth, not the boundary. Binding the listener to one interface
 * is what actually keeps packets away; this catches the case where the interface is
 * reachable from further than expected — a port forward on the router, a bridged
 * guest network — and says so in the log rather than serving the request.
 */
export function subnetFilter(options: SubnetFilterOptions): RequestHandler {
  const subnets: ReadonlyArray<Subnet> = parseSubnets(options.subnets);

  return (req: Request, _res: Response, next: NextFunction): void => {
    const address = req.socket.remoteAddress;
    if (isTrustedAddress(address, subnets)) {
      next();
      return;
    }

    logger.warn(`Rejected ${req.method} ${req.path} from ${address ?? 'an unknown address'}: outside the trusted subnets.`);
    next(new ForbiddenError(describeUntrustedAddress(address, subnets)));
  };
}
