# Setup

## Dependencies

1. Install MongoDB, tested with Community Edition 8.2 MacOS version, installed with HomeBrew

https://www.mongodb.com/docs/manual/administration/install-community/?operating-system=macos&macos-installation-method=homebrew

```zsh
brew tap mongodb/brew
brew update
brew install mongodb-community@8.2
```

Start MongoDB as a service

```zsh
brew services start mongodb-community@8.2
brew services list
brew services stop mongodb-community@8.2
```


## Components and architecture

1. Backend service:
    * Handle frontend user requests and issue instructions to agents.
    * Handle reports from agents.

2. The agent program, runs inside worker hosts, 
    * Listens to backend service's request to launch tasks.
    * Performs health checks on tasks.
    * Report metrics to backend service.

3. Metrics aggregator and partitioner

## ToDo

[X] Task service
[X] Message service
[X] Issue service
[] Artifact service
[] Metrics service

1. metrics service
2. metrics agent
3. metrics partitions and aggregators
4. file uploader/artifact store.
4. authentication between agent and service api, and message websocket
5. authentication between web browser and service api and message websocket


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