import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/** The distribution path the bucket is served under. CloudFront forwards it, so keys carry it too. */
export const DOWNLOADS_PATH_PATTERN = 'downloads/*';

/** Where the release workflow writes, and so the only prefix its role may touch. */
const CLI_PREFIX = 'downloads/cli';

export interface DownloadsProps {
  /** `owner/name`; only this repository's `cli-v*` tags may publish. */
  readonly githubRepository: string;
}

/**
 * The `mini-cloud` binaries, served at `https://<domain>/downloads/cli/`: a private
 * bucket, and a role the release workflow assumes over GitHub's OIDC to write to it.
 *
 * {@link behavior} goes on the console's distribution rather than a second one, so the
 * binaries share its domain and certificate.
 */
export class Downloads extends Construct {
  readonly bucket: s3.Bucket;
  readonly behavior: cloudfront.BehaviorOptions;

  constructor(scope: Construct, id: string, props: DownloadsProps) {
    super(scope, id);
    const stack = Stack.of(this);

    this.bucket = new s3.Bucket(this, 'Bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Kept, unlike the console's bucket: a release rebuilt from its tag is not the
      // same bytes as the one whose checksums people already have.
      removalPolicy: RemovalPolicy.RETAIN,
      // A tarball is uploaded in parts, and an abandoned upload — a cancelled job, a
      // failed part — leaves parts that no object listing shows and that are billed
      // until something removes them. Nothing else here ever writes a multipart upload.
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
    });

    this.behavior = {
      // LIST as well as READ, so a missing file is a 404 rather than S3's 403 for a key
      // it will not confirm the absence of.
      origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket, {
        originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST],
      }),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      // Honours the Cache-Control the workflow sets: `immutable` on a version's
      // directory, `no-cache` on the two files that name the latest one.
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    };

    // Imported: an account holds one provider per issuer URL, and this one already has it.
    const github = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GithubOidc',
      `arn:${stack.partition}:iam::${stack.account}:oidc-provider/token.actions.githubusercontent.com`,
    );

    const role = new iam.Role(this, 'ReleaseRole', {
      // Named, so its ARN — which lives in a GitHub secret — survives a replacement.
      roleName: 'mini-cloud-cli-release',
      description: `Assumed by ${props.githubRepository}'s release workflow to publish the mini-cloud binaries.`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.OpenIdConnectPrincipal(github, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${props.githubRepository}:ref:refs/tags/cli-v*` },
      }),
    });
    // Every tarball is over the CLI's multipart threshold, so uploading one is
    // CreateMultipartUpload/UploadPart/CompleteMultipartUpload — all authorized as
    // PutObject — plus AbortMultipartUpload when a part fails or the job is cancelled.
    // Without that last one the abort fails with AccessDenied, which buries the error
    // that caused it and strands the parts.
    role.addToPolicy(new iam.PolicyStatement({ actions: ['s3:PutObject', 's3:AbortMultipartUpload'], resources: [this.bucket.arnForObjects(`${CLI_PREFIX}/*`)] }));
    // Listing is what lets the workflow refuse to publish a version's directory twice,
    // which is the only thing keeping `immutable` honest.
    role.addToPolicy(new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [this.bucket.bucketArn] }));

    new CfnOutput(stack, 'DownloadsBucketName', { value: this.bucket.bucketName, description: 'The DOWNLOADS_BUCKET secret of the release workflow.' });
    new CfnOutput(stack, 'ReleaseRoleArn', { value: role.roleArn, description: 'The AWS_RELEASE_ROLE_ARN secret of the release workflow.' });
  }
}
