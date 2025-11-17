# PEDAC

- Define route for login
- Add middleware
- Figure out public routes : probably only login route
- locally add .env jwt-secret, or on cloud then create secret and add as environment variable when setting up service

Done:

- - Install: jsonwebtoken, bcrypt
- Create table for users in DynamoDB ( username: "admin" , password )
- Create that user if it doesn't already exist
- To create that user: generate password and hash it using brcrypt and store it

Todo:

- figure out how to call api from ingestion code when we've implemented authentication
