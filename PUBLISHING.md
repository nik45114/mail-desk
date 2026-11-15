# Publishing Mail Desk

Mail Desk 0.3.0 is a public preview. The bundled Google OAuth application remains in Testing; catalog publication does not remove that restriction. Outlook requires each user's Microsoft application registration. Live verification has been completed for Gmail sign-in and mailbox search, not yet for Outlook or IMAP/SMTP accounts.

## Release checklist

1. Run `npm ci --ignore-scripts` and `npm run build`.
2. Run `orca plugin types . --json`, `npm run typecheck`, `orca plugin test . --json`, `orca plugin check . --json`, and `orca plugin validate . --json`.
3. Inspect `orca plugin inspect . --json`: the panel and `secrets:own` must match the intended access.
4. Review the staged file list. Never add `.orca`, `node_modules`, OAuth JSON downloads, mailbox dumps, access tokens, refresh tokens, or app passwords. The bundled desktop OAuth registration is application configuration, not a user credential.
5. Keep the version in `orca-plugin.json` and `package.json` aligned with the `v<version>` tag.
6. Commit and push to the public GitHub repository that will own the plugin, then create and push the annotated version tag.
7. Add the `orca-plugin` topic and check `https://www.onorca.dev/plugins/<owner>/<repo>`.

There is no Orca publish command. For a custom catalog, use `orca plugin release-entry . --json` after committing and paste the generated release entry into the catalog.

## Provider rollout

- **Google:** the current Desktop client uses PKCE and a loopback callback. Public Gmail access requires moving beyond Testing and completing all applicable Google verification for the restricted `gmail.modify` scope.
- **Microsoft:** 0.3.0 uses the user's own public-client application and device authorization. Verify the adapter against real personal and Microsoft 365 mailboxes before removing its preview label.
- **IMAP/SMTP:** verify folder discovery, UID validity, drafts, flags, and SMTP behavior against representative providers before removing its preview label.
- **MCP:** 0.3.0 requires a development-loaded plugin because Orca's installed-plugin request bridge is unavailable to the companion. Document any future change to this requirement in MCP.md and the changelog.

For maintainer Google setup, `scripts/set-google-client.mjs /path/to/desktop-client.json` imports a Desktop OAuth registration into `src/google-client.ts` without printing it. Never place user access or refresh tokens in that file.
