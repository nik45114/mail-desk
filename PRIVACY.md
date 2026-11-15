# Mail Desk data handling

Mail Desk connects directly from the Orca worker to the selected provider: Google OAuth and Gmail API, Microsoft identity and Microsoft Graph, or the IMAP/SMTP servers configured by the user. The project has no mail relay, analytics, telemetry, or external AI server of its own.

## Stored credentials

OAuth access/refresh tokens, email addresses, Google developer client configuration, Microsoft client IDs, and IMAP/SMTP app passwords are kept in Mail Desk's own Orca secret store. The plugin requires Orca to confirm OS-keyring protection before configuring a connection. Credentials are not written into the source tree or printed to plugin logs.

The publisher's Desktop OAuth client registration is included in the build. A desktop client's ID and embedded client value are public application registration data, not user tokens, and do not themselves grant access to a mailbox.

## Message content and actions

Message headers and content are held in worker/panel memory to provide the requested view. Drafts are written only after an explicit save action. Sending requires preview and a separate explicit send action. Mail Desk does not permanently delete messages through its interface.

The optional MCP server returns account metadata, search results, message content, or draft results only when an agent calls the corresponding tool. Mail is not automatically sent to an agent. When MCP is used, the agent and its model provider process the returned data under their own privacy terms. MCP configuration does not need mailbox credentials.

Disconnecting removes the selected connection's locally stored tokens or client configuration. The account's label may remain in the account list. Other accounts are unaffected. Revoke OAuth access separately in the Google or Microsoft account settings when needed.

Other software running under the same OS account, the selected mail providers, and Orca's own secret-store implementation are outside Mail Desk's security boundary.

Before distributing a generally available Google OAuth client, the publisher must provide suitable contact details and a permanent HTTPS privacy-policy URL and complete Google's applicable verification requirements. Catalog publication alone does not complete that process.
