
## Setup Permission

For the first time user, configure an AWS profile with AWS SSO.

```
aws configure sso --profile sparrow-codeartifact
```

* Give an SSO session name,
* The SSO start URL: see below
* The SSO region must be us-east-1 (SSO and IAM identity center only support us-east-1)
* SSO registration sopces [sso:account:access]: leave it empty

Choose the account and roles you want to associate with the profile

* CLI default client Region [None]: depends on your service regison.
* CLI default output format [None]: json

To refresh the credentials on the profile,

```
aws sso login --profile sparrow-codeartifact
```

### SSO start URLs

1. CrepeTrade: https://crepe.awsapps.com/start/#/?tab=accounts
2. Sparrow: https://sparrow2024.awsapps.com/start/#/?tab=accounts