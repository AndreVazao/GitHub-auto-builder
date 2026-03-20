export class ProjectStateManager {
  constructor() {
    this.fileTree = new Map();
  }

  registerPath(filePath, content) {
    const now = new Date().toISOString();
    const current = this.fileTree.get(filePath);

    if (!current) {
      this.fileTree.set(filePath, {
        firstSeenAt: now,
        lastSeenAt: now,
        versions: [
          {
            createdAt: now,
            preview: String(content || '').slice(0, 120)
          }
        ]
      });
      return;
    }

    current.lastSeenAt = now;
    current.versions.push({
      createdAt: now,
      preview: String(content || '').slice(0, 120)
    });
  }

  getFileInfo(filePath) {
    return this.fileTree.get(filePath) || null;
  }

  getAllPaths() {
    return Array.from(this.fileTree.keys()).sort();
  }
      }
