# Changelog

## 0.3.0

- Rename the panel to Mail Desk and add an account selector for up to 20 mailboxes.
- Redesign the sidebar with native Mail, Compose, and Accounts tabs and clearer search and message cards.
- Localize the interface for 16 locales using Orca's locale, with English fallback.
- Add preview adapters for Outlook / Microsoft 365 and generic IMAP/SMTP providers.
- Preserve existing Gmail credentials and isolate tokens and review tickets by account.
- Add a stdio MCP companion with account, search, read, and draft-save tools; no send tool.
- Bundle runtime dependencies for installation without npm or a local build.
- Add IMAP query and ID validation, Microsoft message mapping, and account-isolation tests.
- Document provider preview status, privacy behavior, and the development-load requirement for MCP.

## 0.2.0

- Native header, clearer message previews, dates and status indicators.
- Drafts and All mail folders, attachment and recent-mail search filters.
- Forward message text and open a specific conversation in Gmail.
- Save incomplete drafts without a recipient; sending still requires one.
- Reopen plain-text Gmail drafts, preserving the original draft and thread IDs.
- Refuse lossy editing of rich drafts, attachments and CC/BCC recipients.
- Keep pagination tied to the submitted search, even while editing the search field.
- Clearly disclose Google OAuth Testing restrictions before sign-in.

## 0.1.0

- Initial local release: Google sign-in, inbox, search, replies and drafts.
