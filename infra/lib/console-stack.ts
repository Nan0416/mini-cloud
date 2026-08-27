import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ConsoleConfig } from './config';

export interface ConsoleStackProps extends StackProps, ConsoleConfig {}

/** Where `vite build` leaves the console, relative to this file. */
const BUNDLE_DIR = path.join(__dirname, '..', '..', 'packages', 'web', 'dist');

/**
 * Everything behind `https://<domainName>`: a private bucket, the distribution that
 * fronts it, the certificate that terminates TLS and the DNS records that point at it.
 *
 * One stack rather than several because the certificate must be in `us-east-1` for
 * CloudFront to accept it, and splitting on that line would buy a cross-region
 * reference and nothing else.
 *
 * The site is a static client that stores nothing and knows nothing until the visitor
 * tells it where their own mini-cloud is. That shapes two decisions below that look
 * like oversights and are not: no service URL is baked into the bundle, and the
 * response headers deliberately leave mixed content alone.
 */
export class ConsoleStack extends Stack {
  constructor(scope: Construct, id: string, props: ConsoleStackProps) {
    super(scope, id, props);

    // Caught here rather than as a stack trace out of the asset bundler, which reports
    // this as a missing directory and says nothing about how to produce it.
    if (!existsSync(path.join(BUNDLE_DIR, 'index.html'))) {
      throw new Error(`No console bundle at ${BUNDLE_DIR}. Build it first: npm run build -w @mini-cloud/web, from the repository root.`);
    }

    const bucket = new s3.Bucket(this, 'ConsoleBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // No website endpoint on purpose: that endpoint is public by definition, and
      // CloudFront reaches the bucket through Origin Access Control instead, so the
      // only way to the objects is through the distribution.
      //
      // Destroyed with the stack because the contents are `vite build` output and
      // nothing else — reproducible from any tag, with no state to lose and no reason
      // to leave a bucket behind that someone pays for and nobody remembers.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Imported by attributes rather than looked up: `fromLookup` needs credentials
    // during synth and writes its answer into cdk.context.json, which turns a plain
    // `cdk synth` in CI into an AWS call and a cache someone has to remember to refresh.
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    // DNS validation against that zone, so the whole issuance happens inside the
    // deployment. `cdk deploy` will sit and wait here on the first run while the
    // validation record propagates.
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const responseHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'mini-cloud console — security headers chosen not to touch mixed content',
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        // Nothing on this page benefits from sending a referrer, and the URL can carry
        // `?backend=<the visitor's own service address>` in it.
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        // Safe: HSTS governs how a browser reaches *this* origin, and says nothing
        // about the plain-HTTP request the console then makes to the visitor's service.
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
        // The policy names `frame-ancestors` and nothing else, on purpose. Directives
        // left unset stay unrestricted, so `connect-src` remains open — the console's
        // entire job is calling a service at an origin no policy written here can
        // predict.
        //
        // NEVER add `upgrade-insecure-requests` or `block-all-mixed-content`, and never
        // add a `default-src`. Any of the three rewrites or kills the request to
        // http://localhost:3000, which is the only backend a hosted copy can reach at
        // all — it would break the entire product on this domain, silently, with the
        // page still loading perfectly.
        contentSecurityPolicy: { contentSecurityPolicy: "frame-ancestors 'none'", override: true },
      },
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `mini-cloud console (${props.domainName})`,
      domainNames: [props.domainName],
      certificate,
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: responseHeaders,
        compress: true,
      },
      // react-router owns the paths, so a deep link has to reach the bundle rather than
      // an error page. Both codes are mapped because a key missing from a *private*
      // bucket comes back as 403, not 404 — mapping only 404 is the bug everyone hits
      // once. The zero TTL keeps a genuinely missing asset from being cached as HTML.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
    });

    // Two deployments because `Cache-Control` is set per deployment and the two halves
    // of a Vite build want opposite answers.
    //
    // Both set `prune: false`, which is not an optimisation: pruning deletes whatever
    // is in the bucket and not in *that* deployment's source, so the assets deployment
    // would delete index.html and the index deployment would delete every asset. It
    // also means a rollout leaves the previous build's hashed assets in place, which is
    // what a visitor still holding the old index.html needs.
    const assets = new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [s3deploy.Source.asset(BUNDLE_DIR, { exclude: ['index.html'] })],
      destinationBucket: bucket,
      // Content-hashed by Vite, so the name changes whenever the bytes do and no
      // invalidation is ever needed for these.
      cacheControl: [s3deploy.CacheControl.maxAge(Duration.days(365)), s3deploy.CacheControl.immutable()],
      prune: false,
    });

    const index = new s3deploy.BucketDeployment(this, 'DeployIndex', {
      sources: [s3deploy.Source.asset(BUNDLE_DIR, { exclude: ['*', '!index.html'] })],
      destinationBucket: bucket,
      // Revalidated on every load, so a deploy is visible on the next reload instead of
      // leaving people on the old bundle for a day.
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution,
      distributionPaths: ['/index.html'],
      prune: false,
    });

    // Ordered, so there is no window in which the new index.html is live and pointing
    // at hashed assets that have not been uploaded yet.
    index.node.addDependency(assets);

    const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
    new route53.ARecord(this, 'AliasIpv4', { zone, recordName: props.domainName, target });
    // CloudFront answers on IPv6 as well, and a visitor on an IPv6-only network reaches
    // nothing without this record.
    new route53.AaaaRecord(this, 'AliasIpv6', { zone, recordName: props.domainName, target });

    new CfnOutput(this, 'ConsoleUrl', { value: `https://${props.domainName}`, description: 'The hosted console.' });
    new CfnOutput(this, 'DistributionDomainName', { value: distribution.distributionDomainName, description: 'CloudFront domain, for checking the site before DNS resolves.' });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId, description: 'For a manual invalidation.' });
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName, description: 'Holds the built console.' });
  }
}
