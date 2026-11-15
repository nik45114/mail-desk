# Mail Desk for Orca

Multi-account email inside Orca: Gmail, Outlook / Microsoft 365, and other mailboxes through IMAP/SMTP. Search, read, reply, forward, manage labels, and edit plain-text drafts without leaving your workspace.

**Version 0.3.0 is a public preview.** The bundled Google OAuth application is in Testing, so its one-click sign-in works only for invited test users. Anyone can instead connect their own Google Desktop OAuth client. Outlook requires your Microsoft application registration. Only the live Gmail connection has been verified by the publisher so far; the Outlook and IMAP/SMTP adapters are preview implementations that still need verification against those services.

Mail Desk is an independent project, not an official Google, Microsoft, or Orca product. Licensed under [MIT](LICENSE).

## Features

- Multiple accounts with an account selector; up to 20 configured mailboxes.
- Inbox, unread, starred, sent, drafts, and all-mail views where supported.
- Provider-specific search, pagination, attachment names, dates, and read status.
- Reply, text-only forward, archive, read/unread, and star actions.
- Create and update plain-text drafts, including drafts without a recipient.
- Review before sending; sending requires a separate explicit button.
- Redesigned native tabs for mail, compose, and account management, with automatic light/dark theme support.
- Localized interface for 16 locales, with English fallback for unsupported locales and missing strings.
- Companion MCP server for account listing, search, reading, and saving drafts. It has no send tool.

## Install and develop

The release includes bundled runtime dependencies in `dist/`; installing it does not require npm or a build step. Orca must support `secrets.protection` and an OS-backed secret store.

For development:

```sh
npm ci --ignore-scripts
npm run build
orca plugin dev load /absolute/path/to/mail-desk --json
orca plugin open local.gmail-desk --panel gmail-desk --json
```

On Linux the CLI may be named `orca-ide`. Orca will show the requested access and an approval command. The plugin runs a Node.js worker with your user account's permissions and requests `secrets:own`; it does not request terminal or agent access.

## Connect mail

### Gmail

Click **Войти через Google**. In this preview the bundled client is restricted to Google's test audience. To connect independently, expand **Для разработчика: свой OAuth-клиент** and provide a Desktop app OAuth JSON from your own Google Cloud project with Gmail API and `https://www.googleapis.com/auth/gmail.modify` configured.

Google sign-in uses PKCE and a temporary loopback callback on `127.0.0.1`. The browser and the plugin worker must run on the same computer.

### Outlook / Microsoft 365

Add an Outlook account and provide the Application (client) ID of your Microsoft Entra application. Enable the public-client device authorization flow and delegated `User.Read`, `Mail.ReadWrite`, and `Mail.Send` permissions. No client secret is used. Sign-in opens Microsoft's device verification page and displays its one-time code in the panel.

### Other providers through IMAP/SMTP

Enable IMAP in the mailbox settings and create an app-specific password where the provider requires one. Enter the email, app password, IMAP host, and SMTP host. This version requires IMAP TLS on port 993 and SMTP TLS on port 465 or STARTTLS on port 587. Server certificate verification stays enabled.

Yandex, Mail.ru, iCloud, and other standards-compatible providers can be configured this way; availability and app-password rules depend on the provider.

## MCP for agents

See [MCP.md](MCP.md) for configuration and tools. In 0.3.0 the companion requires the plugin to be loaded as an approved development folder, because Orca's request bridge is available for development plugins only. Marketplace installation alone is not enough for MCP in this version.

## Privacy and limitations

There is no Mail Desk relay, analytics service, or telemetry. Credentials stay in Orca's encrypted secret store; mail is requested directly from its provider. MCP returns mail only when an agent explicitly calls a tool; that agent and its model provider then process the returned content under their own policies. See [PRIVACY.md](PRIVACY.md).

The panel is currently in Russian. HTML is shown as text without running scripts or loading remote images. Attachments cannot be downloaded, CC/BCC editing is not supported, and rich-text drafts are opened in webmail rather than overwritten. Forwarding includes text only. There are no background notifications. Long messages are limited to 100,000 characters in the panel.

Disconnecting removes the selected account's locally stored credentials. Revoking OAuth access at Google or Microsoft is a separate step.

## Checks

```sh
npm ci --ignore-scripts
npm run build
orca plugin types . --json
npm run typecheck
orca plugin test . --json
orca plugin check . --json
orca plugin validate . --json
```

The automated suite uses mock provider APIs. The OAuth test exercises a real loopback callback with a mocked token exchange. Live Gmail sign-in and mailbox search have also been exercised; no messages are sent by the test suite. `npm run test:mcp` performs a live read-only MCP smoke test against the configured development plugin.

See [CHANGELOG.md](CHANGELOG.md), [PUBLISHING.md](PUBLISHING.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
