import { Plugin, Modal, App, Notice, TFile } from "obsidian";
import { encrypt, decrypt, isEncrypted, clearKeyCache } from "./crypto";

const PRIVATE_TAG = "#private";
const MAX_PASSWORD_ATTEMPTS = 3;

class PasswordModal extends Modal {
  private resolve: (password: string | null) => void;
  private password = "";
  private message: string;

  constructor(app: App, message: string, resolve: (password: string | null) => void) {
    super(app);
    this.message = message;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Obcrypt — Enter Password" });
    contentEl.createEl("p", {
      text: this.message,
      cls: "obcrypt-modal-desc",
    });

    const input = contentEl.createEl("input", {
      type: "password",
      placeholder: "Encryption password",
      cls: "obcrypt-password-input",
    });
    input.focus();

    input.addEventListener("input", () => {
      this.password = input.value;
    });

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        this.submit();
      }
    });

    const btnRow = contentEl.createDiv({ cls: "obcrypt-btn-row" });

    const unlockBtn = btnRow.createEl("button", {
      text: "Unlock",
      cls: "mod-cta",
    });
    unlockBtn.addEventListener("click", () => this.submit());

    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.resolve(null);
      this.close();
    });
  }

  submit() {
    if (!this.password) {
      new Notice("Password cannot be empty");
      return;
    }
    this.resolve(this.password);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

function contentHasPrivateTag(content: string): boolean {
  return content.includes(PRIVATE_TAG);
}

export default class ObcryptPlugin extends Plugin {
  private password: string | null = null;
  private originalRead: ((path: string) => Promise<string>) | null = null;
  private originalWrite:
    | ((path: string, data: string, opts?: any) => Promise<void>)
    | null = null;
  private patchedPaths = new Set<string>();
  private decrypting = false;
  private encrypting = false;

  async onload() {
    this.patchVaultAdapter();

    this.addCommand({
      id: "obcrypt-change-password",
      name: "Change encryption password",
      callback: () => this.changePassword(),
    });

    this.addCommand({
      id: "obcrypt-lock",
      name: "Lock all private notes now",
      callback: () => this.encryptAllPrivateNow(),
    });

    this.app.workspace.onLayoutReady(() => this.init());
  }

  onunload() {
    if (this.password && this.originalWrite) {
      const pw = this.password;
      const origWrite = this.originalWrite;
      for (const path of this.patchedPaths) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          this.app.vault.cachedRead(file).then(async (content) => {
            if (contentHasPrivateTag(content) && !isEncrypted(content)) {
              try {
                const cipher = await encrypt(content, pw);
                await origWrite(file.path, cipher);
              } catch {
                // best-effort
              }
            }
          });
        }
      }
    }
    this.unpatchVaultAdapter();
    clearKeyCache();
  }

  private async init() {
    const encryptedFiles = await this.findEncryptedFiles();

    if (encryptedFiles.length === 0) {
      await this.promptPassword(
        "This password encrypts and decrypts your #private notes. Choose a strong password and remember it — there is no recovery."
      );
      if (!this.password) {
        new Notice("Obcrypt: No password set — plugin disabled for this session.");
        return;
      }
      new Notice("Obcrypt: Ready. Tag any note with #private to encrypt it.");
      return;
    }

    for (let attempt = 1; attempt <= MAX_PASSWORD_ATTEMPTS; attempt++) {
      const msg =
        attempt === 1
          ? "Enter your password to decrypt your #private notes."
          : `Wrong password. Attempt ${attempt} of ${MAX_PASSWORD_ATTEMPTS}.`;

      await this.promptPassword(msg);
      if (!this.password) {
        new Notice("Obcrypt: No password set — plugin disabled for this session.");
        return;
      }

      const firstFile = encryptedFiles[0];
      try {
        await decrypt(firstFile.raw, this.password);
        break;
      } catch {
        this.password = null;
        if (attempt === MAX_PASSWORD_ATTEMPTS) {
          new Notice("Obcrypt: Too many failed attempts — plugin disabled for this session.");
          return;
        }
      }
    }

    await this.decryptAllPrivateOnLoad(encryptedFiles);
    new Notice(`Obcrypt: Unlocked ${encryptedFiles.length} note(s).`);
  }

  private async findEncryptedFiles(): Promise<{ file: TFile; raw: string }[]> {
    const results: { file: TFile; raw: string }[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      try {
        const raw = await this.originalRead!(file.path);
        if (isEncrypted(raw)) {
          results.push({ file, raw });
        }
      } catch {
        // skip unreadable files
      }
    }
    return results;
  }

  private promptPassword(message: string): Promise<void> {
    return new Promise((resolve) => {
      const modal = new PasswordModal(this.app, message, (pw) => {
        this.password = pw;
        resolve();
      });
      modal.open();
    });
  }

  private patchVaultAdapter() {
    const adapter = this.app.vault.adapter as any;

    this.originalRead = adapter.read.bind(adapter);
    this.originalWrite = adapter.write.bind(adapter);

    const plugin = this;

    adapter.read = async function (path: string) {
      const raw: string = await plugin.originalRead!(path);
      if (isEncrypted(raw) && plugin.password && !plugin.decrypting) {
        try {
          plugin.decrypting = true;
          const plain = await decrypt(raw, plugin.password);
          plugin.patchedPaths.add(path);
          return plain;
        } catch {
          return raw;
        } finally {
          plugin.decrypting = false;
        }
      }
      return raw;
    };

    adapter.write = async function (
      path: string,
      data: string,
      opts?: any
    ) {
      if (
        plugin.password &&
        !plugin.encrypting &&
        path.endsWith(".md") &&
        contentHasPrivateTag(data)
      ) {
        try {
          plugin.encrypting = true;
          const cipher = await encrypt(data, plugin.password);
          plugin.patchedPaths.add(path);
          return plugin.originalWrite!(path, cipher, opts);
        } catch (e) {
          new Notice(`Obcrypt: Failed to encrypt ${path}`);
          console.error("Obcrypt encrypt error", e);
          return plugin.originalWrite!(path, data, opts);
        } finally {
          plugin.encrypting = false;
        }
      }
      if (!contentHasPrivateTag(data) && plugin.patchedPaths.has(path)) {
        plugin.patchedPaths.delete(path);
      }
      return plugin.originalWrite!(path, data, opts);
    };
  }

  private unpatchVaultAdapter() {
    if (this.originalRead && this.originalWrite) {
      const adapter = this.app.vault.adapter as any;
      adapter.read = this.originalRead;
      adapter.write = this.originalWrite;
    }
  }

  private async decryptAllPrivateOnLoad(
    encryptedFiles: { file: TFile; raw: string }[]
  ) {
    if (!this.password) return;
    for (const { file, raw } of encryptedFiles) {
      try {
        const plain = await decrypt(raw, this.password);
        this.patchedPaths.add(file.path);
        await this.app.vault.modify(file, plain);
      } catch (e) {
        console.error(`Obcrypt: Failed to decrypt ${file.path}`, e);
      }
    }
  }

  private async encryptAllPrivateNow() {
    if (!this.password) return;
    let count = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      try {
        const content = await this.app.vault.read(file);
        if (contentHasPrivateTag(content) && !isEncrypted(content)) {
          const cipher = await encrypt(content, this.password);
          await this.originalWrite!(file.path, cipher);
          this.patchedPaths.add(file.path);
          count++;
        }
      } catch {
        // skip
      }
    }
    new Notice(`Obcrypt: Locked ${count} note(s).`);
  }

  private async changePassword() {
    if (!this.password) return;
    const oldPassword = this.password;

    const files: { file: TFile; content: string }[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      try {
        const raw = await this.originalRead!(file.path);
        if (isEncrypted(raw)) {
          const plain = await decrypt(raw, oldPassword);
          files.push({ file, content: plain });
        }
      } catch {
        // skip
      }
    }

    await this.promptPassword("Enter your new encryption password.");
    if (!this.password) {
      this.password = oldPassword;
      new Notice("Obcrypt: Password change cancelled.");
      return;
    }

    clearKeyCache();

    let count = 0;
    for (const { file, content } of files) {
      const cipher = await encrypt(content, this.password);
      await this.originalWrite!(file.path, cipher);
      count++;
    }
    new Notice(`Obcrypt: Re-encrypted ${count} note(s) with new password.`);
  }
}
