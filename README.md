# Ragline Backend API

## Architecture

- src/repository: Contains implementations for all outbound communication (whether that's database or other APIs).
- src/service: Contains all the business logic.
- src/config: single place for all configuration (from environment variables)

## Testing

- TBD

## Dynamodb table

This command creates our table

```
aws dynamodb create-table \
  --table-name documents \
  --attribute-definitions \
      AttributeName=documentId,AttributeType=S \
      AttributeName=status,AttributeType=S \
  --key-schema AttributeName=documentId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --table-class STANDARD
```

Add a GSI for querying by status

```
  --global-secondary-indexes \
      IndexName=StatusIndex,\
      KeySchema=[{AttributeName=status,KeyType=HASH}],\
      Projection={ProjectionType=ALL}
```

## How to Run Locally

1. `cp .env.example .env` (and edit if necessary)
1. `npm ci`
1. `npm run dev`

## How to build container and push to ECR

```
$ docker build -t ragline-backend:latest
$ docker tag \
      ragline-backend:latest \
      908860991626.dkr.ecr.us-east-1.amazonaws.com/ragline-backend:latest
$ docker push 908860991626.dkr.ecr.us-east-1.amazonaws.com/ragline-backend:latest
```

