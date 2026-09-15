# Environment settings

Copy `.env.example` to `.env.local`, then follow the
[launch instructions](../README.md#setup-and-launch). `.env.local` is gitignored.

The server validates its environment at startup. `MAGENTO_MAX_RESPONSE_BYTES`,
`MCP_MAX_PAGE_SIZE`, and `MCP_HTTP_PORT` have defaults. Set every other variable explicitly.

| Variable                            | Accepted value                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `MAGENTO_BASE_URL`                  | Magento HTTPS origin, for example `https://commerce.example.com`.                             |
| `MAGENTO_STORE_SCOPE`               | Store view code or `all` for global scope. See [Store scope](#store-scope).                   |
| `MAGENTO_OAUTH_CONSUMER_KEY`        | OAuth 1.0a consumer key, 1–4096 characters.                                                   |
| `MAGENTO_OAUTH_CONSUMER_SECRET`     | OAuth 1.0a consumer secret, 1–4096 characters.                                                |
| `MAGENTO_OAUTH_ACCESS_TOKEN`        | OAuth 1.0a access token, 1–4096 characters.                                                   |
| `MAGENTO_OAUTH_ACCESS_TOKEN_SECRET` | OAuth 1.0a access-token secret, 1–4096 characters.                                            |
| `MAGENTO_REQUEST_TIMEOUT_MS`        | Total request deadline in milliseconds, from 100 to 120000. A GET retry shares this deadline. |
| `MAGENTO_MAX_RESPONSE_BYTES`        | Magento JSON response limit, from 1 to 10485760 bytes. Default: 10485760 (10 MiB).            |
| `MCP_MAX_PAGE_SIZE`                 | Largest accepted page size, from 1 to 1000. Default: 25.                                      |
| `MCP_AUDIT_FILE`                    | JSON Lines audit path. Relative paths resolve from the working directory.                     |
| `MCP_HTTP_PORT`                     | Loopback Streamable HTTP port, from 1 to 65535. Default: 3000.                                |

The four OAuth values reject control characters. `MCP_AUDIT_FILE` accepts up to 4096 characters
and rejects null bytes and line breaks. One validated configuration serves every tool call in the
process.

## Store scope

`MAGENTO_STORE_SCOPE` becomes part of every Magento REST URL:

```text
https://<host>/rest/<MAGENTO_STORE_SCOPE>/V1/...
```

| Value                   | Meaning                                                      | REST path example           |
| ----------------------- | ------------------------------------------------------------ | --------------------------- |
| `default`               | The **Default Store View**, whose initial code is `default`. | `/rest/default/V1/products` |
| `all`                   | The **global scope** (All Store Views).                      | `/rest/all/V1/products`     |
| Another store view code | A configured store view.                                     | `/rest/en_us/V1/products`   |

Use the current store view code when an installation has renamed the initial `default` code. Find
store view codes in Magento Admin under **Stores > All Stores** or in the
`store_hierarchy_get` result.

The value accepts 1–64 lowercase letters, digits, or underscores and starts with a letter. A server
process uses one scope for all calls. Magento applies the selected endpoint scope and the OAuth
integration's ACL permissions.

Adobe provides background information in the
[scope hierarchy](https://experienceleague.adobe.com/en/docs/commerce-admin/start/setup/websites-stores-views)
and [REST URL structure](https://developer.adobe.com/commerce/webapi/rest/) documentation.

## HTTP and TLS

The Streamable HTTP transport listens on `127.0.0.1` and serves the fixed `/mcp` endpoint.
`MCP_HTTP_PORT` changes its TCP port. Incoming requests pass localhost `Host` and `Origin`
validation before they reach the MCP handler.

Magento connections use HTTPS with certificate verification. Start Node.js with
`--use-system-ca` to include certificates from the operating system trust store. Set
`NODE_EXTRA_CA_CERTS` to an absolute PEM path when Magento uses a specific private CA.
