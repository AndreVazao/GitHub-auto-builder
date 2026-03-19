export class ProjectStateManager {
  constructor() {
    this.fileTree = new Map();
    this.pendingOperations = [];
  }

  registerPath(filePath, content) {
    if (!this.fileTree.has(filePath)) {
      this.fileTree.set(filePath, {
        firstSeen: new Date(),
        lastSeen: new Date(),
        versions: [{
          content: content.substring(0, 100) + '...', // Preview
          timestamp: new Date()
        }]
      });
    } else {
      const info = this.fileTree.get(filePath);
      info.lastSeen = new Date();
      info.versions.push({
        content: content.substring(0, 100) + '...',
        timestamp: new Date()
      });
    }
  }

  getFileInfo(filePath) {
    return this.fileTree.get(filePath);
  }

  getAllPaths() {
    return Array.from(this.fileTree.keys());
  }
}
