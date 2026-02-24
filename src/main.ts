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
  private privatePaths = new Set<string>();
  private locked = true;
  private statusBarEl: HTMLElement | null = null;

  async onload() {
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("obcrypt-status");
    this.statusBarEl.addEventListener("click", () => {
      if (this.locked) {
        this.unlockVault();
      } else if (this.password) {
        this.lockVault();
      }
    });
    this.updateStatusBar();

    this.addCommand({
      id: "obcrypt-lock",
      name: "Lock vault",
      callback: () => this.lockVault(),
    });

    this.addCommand({
      id: "obcrypt-change-password",
      name: "Change encryption password",
      callback: () => this.changePassword(),
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || !file.path.endsWith(".md")) return;
        if (this.locked) return;
        this.app.vault.cachedRead(file).then((content) => {
          if (contentHasPrivateTag(content)) {
            this.privatePaths.add(file.path);
          } else {
            this.privatePaths.delete(file.path);
          }
        });
      })
    );

    this.app.workspace.onLayoutReady(() => this.init());
  }

  onunload() {
    if (!this.locked && this.password) {
      this.encryptTrackedFiles();
    }
    clearKeyCache();
  }

  private updateStatusBar() {
    if (!this.statusBarEl) return;
    this.statusBarEl.setText(this.locked ? "🔒 Obcrypt: Locked" : "🔓 Obcrypt: Unlocked");
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
      this.locked = false;
      this.updateStatusBar();
      this.scanForPrivateFiles();
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

      try {
        await decrypt(encryptedFiles[0].raw, this.password);
        break;
      } catch {
        this.password = null;
        if (attempt === MAX_PASSWORD_ATTEMPTS) {
          new Notice("Obcrypt: Too many failed attempts — plugin disabled for this session.");
          return;
        }
      }
    }

    await this.decryptAll(encryptedFiles);
    this.locked = false;
    this.updateStatusBar();
    this.scanForPrivateFiles();
    new Notice(`Obcrypt: Unlocked ${encryptedFiles.length} note(s).`);
  }

  private async findEncryptedFiles(): Promise<{ file: TFile; raw: string }[]> {
    const results: { file: TFile; raw: string }[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      try {
        const raw = await this.app.vault.adapter.read(file.path);
        if (isEncrypted(raw)) {
          results.push({ file, raw });
        }
      } catch {
        // skip
      }
    }
    return results;
  }

  private scanForPrivateFiles() {
    for (const file of this.app.vault.getMarkdownFiles()) {
      this.app.vault.cachedRead(file).then((content) => {
        if (contentHasPrivateTag(content)) {
          this.privatePaths.add(file.path);
        }
      });
    }
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

  /**
   * Decrypt all encrypted files — writes plaintext to disk so Obsidian
   * indexes everything correctly (graph, backlinks, tags, search).
   */
  private async decryptAll(encryptedFiles: { file: TFile; raw: string }[]) {
    if (!this.password) return;
    for (const { file, raw } of encryptedFiles) {
      try {
        const plain = await decrypt(raw, this.password);
        this.privatePaths.add(file.path);
        await this.app.vault.modify(file, plain);
      } catch (e) {
        console.error(`Obcrypt: Failed to decrypt ${file.path}`, e);
      }
    }
  }

  /**
   * Encrypt all tracked #private files on disk. Called on lock and unload.
   */
  private encryptTrackedFiles() {
    if (!this.password) return;
    const pw = this.password;
    for (const path of this.privatePaths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        this.app.vault.cachedRead(file).then(async (content) => {
          if (contentHasPrivateTag(content) && !isEncrypted(content)) {
            try {
              const cipher = await encrypt(content, pw);
              await this.app.vault.adapter.write(file.path, cipher);
            } catch (e) {
              console.error(`Obcrypt: Failed to encrypt ${file.path}`, e);
            }
          }
        });
      }
    }
  }

  private async unlockVault() {
    const encryptedFiles = await this.findEncryptedFiles();

    if (encryptedFiles.length === 0) {
      await this.promptPassword(
        "This password encrypts and decrypts your #private notes. Choose a strong password and remember it — there is no recovery."
      );
      if (!this.password) return;
      this.locked = false;
      this.updateStatusBar();
      this.scanForPrivateFiles();
      new Notice("Obcrypt: Unlocked.");
      return;
    }

    for (let attempt = 1; attempt <= MAX_PASSWORD_ATTEMPTS; attempt++) {
      const msg =
        attempt === 1
          ? "Enter your password to decrypt your #private notes."
          : `Wrong password. Attempt ${attempt} of ${MAX_PASSWORD_ATTEMPTS}.`;

      await this.promptPassword(msg);
      if (!this.password) return;

      try {
        await decrypt(encryptedFiles[0].raw, this.password);
        break;
      } catch {
        this.password = null;
        if (attempt === MAX_PASSWORD_ATTEMPTS) {
          new Notice("Obcrypt: Too many failed attempts.");
          return;
        }
      }
    }

    await this.decryptAll(encryptedFiles);
    this.locked = false;
    this.updateStatusBar();
    this.scanForPrivateFiles();
    new Notice(`Obcrypt: Unlocked ${encryptedFiles.length} note(s).`);
  }

  private async lockVault() {
    if (!this.password || this.locked) {
      new Notice("Obcrypt: Already locked.");
      return;
    }
    let count = 0;
    for (const path of this.privatePaths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        try {
          const content = await this.app.vault.cachedRead(file);
          if (contentHasPrivateTag(content) && !isEncrypted(content)) {
            const cipher = await encrypt(content, this.password);
            await this.app.vault.adapter.write(file.path, cipher);
            count++;
          }
        } catch (e) {
          console.error(`Obcrypt: Failed to encrypt ${file.path}`, e);
        }
      }
    }
    this.locked = true;
    this.updateStatusBar();
    new Notice(`Obcrypt: Locked ${count} note(s). Close and reopen to unlock.`);
  }

  private async changePassword() {
    if (!this.password || this.locked) return;
    const oldPassword = this.password;

    await this.promptPassword("Enter your new encryption password.");
    if (!this.password) {
      this.password = oldPassword;
      new Notice("Obcrypt: Password change cancelled.");
      return;
    }

    clearKeyCache();
    new Notice("Obcrypt: Password changed. Notes will be encrypted with the new password on lock.");
  }
}
