# Platformatic Logto Integration
This project provides a seamless integration between [Platformatic](https://platformatic.dev/) and [Logto](https://logto.io/), enabling robust authentication and authorization mechanisms in your Platformatic applications.

Based on [@platformatic/db-authorization](https://github.com/platformatic/platformatic/tree/main/packages/db-authorization)

## Features
- Authentication Middleware: Easily authenticate users using Logto within your Platformatic services.
- Authorization Support: Implement role-based access control (RBAC) by leveraging Logto's authorization capabilities (roles and scopes).
- Customizable Hooks: Extend and customize authentication flows to fit your application's needs.
- TypeScript Support: Written in TypeScript for type safety and improved developer experience.

## Installation
To install the package, use your preferred package manager:

```
npm install platformatic-logto
# or
yarn add platformatic-logto
# or
pnpm add platformatic-logto
```
## Usage
Here's a basic example of how to integrate platformatic-logto into your Platformatic application:
```
import { buildServer } from 'platformatic';
import { logtoPlugin } from 'platformatic-logto';

const app = await buildServer({
  // ... your Platformatic configuration
  plugins: {
    paths: ['./plugins/logto-plugin.js'],
  },
});

// Register the Logto plugin
app.register(logtoPlugin, {
  appId: 'your-logto-app-id',
  appSecret: 'your-logto-app-secret',
  endpoint: 'https://your-logto-endpoint',
  // Additional configuration options
});

await app.listen();
```

**Ensure you replace '_your-logto-app-id_', '_your-logto-app-secret_', and 'https://your-logto-endpoint' with your actual Logto application credentials and endpoint.**

## Configuration Options
The logtoPlugin accepts the following configuration options:

| Property | Type | Description |
| ----- | ----------------- | ------------- |
| appId | string | Your Logto application's ID. |
| appSecret | string | Your Logto application's secret. |
| endpoint | string | The base URL of your Logto instance. |
| audience | string, optional | Specify the intended audience for the tokens. |
| scopes | string[], optional | Define the scopes required for your application. |
| redirectUri | string, optional | The URI to redirect to after authentication. |


You can also provide custom handlers for specific events, such as token validation or user session management.

## License
This project is licensed under the MIT License.

## Contributing
Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

For more information and advanced usage, please refer to the official documentation for [Platformatic](https://platformatic.dev/docs/db/plugin) and [LogTo](https://docs.logto.io/introduction).