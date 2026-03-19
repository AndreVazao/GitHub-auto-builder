export class PathValidator {
  
  static PROJECT_PATTERNS = {
    generic: {
      validExtensions: ['.js', '.jsx', '.ts', '.tsx', '.py', '.json', '.html', '.css', '.md'],
      forbiddenChars: /[<>:"|?*\x00-\x1F]/g,
      maxDepth: 5
    }
  };

  static extractPathsFromText(text) {
    const paths = [];
    const fileRegex = /\/\/\s*FILE:\s*([^\n]+)/g;
    
    let match;
    while ((match = fileRegex.exec(text)) !== null) {
      const fullPath = match[1].trim();
      const lastSlash = fullPath.lastIndexOf('/');
      
      paths.push({
        fullPath: this.sanitizePath(fullPath),
        directory: lastSlash > 0 ? fullPath.substring(0, lastSlash) : '',
        fileName: lastSlash > 0 ? fullPath.substring(lastSlash + 1) : fullPath,
        extension: fullPath.includes('.') ? '.' + fullPath.split('.').pop() : ''
      });
    }
    
    return paths;
  }

  static extractCodeBlocks(text) {
    const blocks = [];
    const codeBlockRegex = /```(?:\w*)\n([\s\S]*?)```/g;
    
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      blocks.push({
        code: match[1].trim(),
        language: this.detectLanguage(match[0])
      });
    }
    
    return blocks;
  }

  static detectLanguage(codeBlock) {
    const firstLine = codeBlock.split('\n')[0];
    if (firstLine.includes('javascript') || firstLine.includes('js')) return 'javascript';
    if (firstLine.includes('python') || firstLine.includes('py')) return 'python';
    if (firstLine.includes('html')) return 'html';
    if (firstLine.includes('css')) return 'css';
    if (firstLine.includes('json')) return 'json';
    return 'unknown';
  }

  static validatePathSyntax(filePath, projectType = 'generic') {
    const errors = [];
    const warnings = [];

    if (!filePath || filePath.trim() === '') {
      errors.push('Path vazio');
      return { isValid: false, errors, warnings };
    }

    if (this.PROJECT_PATTERNS[projectType].forbiddenChars.test(filePath)) {
      errors.push('Caracteres proibidos');
    }

    const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
    if (ext && !this.PROJECT_PATTERNS[projectType].validExtensions.includes(ext)) {
      warnings.push(`Extensão ${ext} não comum`);
    }

    const depth = filePath.split('/').length;
    if (depth > this.PROJECT_PATTERNS[projectType].maxDepth) {
      warnings.push(`Path muito profundo (${depth} níveis)`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedPath: this.sanitizePath(filePath)
    };
  }

  static sanitizePath(filePath) {
    return filePath
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+|\/+$/g, '');
  }
        }
