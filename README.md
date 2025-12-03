# Ragline Backend API

A document management REST API built with Express.js, TypeScript, AWS (DynamoDB and S3), and JWT authentication.

## Architecture

- `src/repository`: Contains implementations for all outbound communication (whether that's database or other APIs).
- `src/service`: Contains all the business logic.
- `src/config`: Single place for all configuration (from environment variables)
- `src/middleware`: Authentication and error handling middleware

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. Most endpoints require a valid JWT token in the `Authorization` header.

### Authentication Flow

1. **Login** to get a JWT token using `/api/login`
1. **Include the token** in subsequent requests using the `Authorization` header: `Bearer <token>`
1. **Token expires** after 1 hour

### Public Routes (No Authentication Required)

- `GET /health` - Health check endpoint
- `POST /api/login` - Login endpoint

### Protected Routes (Require JWT Token)

All other routes require a valid JWT token in the `Authorization` header.

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
PORT=3000
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-s3-bucket-name
DYNAMODB_TABLE_NAME=documents
DYNAMODB_TABLE_USERS=users
ADMIN_PASSWORD=your_admin_password
JWT_SECRET=your_jwt_secret_key
```

**Note**: The admin user is automatically created on server startup if it doesn't exist. The password is hashed using bcrypt before storage.

## API Endpoints

### 1. Health Check

Check if the API is running.

**Request:**

```bash
GET /health
```

**Response:**

```
200 OK
ok
```

---

### 2. Login

Authenticate and receive a JWT token.

**Request:**

```bash
POST /api/login
Content-Type: application/json

{
  "userName": "admin",
  "password": "your_password"
}
```

**cURL Example:**

```bash
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"userName": "admin", "password": "your_password"}'
```

**Success Response (200):**

```json
{
  "jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses:**

- `400 Bad Request` - Missing username or password
  ```json
  {
    "error": "Username and password are required"
  }
  ```
- `403 Forbidden` - Invalid credentials
  ```json
  {
    "error": "Invalid credentials"
  }
  ```

---

### 3. Get All Documents

Retrieve a list of documents with optional filtering and pagination.

**Request:**

```bash
GET /api/documents?page=1&limit=10&status=all
Authorization: Bearer <your_jwt_token>
```

**Query Parameters:**

- `page` (optional, default: 1) - Page number
- `limit` (optional, default: 10) - Number of items per page
- `status` (optional, default: "all") - Filter by status: `pending`, `running`, `finished`, `failed`, or `all`

**cURL Example:**

```bash
curl -X GET "http://localhost:3000/api/documents?page=1&limit=10&status=all" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Success Response (200):**

```json
[
  {
    "documentId": "123e4567-e89b-12d3-a456-426614174000",
    "fileName": "example.pdf",
    "size": 1024,
    "status": "pending",
    "mimetype": "application/pdf",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**Error Response (404):**

```json
{
  "error": "Documents not found"
}
```

---

### 4. Get Document by ID

Retrieve a specific document by its ID.

**Request:**

```bash
GET /api/documents/:id
Authorization: Bearer <your_jwt_token>
```

**cURL Example:**

```bash
curl -X GET "http://localhost:3000/api/documents/123e4567-e89b-12d3-a456-426614174000" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Success Response (200):**

```json
{
  "documentId": "123e4567-e89b-12d3-a456-426614174000",
  "fileName": "example.pdf",
  "size": 1024,
  "status": "pending",
  "mimetype": "application/pdf",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**Error Response (404):**

```json
{
  "error": "Document not found"
}
```

---

### 5. Upload Document

Upload a new document file. The file is stored in S3 and metadata is saved in DynamoDB.

**Request:**

```bash
POST /api/documents
Authorization: Bearer <your_jwt_token>
Content-Type: multipart/form-data

file: <file>
```

**cURL Example:**

```bash
curl -X POST http://localhost:3000/api/documents \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -F "file=@/path/to/your/file.pdf"
```

**Success Response (201):**

```json
{
  "documentId": "123e4567-e89b-12d3-a456-426614174000",
  "fileName": "example.pdf",
  "size": 1024,
  "status": "pending",
  "mimetype": "application/pdf",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**Error Responses:**

- `400 Bad Request` - No file uploaded
  ```json
  {
    "error": "No file uploaded"
  }
  ```
- `500 Internal Server Error` - Upload failed
  ```json
  {
    "error": "Upload failed"
  }
  ```

**File Size Limit:** 50MB

---

### 6. Update Document Status

Update the status of a document.

**Request:**

```bash
PATCH /api/documents/:id
Authorization: Bearer <your_jwt_token>
Content-Type: application/json

{
  "status": "finished"
}
```

**Valid Status Values:**

- `pending`
- `running`
- `finished`
- `failed`

**cURL Example:**

```bash
curl -X PATCH "http://localhost:3000/api/documents/123e4567-e89b-12d3-a456-426614174000" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"status": "finished"}'
```

**Success Response (200):**

```json
{
  "documentId": "123e4567-e89b-12d3-a456-426614174000",
  "fileName": "example.pdf",
  "size": 1024,
  "status": "finished",
  "mimetype": "application/pdf",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**Error Response (500):**

```json
{
  "error": "Failed to update document: <documentId>"
}
```

---

## DynamoDB Tables

### Documents Table

This command creates the documents table:

```bash
aws dynamodb create-table \
  --table-name documents \
  --attribute-definitions \
      AttributeName=documentId,AttributeType=S \
      AttributeName=status,AttributeType=S \
  --key-schema AttributeName=documentId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --table-class STANDARD \
  --global-secondary-indexes \
      IndexName=status-index,\
      KeySchema=[{AttributeName=status,KeyType=HASH}],\
      Projection={ProjectionType=ALL}
```

### Users Table

This command creates the users table:

```bash
aws dynamodb create-table \
  --table-name users \
  --attribute-definitions \
      AttributeName=userName,AttributeType=S \
  --key-schema AttributeName=userName,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --table-class STANDARD
```

## How to Run Locally

### For Production/AWS Environment

1. **Copy the environment file template:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and configure for your AWS environment:
   - Set your AWS credentials
   - Set `IS_TEST_ENV=false` or remove it entirely
   - Configure your production DynamoDB table names
   - Set your production S3 bucket name

2. **Install dependencies:**

   ```bash
   npm ci
   ```

3. **Run the development server:**

   ```bash
   npm run dev
   ```

4. **The server will start on `http://localhost:3000`**

The application will connect to your real AWS resources (DynamoDB, S3) as configured in your `.env` file.

## Testing

### Running Tests

### Local Development/Testing Setup

For local development and testing, use Docker to run DynamoDB Local:

1. **Configure for local testing:**

   Ensure your `.env` file has:
   ```env
   IS_TEST_ENV=true
   DYNAMODB_TABLE_NAME=documents-terraform
   DYNAMODB_TABLE_USERS=users-terraform
   ```

1. **Start local DynamoDB and create tables:**

   ```bash
   npm run docker:setup
   ```

   This command will:
   - Pull the AWS DynamoDB Local Docker image
   - Start DynamoDB on port 8000
   - Create the required tables (`users-terraform` and `documents-terraform`)

1. **Run your tests or development server:**

   ```bash
   npm test
   ```

### Docker Commands for Testing

- **Start DynamoDB:** `npm run docker:up`
- **Stop DynamoDB:** `npm run docker:down`
- **Full setup:** `npm run docker:setup` (starts DB + creates tables)
- **Create tables only:** `npm run setup-local-tables`

### Troubleshooting Testing

- **DynamoDB not starting?** Make sure Docker is running and port 8000 is available
- **Tables not created?** Check your AWS credentials in `.env` - they're needed even for local DynamoDB
- **Connection errors?** Ensure `IS_TEST_ENV=true` in your `.env` file for local testing

## How to Build Container and Push to ECR

```bash
npm run docker:update
```

To redeploy the ECS with the container iamge you just pushed, run:

```bash
npm run ecs:redeploy
```

## Document Status Flow

Documents progress through the following statuses:

1. **pending** - Document uploaded, waiting to be processed
2. **running** - Document is currently being processed
3. **finished** - Document processing completed successfully
4. **failed** - Document processing failed

Use the `PATCH /api/documents/:id` endpoint to update document status.

#Zach added for testing

```
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 908860991626.dkr.ecr.us-east-1.amazonaws.com/sse-management-api
```

```
docker buildx build -t 908860991626.dkr.ecr.us-east-1.amazonaws.com/sse-management-api . --push
```
