# Obcrypt

Transparent encryption for your private notes in Obsidian. Tag any note with `#private` and it will be encrypted on the filesystem automatically — while remaining fully readable and editable in the Obsidian editor.

## How it works

1. **On startup**, the plugin prompts for your encryption password and decrypts any encrypted notes so you can work with them normally.
2. **While unlocked**, notes are plaintext on disk — graph, backlinks, tags, and search all work perfectly.
3. **On lock** (or when Obsidian closes), all `#private` notes are encrypted on disk as `OBCRYPT:v1:...` blobs — unreadable without the password.
4. The status bar shows the current lock state.

Your password is held in memory only for the duration of the session. It is never written to disk.

This is the same security model as disk encryption: files are decrypted while in use, encrypted at rest.

## Encryption details

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: PBKDF2 with SHA-256, 600,000 iterations
- **Per-file randomness**: unique 16-byte salt and 12-byte IV per save
- **Implementation**: Web Crypto API (built into Electron/Obsidian)

## Usage

1. Install and enable the plugin.
2. Enter a strong password when prompted. **Remember it — there is no recovery.**
3. Add `#private` anywhere in a note (frontmatter tags work too).
4. The note is now encrypted on disk every time it saves.

To verify, open the `.md` file outside of Obsidian — you'll see the `OBCRYPT:v1:` ciphertext instead of your note content.

## Commands

| Command | Description |
|---|---|
| **Lock vault** | Encrypts all `#private` notes on disk and locks the vault |
| **Change encryption password** | Sets a new password (applied on next lock) |

## Security notes

- If you forget your password, your encrypted notes **cannot be recovered**.
- While the vault is unlocked, `#private` files are plaintext on disk. Lock the vault or close Obsidian to encrypt them.
- Removing the `#private` tag from a note will cause it to be saved as plaintext on the next write.

## Building from source

```bash
npm install
npm run build
```

## License

[MIT](LICENSE)
